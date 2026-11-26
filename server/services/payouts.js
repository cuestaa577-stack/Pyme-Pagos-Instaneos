'use strict';
const crypto = require('crypto');
const { db, audit } = require('../db');
const config = require('../config');
const { format, toMajor } = require('../lib/money');
const pricing = require('./pricing');
const ledger = require('./ledger');
const orders = require('./orders');
const breb = require('../providers/breb');
const dlocalgo = require('../providers/dlocalgo');
const vepay = require('../providers/vepay');

const DEST_CURRENCY = { CO: 'COP', VE: 'VES', AR: 'ARS', BR: 'BRL', CL: 'CLP', MX: 'MXN', PE: 'PEN', PY: 'PYG', UY: 'UYU' };

function publicId() {
  return `PO-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function serialize(row) {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    amount_formatted: format(row.amount_cents, row.currency),
  };
}

function getPayout(id) {
  const row = db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
  return row ? serialize(row) : null;
}

function listPayouts({ limit = 50, offset = 0 } = {}) {
  const rows = db
    .prepare(
      `SELECT p.*, b.full_name AS beneficiary_name, b.rail, b.country AS beneficiary_country
       FROM payouts p LEFT JOIN beneficiaries b ON b.id = p.beneficiary_id
       ORDER BY p.id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM payouts').get().n;
  return { total, items: rows.map(serialize) };
}

/**
 * Pago instantáneo al beneficiario por BRE-B (Colombia) o Pago Móvil (Venezuela).
 * `amountCents` está en la moneda de destino; el saldo se debita en `sourceCurrency`.
 */
