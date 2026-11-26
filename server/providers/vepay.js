'use strict';

/**
 * Adaptador de cobros y pagos en Venezuela (bolívares, VES).
 *
 * Cubre los tres rieles que usa el mercado venezolano:
 *   - Pago Móvil (débito inmediato entre bancos, 24/7)
 *   - Transferencia bancaria (mismo banco / interbancaria)
 *   - Efectivo (taquilla / agente, con código de pago)
 *
 * Contrato real (cuando VE_MODE=live y hay credenciales):
 *   POST {VE_API_URL}/collections  -> crea una intención de cobro
 *   POST {VE_API_URL}/payouts      -> ordena un pago al beneficiario
 *   POST {VE_API_URL}/verify       -> verifica una referencia
 *
 * Sin credenciales opera en modo simulador, con referencias y códigos
 * deterministas para poder probar todo el flujo de punta a punta.
 */

const crypto = require('crypto');
const config = require('../config');
const { toMinor, toMajor } = require('../lib/money');

function mode() {
  return (config.vepay?.mode || 'auto').toLowerCase();
}

function isLive() {
  const m = mode();
  if (m === 'live') return true;
  if (m === 'simulator' || m === 'demo') return false;
  return Boolean(config.vepay?.apiUrl && config.vepay?.apiKey);
}

const RAILS = {
  pago_movil_ve: 'Pago Móvil',
  transfer_ve: 'Transferencia bancaria',
  cash_ve: 'Efectivo',
};

/** Bancos venezolanos con su código de 4 dígitos (SUDEBAN). */
const BANKS = [
  { code: '0102', name: 'Banco de Venezuela' },
  { code: '0104', name: 'Venezolano de Crédito' },
  { code: '0105', name: 'Mercantil' },
  { code: '0108', name: 'BBVA Provincial' },
  { code: '0114', name: 'Bancaribe' },
  { code: '0115', name: 'Banco Exterior' },
  { code: '0128', name: 'Banco Caroní' },
  { code: '0134', name: 'Banesco' },
  { code: '0137', name: 'Banco Sofitasa' },
  { code: '0138', name: 'Banco Plaza' },
  { code: '0146', name: 'Bangente' },
  { code: '0151', name: 'Banco Fondo Común (BFC)' },
  { code: '0156', name: '100% Banco' },
  { code: '0157', name: 'DelSur' },
  { code: '0163', name: 'Banco del Tesoro' },
  { code: '0166', name: 'Banco Agrícola de Venezuela' },
  { code: '0168', name: 'Bancrecer' },
  { code: '0169', name: 'Mi Banco' },
  { code: '0171', name: 'Banco Activo' },
  { code: '0172', name: 'Bancamiga' },
  { code: '0174', name: 'Banplus' },
  { code: '0175', name: 'Banco Bicentenario' },
  { code: '0177', name: 'Banfanb' },
  { code: '0191', name: 'Banco Nacional de Crédito (BNC)' },
];

function normalizeRail(rail) {
  const r = String(rail || '').toLowerCase();
  if (r === 'pago_movil' || r === 'pago_movil_ve' || r === 'pm') return 'pago_movil_ve';
  if (r === 'transfer' || r === 'transfer_ve' || r === 'transferencia' || r === 'bank') return 'transfer_ve';
  if (r === 'cash' || r === 'cash_ve' || r === 'efectivo') return 'cash_ve';
  return null;
}

function validatePhone(value) {
  const raw = String(value || '').replace(/[^\d+]/g, '');
  let digits = raw;
  if (digits.startsWith('+58')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('58') && digits.length > 10) digits = `0${digits.slice(2)}`;
  if (!/^04(12|14|16|24|26)\d{7}$/.test(digits)) {
    return { valid: false, error: 'Teléfono venezolano inválido (formato 04xx-xxxxxxx).' };
  }
  return { valid: true, normalized: digits };
}

function validateBank(code) {
  const found = BANKS.find((b) => b.code === String(code || ''));
  if (!found) return { valid: false, error: 'Banco venezolano inválido.' };
  return { valid: true, bank: found };
}

function reference(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function call(path, body) {
  const url = `${config.vepay.apiUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config.vepay.timeoutMs || 15000));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.vepay.apiKey}`,
        'x-merchant-id': config.vepay.merchantDocument || '',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(json?.message || `Proveedor VE respondió ${res.status}`);
      err.status = res.status;
      err.auth = res.status === 401 || res.status === 403;
      err.body = json;
      throw err;
    }
    return json || {};
  } finally {
    clearTimeout(timer);
  }
}

