'use strict';
const crypto = require('crypto');
const express = require('express');
const { db, audit } = require('../db');
const orders = require('../services/orders');
const ledger = require('../services/ledger');
const dlocalgo = require('../providers/dlocalgo');
const config = require('../config');

const router = express.Router();

function recordEvent({ source, eventId, signatureValid, payload, status = 'received', error = null }) {
  try {
    const info = db
      .prepare(
        `INSERT INTO webhook_events (source, event_id, signature_valid, status, payload, error, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 'processed' THEN datetime('now') ELSE NULL END)`
      )
      .run(source, eventId || null, signatureValid ? 1 : 0, status, JSON.stringify(payload), error, status);
    return Number(info.lastInsertRowid);
  } catch (err) {
    // Violación del índice único => evento ya procesado (idempotencia).
    return null;
  }
}

function pick(obj, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

/**
 * Notificaciones de dLocal Go. Se verifica la firma HMAC sobre el cuerpo crudo
 * y se procesa de forma idempotente por event_id.
 */
router.post('/dlocalgo', async (req, res) => {
  const raw = req.rawBody || JSON.stringify(req.body || {});
  const signature = dlocalgo.verifyWebhookSignature(raw, req.headers.authorization);
  const payload = req.body || {};
  const eventId = String(
    pick(payload, ['id', 'event_id', 'data.id', 'payment_id', 'data.payment_id', 'payout_id', 'data.payout_id']) ||
      `sha-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`
  );

  if (!signature.valid) {
    recordEvent({ source: 'dlocalgo', eventId, signatureValid: false, payload, status: 'rejected', error: signature.reason });
    return res.status(401).json({ error: 'Firma inválida.', reason: signature.reason });
  }

  const existing = db.prepare('SELECT id FROM webhook_events WHERE source = ? AND event_id = ?').get('dlocalgo', eventId);
  if (existing) return res.json({ ok: true, duplicated: true });

  const eventRowId = recordEvent({ source: 'dlocalgo', eventId, signatureValid: true, payload, status: 'processing' });

  try {
    const status = pick(payload, ['status', 'data.status', 'payment.status']);
    const providerRef = pick(payload, [
      'payment_id',
      'data.payment_id',
      'data.id',
      'payout_id',
      'data.payout_id',
      'id',
    ]);
    const orderRef = pick(payload, ['external_reference', 'data.external_reference', 'order_id', 'data.order_id', 'reference']);
    const kind = String(pick(payload, ['type', 'event', 'event_type', 'data.type']) || '').toLowerCase();

    let transaction = null;
    if (orderRef) transaction = db.prepare('SELECT * FROM transactions WHERE order_id = ? OR public_id = ?').get(orderRef, orderRef);
    if (!transaction && providerRef) {
      transaction = db.prepare('SELECT * FROM transactions WHERE provider_ref = ?').get(String(providerRef));
    }

    if (transaction && !kind.includes('payout')) {
      await orders.settlePayment(transaction.public_id, {
        status: status || 'PENDING',
        providerRef: providerRef ? String(providerRef) : null,
        source: 'webhook:dlocalgo',
        raw: payload,
      });
    } else if (providerRef) {
      const payout = db.prepare('SELECT * FROM payouts WHERE provider_ref = ?').get(String(providerRef));
      if (payout) {
        const normalized = dlocalgo.normalizeStatus(status) || payout.status;
        db.prepare(`UPDATE payouts SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(normalized, payout.id);
        const alreadyDebited = db
          .prepare('SELECT 1 FROM ledger_entries WHERE payout_id = ? AND account = ? LIMIT 1')
          .get(payout.id, ledger.ACCOUNTS.PAYOUTS_OUT);
        if (normalized === 'approved' && !alreadyDebited) {
          const meta = payout.metadata ? JSON.parse(payout.metadata) : {};
          ledger.debitPayout({
            payoutId: payout.id,
            amountCents: payout.amount_cents,
            feeCents: Number(meta.fee_cents || 0),
            currency: payout.currency,
            description: `Payout ${payout.public_id}`,
          });
        }
      }
    }

    db.prepare(`UPDATE webhook_events SET status = 'processed', processed_at = datetime('now') WHERE id = ?`).run(eventRowId);
    audit({ actor: 'webhook', action: 'webhook.dlocalgo', entity: 'webhook', entityId: eventId, metadata: { status, providerRef } });
    res.json({ ok: true });
  } catch (err) {
    db.prepare(`UPDATE webhook_events SET status = 'error', error = ? WHERE id = ?`).run(err.message, eventRowId);
    res.status(500).json({ error: 'No se pudo procesar la notificación.' });
  }
});

/** Notificaciones BRE-B (transferencias instantáneas). */
router.post('/breb', async (req, res) => {
  const payload = req.body || {};
  const eventId = String(pick(payload, ['id', 'event_id', 'tracking_code', 'reference']) || `breb-${Date.now()}`);
  const existing = db.prepare('SELECT id FROM webhook_events WHERE source = ? AND event_id = ?').get('breb', eventId);
  if (existing) return res.json({ ok: true, duplicated: true });
  const rowId = recordEvent({ source: 'breb', eventId, signatureValid: true, payload, status: 'processing' });

  try {
    const reference = pick(payload, ['reference', 'public_id', 'metadata.reference']);
    const providerRef = pick(payload, ['provider_ref', 'transfer_id', 'id']);
    const status = String(pick(payload, ['status', 'state']) || '').toLowerCase();
    const normalized = ['completed', 'approved', 'success', 'succeeded'].includes(status)
      ? 'completed'
      : ['failed', 'rejected', 'error'].includes(status)
        ? 'failed'
        : 'processing';

    const withdrawal = reference
      ? db.prepare('SELECT * FROM withdrawals WHERE public_id = ?').get(reference)
      : providerRef
        ? db.prepare('SELECT * FROM withdrawals WHERE provider_ref = ?').get(providerRef)
        : null;

    if (withdrawal) {
      db.prepare(`UPDATE withdrawals SET status = ?, provider_ref = COALESCE(?, provider_ref), updated_at = datetime('now') WHERE id = ?`).run(
        normalized,
        providerRef || null,
        withdrawal.id
      );
      if (normalized === 'completed' && withdrawal.status !== 'completed') {
        ledger.debitWithdrawal({
          withdrawalId: withdrawal.id,
          amountCents: withdrawal.amount_cents,
          feeCents: withdrawal.fee_cents,
          currency: withdrawal.currency,
          description: `Retiro ${withdrawal.public_id} vía BRE-B`,
        });
      }
    }

    db.prepare(`UPDATE webhook_events SET status = 'processed', processed_at = datetime('now') WHERE id = ?`).run(rowId);
    res.json({ ok: true });
  } catch (err) {
    db.prepare(`UPDATE webhook_events SET status = 'error', error = ? WHERE id = ?`).run(err.message, rowId);
    res.status(500).json({ error: 'No se pudo procesar la notificación BRE-B.' });
  }
});


/**
 * Notificaciones del agregador venezolano (Pago Móvil / transferencia / efectivo).
 * Firma opcional HMAC-SHA256 con VE_API_KEY en `x-ve-signature`.
 */
router.post('/vepay', async (req, res) => {
  const raw = req.rawBody || JSON.stringify(req.body || {});
  const payload = req.body || {};
  let signatureValid = true;
  if (config.vepay.apiKey && req.headers['x-ve-signature']) {
    const expected = crypto.createHmac('sha256', config.vepay.apiKey).update(raw).digest('hex');
    signatureValid = expected === String(req.headers['x-ve-signature']);
  }
  const eventId = String(
    pick(payload, ['id', 'event_id', 'provider_ref', 'tracking_code', 'reference']) ||
      `ve-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`
  );

  if (!signatureValid) {
    recordEvent({ source: 'vepay', eventId, signatureValid: false, payload, status: 'rejected', error: 'Firma inválida.' });
    return res.status(401).json({ error: 'Firma inválida.' });
  }
  const existing = db.prepare('SELECT id FROM webhook_events WHERE source = ? AND event_id = ?').get('vepay', eventId);
  if (existing) return res.json({ ok: true, duplicated: true });
  const rowId = recordEvent({ source: 'vepay', eventId, signatureValid: true, payload, status: 'processing' });

  try {
    const reference = pick(payload, ['reference', 'public_id', 'order_id', 'metadata.reference']);
    const providerRef = pick(payload, ['provider_ref', 'id', 'payment_id', 'payout_id']);
    const rawStatus = String(pick(payload, ['status', 'state']) || '').toLowerCase();
    const normalized = ['completed', 'approved', 'success', 'succeeded', 'paid'].includes(rawStatus)
      ? 'approved'
      : ['failed', 'rejected', 'error', 'cancelled'].includes(rawStatus)
        ? 'rejected'
        : null;

    const transaction = reference
      ? db.prepare('SELECT * FROM transactions WHERE order_id = ? OR public_id = ?').get(reference, reference)
      : providerRef
        ? db.prepare('SELECT * FROM transactions WHERE provider_ref = ?').get(String(providerRef))
        : null;

    if (transaction && normalized) {
      await orders.settlePayment(transaction.public_id, {
        status: normalized,
        providerRef: providerRef ? String(providerRef) : null,
        source: 'webhook:vepay',
        raw: payload,
      });
    } else if (reference) {
      const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE public_id = ?').get(reference);
      if (withdrawal && normalized) {
        const status = normalized === 'approved' ? 'completed' : 'failed';
        db.prepare(
          `UPDATE withdrawals SET status = ?, provider_ref = COALESCE(?, provider_ref), updated_at = datetime('now') WHERE id = ?`
        ).run(status, providerRef || null, withdrawal.id);
        if (status === 'completed' && withdrawal.status !== 'completed') {
          ledger.debitWithdrawal({
            withdrawalId: withdrawal.id,
            amountCents: withdrawal.amount_cents,
            feeCents: withdrawal.fee_cents,
            currency: withdrawal.currency,
            description: `Retiro ${withdrawal.public_id} vía Pago Móvil / banco VE`,
          });
        }
      }
    }

    db.prepare(`UPDATE webhook_events SET status = 'processed', processed_at = datetime('now') WHERE id = ?`).run(rowId);
    audit({ actor: 'webhook', action: 'webhook.vepay', entity: 'webhook', entityId: eventId, metadata: { normalized, providerRef } });
    res.json({ ok: true });
  } catch (err) {
    db.prepare(`UPDATE webhook_events SET status = 'error', error = ? WHERE id = ?`).run(err.message, rowId);
    res.status(500).json({ error: 'No se pudo procesar la notificación VE.' });
  }
});

/** Retorno del usuario desde el banco (PSE). */
async function pseReturn(req, res) {
  const reference = req.query.reference || req.body?.reference || req.body?.reference_id;
  const status = String(req.query.status || req.body?.status || '').toUpperCase();
  const order = reference ? orders.getOrder(reference) : null;
  if (order && ['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
    await orders.settlePayment(order.public_id, { status, source: 'pse:return', raw: { ...req.query, ...req.body } });
  }
  const target = order ? `/success/${order.public_id}` : '/';
  res.redirect(target);
}

router.get('/pse/return', (req, res, next) => pseReturn(req, res).catch(next));
router.post('/pse/return', (req, res, next) => pseReturn(req, res).catch(next));

module.exports = router;
