'use strict';
const crypto = require('crypto');
const { db, getSettings, audit } = require('../db');
const { format, exponent } = require('../lib/money');
const pricing = require('./pricing');
const ledger = require('./ledger');
const breb = require('../providers/breb');
const vepay = require('../providers/vepay');

function publicId() {
  return `WD-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function serialize(row) {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    amount_formatted: format(row.amount_cents, row.currency),
    fee_formatted: format(row.fee_cents, row.currency),
    total_formatted: format(row.amount_cents + row.fee_cents, row.currency),
  };
}

/**
 * Retiro instantáneo del saldo de la plataforma a una cuenta propia vía BRE-B.
 * El asiento contable se hace en la moneda de origen; el envío BRE-B se hace
 * en COP (si el origen es USD se aplica la tasa configurada).
 */
async function createWithdrawal({
  amountCents,
  currency = 'COP',
  keyType,
  keyValue,
  destinationName,
  bankName,
  rail,
  phone,
  bankCode,
  actor = 'admin',
  ip,
  idempotencyKey,
}) {
  const settings = getSettings();
  const isVes = currency === 'VES';
  const min = isVes ? 50000 : Number(settings.min_withdrawal_cents || 500);
  if (!Number.isInteger(amountCents) || amountCents < min) {
    throw new Error(`El retiro mínimo es ${(min / 10 ** exponent(currency)).toFixed(exponent(currency))} ${currency}.`);
  }

  let key;
  let veRail = null;
  if (isVes) {
    veRail = vepay.normalizeRail(rail) || 'pago_movil_ve';
    if (veRail === 'pago_movil_ve') {
      key = vepay.validatePhone(phone || keyValue);
      if (!key.valid) throw new Error(key.error);
    } else if (veRail === 'transfer_ve') {
      if (!vepay.validateBank(bankCode).valid) throw new Error('Selecciona el banco destino.');
      if (!keyValue || String(keyValue).length < 6) throw new Error('Ingresa el número de cuenta destino.');
      key = { valid: true, normalized: String(keyValue).trim(), type: 'account' };
    } else {
      key = { valid: true, normalized: String(keyValue || phone || '').trim(), type: 'cash' };
    }
  } else {
    key = breb.validateKey(keyType, keyValue);
    if (!key.valid) throw new Error(key.error);
  }

  if (idempotencyKey) {
    const existing = db
      .prepare('SELECT * FROM withdrawals WHERE idempotency_key = ?')
      .get(idempotencyKey);
    if (existing) return serialize(existing);
  }

  const feeCents = pricing.withdrawalFee(amountCents);
  const total = amountCents + feeCents;
  const available = ledger.balance(ledger.ACCOUNTS.MERCHANT_AVAILABLE, currency);
  if (total > available) {
    throw new Error(`Saldo insuficiente. Disponible: ${format(available, currency)}.`);
  }

  const destinationCurrency = isVes ? 'VES' : 'COP';
  const destinationCents =
    currency === destinationCurrency
      ? amountCents
      : pricing.convertMinor(amountCents, currency, destinationCurrency);
  const railValue = isVes ? veRail : 'breb';
  const providerName = isVes
    ? vepay.isLive()
      ? 'vepay'
      : 'vepay_simulator'
    : breb.isLive()
      ? 'breb'
      : 'breb_simulator';
  const pid = publicId();
  const info = db
    .prepare(
      `INSERT INTO withdrawals (public_id, amount_cents, fee_cents, currency, rail, destination_key,
        destination_name, bank_name, status, provider, idempotency_key, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`
    )
    .run(
      pid,
      amountCents,
      feeCents,
      currency,
      railValue,
      key.normalized,
      destinationName || null,
      bankName || null,
      providerName,
      idempotencyKey || null,
      JSON.stringify({
        key_type: key.type,
        destination_amount_cents: destinationCents,
        destination_currency: destinationCurrency,
        bank_code: bankCode || null,
      })
    );
  const withdrawalId = Number(info.lastInsertRowid);

  try {
    const transfer = isVes
      ? await vepay.sendPayout({
          amountCents: destinationCents,
          currency: 'VES',
          rail: veRail,
          reference: pid,
          beneficiaryName: destinationName || 'Titular de la cuenta',
          beneficiaryDocument: key.type === 'cedula' ? key.normalized : undefined,
          phone: phone || (veRail === 'pago_movil_ve' ? key.normalized : undefined),
          bankCode,
          description: `Retiro ${pid} - ${settings.support_email || 'RemesaYa'}`,
        })
      : await breb.sendTransfer({
          amountCents: destinationCents,
          currency: 'COP',
          keyType: key.type,
          keyValue: key.normalized,
          beneficiaryName: destinationName || 'Titular de la cuenta',
          documentType: 'CC',
          documentNumber: key.type === 'cedula' ? key.normalized : undefined,
          reference: pid,
          description: `Retiro ${pid} - ${settings.support_email || 'RemesaYa'}`,
        });

    const completed = transfer.status === 'completed';
    db.prepare(
      `UPDATE withdrawals SET status = ?, provider = ?, provider_ref = ?, tracking_code = ?,
       completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END,
       metadata = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      completed ? 'completed' : transfer.status,
      transfer.provider,
      transfer.providerRef,
      transfer.trackingCode,
      completed ? 'completed' : 'processing',
      JSON.stringify({
        key_type: key.type,
        destination_amount_cents: destinationCents,
        destination_currency: destinationCurrency,
        bank_code: bankCode || null,
        provider_raw: transfer.raw,
      }),
      withdrawalId
    );

    if (completed) {
      ledger.debitWithdrawal({
        withdrawalId,
        amountCents,
        feeCents,
        currency,
        description: `Retiro ${pid} vía ${isVes ? 'Pago Móvil / banco VE' : 'BRE-B'}`,
      });
    }

    audit({
      actor,
      action: 'withdrawal.create',
      entity: 'withdrawal',
      entityId: pid,
      ip,
      metadata: { amount: amountCents, fee: feeCents, currency, rail: railValue, status: transfer.status, key_type: key.type },
    });

    return serialize(db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId));
  } catch (err) {
    db.prepare(
      `UPDATE withdrawals SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(err.message, withdrawalId);
    audit({
      actor,
      action: 'withdrawal.failed',
      entity: 'withdrawal',
      entityId: pid,
      ip,
      metadata: { error: err.message },
    });
    throw new Error(`No se pudo completar el retiro: ${err.message}`);
  }
}

function listWithdrawals({ limit = 50, offset = 0 } = {}) {
  const rows = db.prepare('SELECT * FROM withdrawals ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM withdrawals').get().n;
  return { total, items: rows.map(serialize) };
}

function getWithdrawal(publicIdValue) {
  const row = db.prepare('SELECT * FROM withdrawals WHERE public_id = ?').get(publicIdValue);
  return row ? serialize(row) : null;
}

module.exports = { createWithdrawal, listWithdrawals, getWithdrawal, serialize };
