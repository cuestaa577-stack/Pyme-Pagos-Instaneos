'use strict';
const { db } = require('../db');

const ACCOUNTS = {
  PROVIDER_CLEARING: 'provider_clearing',
  MERCHANT_AVAILABLE: 'merchant_available',
  MERCHANT_PENDING: 'merchant_pending',
  FEES: 'fee_income',
  PAYOUTS_OUT: 'payouts_out',
  WITHDRAWALS_OUT: 'withdrawals_out',
  CUSTOMER_FLOAT: 'customer_float',
  // Capital propio aportado por el comercio para adelantar entregas mientras
  // el proveedor liquida (T+N). Permite pagos instantáneos reales.
  LIQUIDITY_FLOAT: 'liquidity_float',
  // Contrapartida del capital aportado / devuelto.
  OWNER_EQUITY: 'owner_equity',
};

/**
 * Registra asientos contables. Cada operación genera asientos que suman cero
 * (débitos = créditos), lo que permite auditar el saldo en cualquier momento.
 */
const insert = db.prepare(
  `INSERT INTO ledger_entries
   (transaction_id, withdrawal_id, payout_id, account, direction, amount_cents, currency, description)
   VALUES (@transaction_id, @withdrawal_id, @payout_id, @account, @direction, @amount_cents, @currency, @description)`
);

function post(entries) {
  const clean = entries.filter((e) => Number(e.amount_cents) > 0);
  if (!clean.length) return;
  // Cada moneda debe cuadrar por separado (no se pueden sumar céntimos de
  // monedas distintas). Así se garantiza partida doble por divisa.
  const byCurrency = new Map();
  for (const e of clean) {
    const cur = e.currency || 'USD';
    const acc = byCurrency.get(cur) || { debit: 0, credit: 0 };
    acc[e.direction] += Number(e.amount_cents);
    byCurrency.set(cur, acc);
  }
  for (const [cur, acc] of byCurrency) {
    if (acc.debit !== acc.credit) {
      throw new Error(
        `Asientos descuadrados en ${cur}: débitos ${acc.debit} vs créditos ${acc.credit}`
      );
    }
  }
  const tx = db.transaction(() => {
    for (const e of clean) {
      insert.run({
        transaction_id: e.transaction_id || null,
        withdrawal_id: e.withdrawal_id || null,
        payout_id: e.payout_id || null,
        account: e.account,
        direction: e.direction,
        amount_cents: e.amount_cents,
        currency: e.currency,
        description: e.description || null,
      });
    }
  });
  tx();
}

function balance(account, currency) {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE 0 END), 0) AS debits
       FROM ledger_entries WHERE account = ? AND currency = ?`
    )
    .get(account, currency);
  return Number(row.credits) - Number(row.debits);
}

function balances(currency) {
  const rows = db
    .prepare(
      `SELECT account,
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_cents ELSE 0 END), 0) AS debits
       FROM ledger_entries WHERE currency = ? GROUP BY account`
    )
    .all(currency);
  return rows.map((r) => ({ account: r.account, balance: Number(r.credits) - Number(r.debits) }));
}

/** Mueve comisiones acumuladas (utilidad) al saldo disponible para retiros. */
function sweepFees({ currency = 'USD', amountCents, description = 'Barrido de comisiones' } = {}) {
  const available = balance(ACCOUNTS.FEES, currency);
  const amount = amountCents ? Number(amountCents) : available;
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('No hay comisiones por barrer.');
  if (amount > available) throw new Error('El monto supera las comisiones acumuladas.');
  post([
    { account: ACCOUNTS.FEES, direction: 'debit', amount_cents: amount, currency, description },
    { account: ACCOUNTS.MERCHANT_AVAILABLE, direction: 'credit', amount_cents: amount, currency, description },
  ]);
  return { amount_cents: amount, currency };
}

function hasSettlementEntries(transactionId) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM ledger_entries WHERE transaction_id = ? AND account = ? LIMIT 1`
      )
      .get(transactionId, ACCOUNTS.PROVIDER_CLEARING)
  );
}

function settleCollection({ transactionId, grossCents, feeCents, netCents, currency, description, pending = false }) {
  if (hasSettlementEntries(transactionId)) return false;
  // Si el proveedor retiene los fondos (T+N), el neto entra como pendiente y
  // se libera a disponible cuando llega la liquidación.
  const netAccount = pending ? ACCOUNTS.MERCHANT_PENDING : ACCOUNTS.MERCHANT_AVAILABLE;
  post([
    {
      transaction_id: transactionId,
      account: ACCOUNTS.PROVIDER_CLEARING,
      direction: 'debit',
      amount_cents: grossCents,
      currency,
      description: description || 'Fondos recibidos del procesador',
    },
    {
      transaction_id: transactionId,
      account: netAccount,
      direction: 'credit',
      amount_cents: netCents,
      currency,
      description: description || (pending ? 'Saldo pendiente de liquidación' : 'Saldo disponible por cobro'),
    },
    {
      transaction_id: transactionId,
      account: ACCOUNTS.FEES,
      direction: 'credit',
      amount_cents: feeCents,
      currency,
      description: 'Comisión de la plataforma',
    },
  ]);
  return true;
}

