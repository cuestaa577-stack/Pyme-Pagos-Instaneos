'use strict';
const crypto = require('crypto');
const config = require('../config');

class ProviderError extends Error {
  constructor(message, { status = 0, code = null, body = null, auth = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.auth = auth;
  }
}

/**
 * dLocal Go sólo opera de verdad cuando están las tres credenciales.
 * Sin ellas no existe ningún modo simulado: la vía se oculta y el cobro
 * se hace por transferencia con comprobante.
 */
function isLive() {
  return Boolean(config.dlocalgo.apiUrl && config.dlocalgo.apiKey && config.dlocalgo.apiSecret);
}

function authHeader() {
  return `Bearer ${config.dlocalgo.apiKey}:${config.dlocalgo.apiSecret}`;
}

async function request(method, path, body, { headers = {}, timeoutMs } = {}) {
  if (!config.dlocalgo.apiKey || !config.dlocalgo.apiSecret) {
    throw new ProviderError('dLocal Go no está configurado', { auth: true, code: 3001 });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || config.dlocalgo.timeoutMs);
  try {
    const res = await fetch(`${config.dlocalgo.apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const auth = res.status === 401 || res.status === 403 || data?.code === 3001;
      throw new ProviderError(data?.message || `Error ${res.status} de dLocal Go`, {
        status: res.status,
        code: data?.code || null,
        body: data,
        auth,
      });
    }
    return data;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err.name === 'AbortError') {
      throw new ProviderError('Tiempo de espera agotado con dLocal Go', { code: 'TIMEOUT' });
    }
    throw new ProviderError(`No se pudo conectar con dLocal Go: ${err.message}`, { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
}

const STATUS_MAP = {
  APPROVED: 'approved',
  PAID: 'approved',
  SUCCESS: 'approved',
  COMPLETED: 'approved',
  SETTLED: 'approved',
  AUTHORIZED: 'authorized',
  PENDING: 'pending',
  PROCESSING: 'processing',
  IN_PROGRESS: 'processing',
  ON_HOLD: 'on_hold',
  REJECTED: 'declined',
  DECLINED: 'declined',
  FAILED: 'failed',
  ERROR: 'failed',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled',
  EXPIRED: 'cancelled',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
};

function normalizeStatus(status) {
  if (!status) return 'pending';
  return STATUS_MAP[String(status).toUpperCase()] || String(status).toLowerCase();
}

function normalizePayment(data) {
  if (!data) return null;
  return {
    providerRef: data.id || data.payment_id || null,
    status: normalizeStatus(data.status),
    rawStatus: data.status || null,
    checkoutUrl: data.redirect_url || null,
    checkoutToken: data.merchant_checkout_token || null,
    amount: data.amount ?? null,
    currency: data.currency || null,
    orderId: data.order_id || null,
    direct: Boolean(data.direct),
    raw: data,
  };
}

async function createPayment(payload) {
  const data = await request('POST', '/v1/payments', payload);
  return normalizePayment(data);
}

async function confirmPayment(checkoutToken, payload) {
  const data = await request('POST', `/v1/payments/confirm/${encodeURIComponent(checkoutToken)}`, payload);
  return { ...normalizePayment(data), redirectUrl: data?.redirect_url || null, raw: data };
}

async function createRecurringCharge(checkoutToken, amount) {
  const data = await request('POST', `/v1/payments/recurring/${encodeURIComponent(checkoutToken)}`, { amount });
  return normalizePayment(data);
}

async function createRefund({ paymentId, amount, notificationUrl }) {
  const body = { payment_id: paymentId };
  if (amount !== undefined) body.amount = amount;
  if (notificationUrl) body.notification_url = notificationUrl;
  const data = await request('POST', '/v1/refunds', body);
  return {
    providerRef: data?.id || null,
    status: normalizeStatus(data?.status),
    raw: data,
  };
}

async function createPayout(payload) {
  const data = await request('POST', '/v1/payouts', payload);
  return {
    providerRef: data?.payout_id || data?.id || null,
    status: normalizeStatus(data?.status),
    raw: data,
  };
}

async function retrievePayout(payoutId) {
  const data = await request('GET', `/v1/payouts/${encodeURIComponent(payoutId)}`);
  return { providerRef: data?.payout_id || data?.id || payoutId, status: normalizeStatus(data?.status), raw: data };
}

async function cancelPayout(payoutId) {
  const data = await request('POST', `/v1/payouts/${encodeURIComponent(payoutId)}/cancel`, {});
  return { status: normalizeStatus(data?.status), raw: data };
}

async function createBeneficiary(payload) {
  const data = await request('POST', '/v2/beneficiaries', payload);
  return {
    providerRef: data?.beneficiary_id || data?.id || null,
    status: normalizeStatus(data?.status),
    validationUrl: data?.validation_url || data?.proof_of_life_url || null,
    raw: data,
  };
}

async function createPayoutV2(payload, idempotencyKey) {
  const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
  const data = await request('POST', '/v2/payouts', payload, { headers });
  return {
    providerRef: data?.payout_id || data?.id || null,
    status: normalizeStatus(data?.status),
    raw: data,
  };
}

async function listSettlementAccounts() {
  return request('GET', '/v1/settlements/accounts');
}

async function createSettlement(payload) {
  return request('POST', '/v1/settlements', payload);
}

async function retrieveSettlement(id) {
  return request('GET', `/v1/settlements/${encodeURIComponent(id)}`);
}

/** Verifica la firma HMAC-SHA256 de un webhook de dLocal Go. */
function verifyWebhookSignature(rawBody, authorizationHeader) {
  if (!config.dlocalgo.webhookSecret) return { valid: false, reason: 'WEBHOOK_SECRET_NOT_CONFIGURED' };
  if (!authorizationHeader) return { valid: false, reason: 'MISSING_AUTHORIZATION' };
  const match = String(authorizationHeader).match(/Signature:\s*([a-f0-9]+)/i);
  if (!match) return { valid: false, reason: 'MALFORMED_SIGNATURE' };
  const expected = crypto
    .createHmac('sha256', config.dlocalgo.webhookSecret)
    .update(`${config.dlocalgo.apiKey}${rawBody}`)
    .digest('hex');
  const received = match[1].toLowerCase();
  const valid =
    expected.length === received.length &&
    crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  return { valid, expected };
}

module.exports = {
  ProviderError,
  isLive,
  request,
  normalizeStatus,
  normalizePayment,
  createPayment,
  confirmPayment,
  createRecurringCharge,
  createRefund,
  createPayout,
  retrievePayout,
  cancelPayout,
  createBeneficiary,
  createPayoutV2,
  listSettlementAccounts,
  createSettlement,
  retrieveSettlement,
  verifyWebhookSignature,
};
