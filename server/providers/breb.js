'use strict';
const crypto = require('crypto');
const config = require('../config');
const { toMajor, toMinor } = require('../lib/money');
const cedula = require('../lib/cedula');

/**
 * Adaptador BRE-B (Banco de la República de Colombia).
 *
 * BRE-B es el sistema de pagos instantáneos de Colombia. La participación se
 * hace a través de una entidad financiera o agregador autorizado; este
 * adaptador implementa el contrato REST que debe exponer ese participante.
 *
 * Contrato esperado del participante:
 *   POST {BREB_API_URL}/transfers
 *   Authorization: Bearer {BREB_API_KEY}
 *   X-Participant-Id: {BREB_PARTICIPANT_ID}
 *   {
 *     amount, currency: "COP", key_type, key_value,
 *     beneficiary: { name, document_type, document },
 *     reference, description, callback_url
 *   }
 *   -> { transfer_id, status, tracking_code }
 *
 * Si no hay participante configurado, el modo `auto` usa el simulador para
 * que el flujo completo sea operable en desarrollo.
 */

function mode() {
  if (config.breb.mode === 'simulator') return 'simulator';
  if (config.breb.mode === 'live') return 'live';
  return config.breb.apiUrl && config.breb.apiKey ? 'live' : 'simulator';
}

function isLive() {
  return mode() === 'live';
}

const KEY_TYPES = {
  cedula: 'Cédula',
  phone: 'Teléfono',
  email: 'Correo',
  alphanumeric: 'Llave alfanumérica',
};

function normalizeKeyType(type) {
  const t = String(type || '').toLowerCase();
  if (['cedula', 'document', 'cc', 'cedula_ciudadania'].includes(t)) return 'cedula';
  if (['phone', 'telefono', 'celular', 'movil'].includes(t)) return 'phone';
  if (['email', 'correo'].includes(t)) return 'email';
  if (['alphanumeric', 'alfanumerica', 'llave', 'key'].includes(t)) return 'alphanumeric';
  return null;
}

function validateKey(type, value) {
  const t = normalizeKeyType(type);
  if (!t) return { valid: false, error: 'Tipo de llave BRE-B inválido.' };
  const v = String(value || '').trim();
  if (!v) return { valid: false, error: 'La llave BRE-B es obligatoria.' };

  if (t === 'cedula') {
    const r = cedula.validate(v);
    if (!r.valid) return { valid: false, error: r.error };
    return { valid: true, type: t, normalized: r.normalized, label: KEY_TYPES[t] };
  }
  if (t === 'phone') {
    const digits = v.replace(/[^\d+]/g, '');
    if (!/^\+?\d{10,15}$/.test(digits)) {
      return { valid: false, error: 'Teléfono inválido. Usa formato internacional, ej. +573001234567.' };
    }
    return { valid: true, type: t, normalized: digits, label: KEY_TYPES[t] };
  }
  if (t === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return { valid: false, error: 'Correo inválido.' };
    return { valid: true, type: t, normalized: v.toLowerCase(), label: KEY_TYPES[t] };
  }
  if (!/^[A-Za-z0-9._@-]{4,40}$/.test(v)) {
    return { valid: false, error: 'Llave alfanumérica inválida (4 a 40 caracteres).' };
  }
  return { valid: true, type: t, normalized: v, label: KEY_TYPES[t] };
}

async function sendTransfer({
  amountCents,
  currency = config.breb.currency,
  keyType,
  keyValue,
  beneficiaryName,
  documentType,
  documentNumber,
  reference,
  description,
}) {
  const key = validateKey(keyType, keyValue);
  if (!key.valid) throw new Error(key.error);

  if (!isLive()) {
    const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    return {
      provider: 'breb_simulator',
      providerRef: `BREB-SIM-${suffix}`,
      status: 'completed',
      trackingCode: `BREB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${suffix}`,
      instant: true,
      raw: {
        simulated: true,
        amount: toMajor(amountCents, currency),
        currency,
        key_type: key.type,
        key_value: key.normalized,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.breb.timeoutMs);
  try {
    const res = await fetch(`${config.breb.apiUrl}/transfers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.breb.apiKey}`,
        'X-Participant-Id': config.breb.participantId,
      },
      body: JSON.stringify({
        amount: toMajor(amountCents, currency),
        currency,
        key_type: key.type,
        key_value: key.normalized,
        beneficiary: {
          name: beneficiaryName,
          document_type: documentType,
          document: documentNumber,
        },
        reference,
        description,
        callback_url: `${config.publicBaseUrl}/api/webhooks/breb`,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `BRE-B respondió ${res.status}`);
    const status = String(data.status || '').toUpperCase();
    return {
      provider: 'breb',
      providerRef: data.transfer_id || data.id || null,
      status: ['COMPLETED', 'APPROVED', 'SUCCESS', 'PROCESSED'].includes(status)
        ? 'completed'
        : ['FAILED', 'REJECTED', 'ERROR'].includes(status)
          ? 'failed'
          : 'processing',
      trackingCode: data.tracking_code || data.transfer_id || null,
      instant: true,
      raw: data,
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('BRE-B no respondió a tiempo.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function verifyWebhook(rawBody, signature, secret = config.breb.apiKey) {
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = String(signature || '').replace(/^sha256=/, '').toLowerCase();
  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
  );
}

module.exports = {
  mode,
  isLive,
  KEY_TYPES,
  normalizeKeyType,
  validateKey,
  sendTransfer,
  verifyWebhook,
  toMinor,
};