/**
 * Libera a disponible el neto de un cobro que estaba pendiente de liquidación.
 * Idempotente: usa settled_at en la transacción.
 */
function releasePending(transactionId) {
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  if (!t || t.settled_at) return false;
  post([
    {
      transaction_id: transactionId,
      account: ACCOUNTS.MERCHANT_PENDING,
      direction: 'debit',
      amount_cents: t.net_cents,
      currency: t.currency,
      description: `Liquidación recibida ${t.public_id}`,
    },
    {
      transaction_id: transactionId,
      account: ACCOUNTS.MERCHANT_AVAILABLE,
      direction: 'credit',
      amount_cents: t.net_cents,
      currency: t.currency,
      description: `Saldo disponible ${t.public_id}`,
    },
  ]);
  db.prepare("UPDATE transactions SET settled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(
    transactionId
  );
  return true;
}

/** Aporta capital propio (float) para poder entregar de inmediato. */
function fundLiquidity({ amountCents, currency, description }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Monto inválido.');
  post([
    {
      account: ACCOUNTS.OWNER_EQUITY,
      direction: 'debit',
      amount_cents: amountCents,
      currency,
      description: description || 'Aporte de liquidez del propietario',
    },
    {
      account: ACCOUNTS.LIQUIDITY_FLOAT,
      direction: 'credit',
      amount_cents: amountCents,
      currency,
      description: description || 'Float de liquidez disponible',
    },
  ]);
  return { amount_cents: amountCents, currency };
}

/** Retira capital propio sobrante del float (no puede dejar saldo negativo). */
function withdrawLiquidity({ amountCents, currency, description }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Monto inválido.');
  const available = balance(ACCOUNTS.LIQUIDITY_FLOAT, currency);
  if (amountCents > available) throw new Error('El monto supera el float disponible.');
  post([
    {
      account: ACCOUNTS.LIQUIDITY_FLOAT,
      direction: 'debit',
      amount_cents: amountCents,
      currency,
      description: description || 'Devolución de liquidez al propietario',
    },
    {
      account: ACCOUNTS.OWNER_EQUITY,
      direction: 'credit',
      amount_cents: amountCents,
      currency,
      description: description || 'Devolución de liquidez al propietario',
    },
  ]);
  return { amount_cents: amountCents, currency };
}

/** Capacidad total para entregar al instante = disponible + float. */
function deliveryCapacity(currency) {
  return balance(ACCOUNTS.MERCHANT_AVAILABLE, currency) + balance(ACCOUNTS.LIQUIDITY_FLOAT, currency);
}

function refundCollection({ transactionId, amountCents, currency, description }) {
  post([
    {
      transaction_id: transactionId,
      account: ACCOUNTS.MERCHANT_AVAILABLE,
      direction: 'debit',
      amount_cents: amountCents,
      currency,
      description: description || 'Reembolso al pagador',
    },
    {
      transaction_id: transactionId,
      account: ACCOUNTS.PROVIDER_CLEARING,
      direction: 'credit',
      amount_cents: amountCents,
      currency,
      description: description || 'Reembolso enviado al procesador',
    },
  ]);
}

function debitWithdrawal({ withdrawalId, amountCents, feeCents, currency, description }) {
  const total = amountCents + feeCents;
  post([
    {
      withdrawal_id: withdrawalId,
      account: ACCOUNTS.MERCHANT_AVAILABLE,
      direction: 'debit',
      amount_cents: total,
      currency,
      description: description || 'Retiro a cuenta propia',
    },
    {
      withdrawal_id: withdrawalId,
      account: ACCOUNTS.WITHDRAWALS_OUT,
      direction: 'credit',
      amount_cents: amountCents,
      currency,
      description: 'Fondos enviados por BRE-B',
    },
    {
      withdrawal_id: withdrawalId,
      account: ACCOUNTS.FEES,
      direction: 'credit',
      amount_cents: feeCents,
      currency,
      description: 'Comisión por retiro',
    },
  ]);
}

function debitPayout({ payoutId, amountCents, feeCents, currency, description }) {
  const total = amountCents + feeCents;
  post([
    {
      payout_id: payoutId,
      account: ACCOUNTS.MERCHANT_AVAILABLE,
      direction: 'debit',
      amount_cents: total,
      currency,
      description: description || 'Pago a beneficiario',
    },
    {
      payout_id: payoutId,
      account: ACCOUNTS.PAYOUTS_OUT,
      direction: 'credit',
      amount_cents: amountCents,
      currency,
      description: 'Fondos enviados al beneficiario',
    },
    {
      payout_id: payoutId,
      account: ACCOUNTS.FEES,
      direction: 'credit',
      amount_cents: feeCents,
      currency,
      description: 'Comisión por payout',
    },
  ]);
}

module.exports = {
  ACCOUNTS,
  post,
  balance,
  balances,
  hasSettlementEntries,
  sweepFees,
  settleCollection,
  releasePending,
  fundLiquidity,
  withdrawLiquidity,
  deliveryCapacity,
  refundCollection,
  debitWithdrawal,
  debitPayout,
};