async function createInstantPayout({
  beneficiaryId,
  amountCents,
  sourceCurrency = 'USD',
  purpose = 'FAMILY_SUPPORT',
  description,
  actor = 'admin',
  ip,
  idempotencyKey,
}) {
  const b = orders.getBeneficiary(beneficiaryId);
  if (!b) throw new Error('Beneficiario no encontrado.');
  const destCurrency = DEST_CURRENCY[b.country] || sourceCurrency;
  const sourceAmount = pricing.convertMinor(amountCents, destCurrency, sourceCurrency);
  const feeCents = pricing.payoutFee(sourceAmount);
  const total = sourceAmount + feeCents;
  const available = ledger.balance(ledger.ACCOUNTS.MERCHANT_AVAILABLE, sourceCurrency);
  if (total > available) {
    throw new Error(`Saldo insuficiente en ${sourceCurrency}. Disponible: ${format(available, sourceCurrency)}.`);
  }

  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM payouts WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) return serialize(existing);
  }

  const pid = publicId();
  const isVeRail = ['pago_movil_ve', 'transfer_ve', 'cash_ve', 'pago_movil'].includes(b.rail);
  // Sin credenciales reales del riel no se simula nada: la entrega queda
  // PENDIENTE para que el dueño la pague y la marque como pagada.
  const railLive = isVeRail ? vepay.isLive() : breb.isLive();
  const info = db
    .prepare(
      `INSERT INTO payouts (public_id, beneficiary_id, amount_cents, currency, country, flow_type, purpose,
        status, provider, idempotency_key, description, metadata)
       VALUES (?, ?, ?, ?, ?, 'B2C', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      pid,
      b.id,
      amountCents,
      destCurrency,
      b.country,
      purpose,
      railLive ? 'processing' : 'pending',
      railLive ? (isVeRail ? 'vepay' : 'breb') : 'manual',
      idempotencyKey || null,
      description || `Pago a ${b.full_name}`,
      JSON.stringify({
        rail: b.rail,
        source_currency: sourceCurrency,
        source_amount_cents: sourceAmount,
        fee_cents: feeCents,
        key_masked: b.breb_key ? `${String(b.breb_key).slice(0, 3)}***` : null,
      })
    );
  const payoutId = Number(info.lastInsertRowid);

  if (!railLive) {
    audit({
      actor,
      action: 'payout.manual_pending',
      entity: 'payout',
      entityId: pid,
      ip,
      metadata: { beneficiary: b.full_name, amount: amountCents, currency: destCurrency, rail: b.rail },
    });
    return getPayout(payoutId);
  }

  try {
    let result;
    if (b.rail === 'breb') {
      result = await breb.sendTransfer({
        amountCents,
        currency: 'COP',
        keyType: 'cedula',
        keyValue: b.breb_key || b.doc_number,
        beneficiaryName: b.full_name,
        documentType: 'CC',
        documentNumber: b.doc_number,
        reference: pid,
        description: description || `Pago ${pid}`,
      });
    } else if (isVeRail) {
      result = await vepay.sendPayout({
        amountCents,
        currency: 'VES',
        rail: b.rail === 'pago_movil' ? 'pago_movil_ve' : b.rail,
        reference: pid,
        beneficiaryName: b.full_name,
        beneficiaryDocument: b.doc_number,
        phone: b.phone || b.breb_key,
        bankCode: b.bank_code,
        description: description || `Pago ${pid}`,
      });
    } else {
      throw new Error('Usa el payout dLocal para cuentas bancarias.');
    }

    const completed = result.status === 'completed';
    db.prepare(
      `UPDATE payouts SET status = ?, provider = ?, provider_ref = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      completed ? 'completed' : result.status,
      result.provider,
      result.providerRef,
      JSON.stringify({
        rail: b.rail,
        source_currency: sourceCurrency,
        source_amount_cents: sourceAmount,
        fee_cents: feeCents,
        tracking_code: result.trackingCode,
        provider_raw: result.raw,
      }),
      payoutId
    );

    if (completed) {
      ledger.debitPayout({
        payoutId,
        amountCents: sourceAmount,
        feeCents,
        currency: sourceCurrency,
        description: `Pago instantáneo ${pid}`,
      });
    }

    audit({
      actor,
      action: 'payout.instant',
      entity: 'payout',
      entityId: pid,
      ip,
      metadata: { beneficiary: b.full_name, amount: amountCents, currency: destCurrency, status: result.status },
    });
    return getPayout(payoutId);
  } catch (err) {
    db.prepare(
      `UPDATE payouts SET status = 'failed', metadata = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      JSON.stringify({ rail: b.rail, source_currency: sourceCurrency, source_amount_cents: sourceAmount, fee_cents: feeCents, error: err.message }),
      payoutId
    );
    throw new Error(`No se pudo pagar al beneficiario: ${err.message}`);
  }
}

/** Payout v1 de dLocal Go (países habilitados, datos bancarios completos). */
async function createDlocalPayout({
  beneficiaryId,
  amountCents,
  currency,
  purpose = 'REWARDS',
  flowType = 'B2C',
  businessName,
  actor = 'admin',
  ip,
  idempotencyKey,
}) {
  const b = orders.getBeneficiary(beneficiaryId);
  if (!b) throw new Error('Beneficiario no encontrado.');
  if (!b.account_number || !b.bank_code) throw new Error('El beneficiario no tiene datos bancarios completos.');
  if (!['AR', 'BR', 'CL', 'EC', 'MX', 'PE', 'PY', 'UY'].includes(b.country)) {
    throw new Error('dLocal Go no habilita payouts para este país. Usa BRE-B / Pago Móvil.');
  }

  const feeCents = pricing.payoutFee(amountCents);
  const total = amountCents + feeCents;
  const available = ledger.balance(ledger.ACCOUNTS.MERCHANT_AVAILABLE, currency);
  if (total > available) throw new Error(`Saldo insuficiente. Disponible: ${format(available, currency)}.`);

  const pid = publicId();
  const info = db
    .prepare(
      `INSERT INTO payouts (public_id, beneficiary_id, amount_cents, currency, country, flow_type, purpose,
        status, provider, idempotency_key, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'dlocalgo', ?, ?, ?)`
    )
    .run(
      pid,
      b.id,
      amountCents,
      currency,
      b.country,
      flowType,
      purpose,
      idempotencyKey || null,
      `Payout ${pid}`,
      JSON.stringify({ fee_cents: feeCents })
    );
  const payoutId = Number(info.lastInsertRowid);

  const [firstName, ...rest] = String(b.full_name).split(' ');
  const payload = {
    transfer_amount: toMajor(amountCents, currency),
    transfer_country: b.country,
    flow_type: flowType,
    purpose,
    beneficiary_first_name: firstName,
    beneficiary_last_name: rest.join(' ') || firstName,
    beneficiary_email: b.email || undefined,
    beneficiary_document: b.doc_number,
    beneficiary_document_type: b.doc_type === 'J' ? 'NIT' : 'CI',
    bank_code: b.bank_code,
    bank_account: b.account_number,
    bank_branch: b.bank_code,
    bank_account_type: b.account_type || 'CHECKING',
    currency_to_pay: currency,
    description: `Payout ${pid}`,
    notification_url: `${config.publicBaseUrl}/api/webhooks/dlocalgo`,
  };
  if (flowType === 'B2B') payload.business_name = businessName || b.full_name;

  try {
    const result = await dlocalgo.createPayout(payload);
    db.prepare(
      `UPDATE payouts SET status = ?, provider_ref = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      result.status,
      result.providerRef,
      JSON.stringify({ fee_cents: feeCents, provider_raw: result.raw }),
      payoutId
    );
    if (result.status === 'approved') {
      ledger.debitPayout({ payoutId, amountCents, feeCents, currency, description: `Payout ${pid}` });
    }
    audit({ actor, action: 'payout.dlocal', entity: 'payout', entityId: pid, ip, metadata: { amount: amountCents, currency } });
    return getPayout(payoutId);
  } catch (err) {
    db.prepare(
      `UPDATE payouts SET status = 'failed', metadata = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(JSON.stringify({ fee_cents: feeCents, error: err.message }), payoutId);
    throw new Error(`No se pudo crear el payout: ${err.message}`);
  }
}

/** Registra un beneficiario v2 en dLocal Go (para pagos recurrentes). */
async function createDlocalBeneficiary({ beneficiaryId, flowType = 'B2C', email }) {
  const b = orders.getBeneficiary(beneficiaryId);
  if (!b) throw new Error('Beneficiario no encontrado.');
  const [firstName, ...rest] = String(b.full_name).split(' ');
  const payload = {
    flow_type: flowType,
    first_name: firstName,
    last_name: rest.join(' ') || firstName,
    document: b.doc_number,
    document_type: b.doc_type === 'J' ? 'NIT' : 'CI',
    country: b.country,
    email: email || b.email || 'beneficiario@example.com',
    bank_account: {
      country: b.country,
      currency: DEST_CURRENCY[b.country],
      bank_code: b.bank_code,
      bank_account: b.account_number,
      bank_branch: b.bank_code,
      account_type: b.account_type || 'CHECKING',
    },
  };
  const result = await dlocalgo.createBeneficiary(payload);
  return result;
}


/**
 * Marca una entrega como pagada cuando el dueño la ejecuta por fuera (banco,
 * Pago Móvil, efectivo). Es dinero real: asienta el débito en el ledger y
 * cierra la orden asociada.
 */
function markPaid(publicIdValue, { reference, actor = 'admin', ip } = {}) {
  const row = db.prepare('SELECT * FROM payouts WHERE public_id = ?').get(publicIdValue);
  if (!row) throw new Error('Entrega no encontrada.');
  if (row.status === 'completed') return serialize(row);
  if (!['pending', 'processing', 'failed'].includes(row.status)) {
    throw new Error(`No se puede marcar como pagada una entrega en estado ${row.status}.`);
  }
  const meta = row.metadata ? JSON.parse(row.metadata) : {};
  const sourceCurrency = meta.source_currency || row.currency;
  const sourceAmount = Number(meta.source_amount_cents || row.amount_cents);
  const feeCents = Number(meta.fee_cents || 0);

  db.prepare(
    `UPDATE payouts SET status = 'completed', provider = 'manual', provider_ref = ?, metadata = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).run(
    reference || `MANUAL-${row.public_id}`,
    JSON.stringify({ ...meta, marked_paid_by: actor, marked_paid_at: new Date().toISOString(), manual_reference: reference || null }),
    row.id
  );

  ledger.debitPayout({
    payoutId: row.id,
    amountCents: sourceAmount,
    feeCents,
    currency: sourceCurrency,
    description: `Entrega manual ${row.public_id}`,
  });

  if (row.transaction_id) {
    db.prepare(`UPDATE transactions SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(
      row.transaction_id
    );
  }

  audit({
    actor,
    action: 'payout.mark_paid',
    entity: 'payout',
    entityId: row.public_id,
    ip,
    metadata: { reference: reference || null, amount: sourceAmount, currency: sourceCurrency },
  });
  return getPayout(row.id);
}

module.exports = {
  markPaid,
  createInstantPayout,
  createDlocalPayout,
  createDlocalBeneficiary,
  listPayouts,
  getPayout,
  serialize,
};