function merchantInfo(settings = null) {
  const s = settings || {};
  return {
    name: s.ve_merchant_name || config.vepay?.merchantName || config.appName,
    document: s.ve_merchant_document || config.vepay?.merchantDocument || '',
    phone: s.ve_merchant_phone || config.vepay?.merchantPhone || '',
    bank: s.ve_merchant_bank || config.vepay?.merchantBank || '',
    account: s.ve_merchant_account || config.vepay?.merchantAccount || '',
  };
}

/**
 * Crea una intención de cobro en bolívares.
 * Devuelve instrucciones listas para mostrarle al pagador.
 */
async function createCollection({
  amountCents,
  currency = 'VES',
  rail,
  reference: ref,
  payerName,
  payerDocument,
  payerPhone,
  bankCode,
  description,
} = {}) {
  const normalizedRail = normalizeRail(rail) || 'pago_movil_ve';
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Monto inválido.');
  const amount = toMajor(amountCents, currency);
  const referenceValue = ref || reference('VEC');

  const base = {
    rail: normalizedRail,
    rail_label: RAILS[normalizedRail],
    amount,
    currency,
    reference: referenceValue,
    description: description || 'Cobro en Venezuela',
    merchant: merchantInfo(),
  };

  if (!isLive()) {
    const code = String(Math.floor(100000 + Math.random() * 899999));
    return {
      provider: 'vepay_simulator',
      providerRef: reference('VE-SIM'),
      status: 'pending',
      instant: true,
      redirectUrl: `/pay/ve/${referenceValue}`,
      paymentCode: code,
      instructions: { ...base, payment_code: code },
      raw: { simulated: true },
    };
  }

  const payload = {
    amount,
    currency,
    rail: normalizedRail,
    reference: referenceValue,
    description: base.description,
    payer: {
      name: payerName || null,
      document: payerDocument || null,
      phone: payerPhone || null,
      bank_code: bankCode || null,
    },
    merchant: merchantInfo(),
    callback_url: `${config.publicBaseUrl}/api/webhooks/vepay`,
  };
  const res = await call('/collections', payload);
  return {
    provider: 'vepay',
    providerRef: res.id || res.reference || reference('VE'),
    status: res.status || 'pending',
    instant: true,
    redirectUrl: res.redirect_url || res.checkout_url || `/pay/ve/${referenceValue}`,
    paymentCode: res.payment_code || null,
    instructions: { ...base, payment_code: res.payment_code || null, raw: res },
    raw: res,
  };
}

/**
 * Ordena un pago (retiro / entrega a beneficiario) en bolívares.
 */
async function sendPayout({
  amountCents,
  currency = 'VES',
  rail = 'pago_movil_ve',
  reference: ref,
  beneficiaryName,
  beneficiaryDocument,
  phone,
  bankCode,
  description,
} = {}) {
  const normalizedRail = normalizeRail(rail) || 'pago_movil_ve';
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Monto inválido.');
  const amount = toMajor(amountCents, currency);
  const referenceValue = ref || reference('VEP');

  if (normalizedRail === 'pago_movil_ve') {
    const phoneCheck = validatePhone(phone);
    if (!phoneCheck.valid) throw new Error(phoneCheck.error);
  }
  if (normalizedRail === 'transfer_ve' && !bankCode) {
    throw new Error('Selecciona el banco destino.');
  }

  if (!isLive()) {
    return {
      provider: 'vepay_simulator',
      providerRef: reference('VEP-SIM'),
      status: 'completed',
      instant: true,
      trackingCode: reference('VETRK'),
      amount,
      currency,
      rail: normalizedRail,
      raw: { simulated: true, reference: referenceValue },
    };
  }

  const payload = {
    amount,
    currency,
    rail: normalizedRail,
    reference: referenceValue,
    description: description || 'Pago en Venezuela',
    beneficiary: {
      name: beneficiaryName || null,
      document: beneficiaryDocument || null,
      phone: phone || null,
      bank_code: bankCode || null,
    },
    callback_url: `${config.publicBaseUrl}/api/webhooks/vepay`,
  };
  const res = await call('/payouts', payload);
  return {
    provider: 'vepay',
    providerRef: res.id || res.reference || reference('VEP'),
    status: res.status || 'processing',
    instant: Boolean(res.instant),
    trackingCode: res.tracking_code || null,
    amount,
    currency,
    rail: normalizedRail,
    raw: res,
  };
}

async function verify(referenceValue) {
  if (!isLive()) {
    return { provider: 'vepay_simulator', reference: referenceValue, status: 'completed' };
  }
  const res = await call('/verify', { reference: referenceValue });
  return { provider: 'vepay', reference: referenceValue, status: res.status || 'pending', raw: res };
}

module.exports = {
  mode,
  isLive,
  RAILS,
  BANKS,
  normalizeRail,
  validatePhone,
  validateBank,
  createCollection,
  sendPayout,
  verify,
  merchantInfo,
  toMinor,
};
