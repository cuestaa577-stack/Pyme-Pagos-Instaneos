'use strict';
const crypto = require('crypto');
const config = require('../config');
const { toMajor } = require('../lib/money');

/**
 * Adaptador PSE (Pagos Seguros en Línea, ACH Colombia).
 *
 * PSE se integra normalmente a través de un agregador autorizado. Este
 * adaptador implementa el contrato REST esperado de ese agregador:
 *   POST {PSE_API_URL}/sessions
 *   Authorization: Bearer {PSE_API_KEY}
 *   { amount, currency: "COP", document, name, email, bank_code, reference, return_url }
 *   -> { session_id, redirect_url, status }
 */

function mode() {
  if (config.pse.mode === 'simulator') return 'simulator';
  if (config.pse.mode === 'live') return 'live';
  return config.pse.apiUrl && config.pse.apiKey ? 'live' : 'manual';
}

function isLive() {
  return mode() === 'live';
}

/**
 * Error de vía no habilitada. No existe ningún modo simulado: si el riel no
 * tiene credenciales reales, la orden se deriva al cobro manual con comprobante.
 */
function notLiveError(label) {
  const err = new Error(`${label} no está habilitado con credenciales reales.`);
  err.notLive = true;
  err.rail = label;
  return err;
}


const BANKS = [
  { code: '1007', name: 'Bancolombia' },
  { code: '1006', name: 'Banco Davivienda' },
  { code: '1022', name: 'Banco de Bogotá' },
  { code: '1013', name: 'Banco BBVA Colombia' },
  { code: '1051', name: 'Banco Davivienda (Personas)' },
  { code: '1001', name: 'Banco de Occidente' },
  { code: '1002', name: 'Banco Popular' },
  { code: '1005', name: 'Banco Colpatria' },
  { code: '1019', name: 'Banco Scotiabank Colpatria' },
  { code: '1062', name: 'Banco Falabella' },
  { code: '1066', name: 'Banco Pichincha' },
  { code: '1032', name: 'Banco Caja Social' },
  { code: '1009', name: 'Banco Agrario' },
  { code: '1052', name: 'Banco AV Villas' },
  { code: '1058', name: 'Banco Nequi' },
  { code: '1059', name: 'Banco Daviplata' },
];

async function createSession({
  amountCents,
  currency = 'COP',
  document,
  name,
  email,
  bankCode,
  reference,
  description,
}) {
  if (!isLive()) throw notLiveError('PSE');

  const res = await fetch(`${config.pse.apiUrl}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.pse.apiKey}` },
    body: JSON.stringify({
      amount: toMajor(amountCents, currency),
      currency,
      document,
      name,
      email,
      bank_code: bankCode,
      reference,
      description,
      return_url: `${config.publicBaseUrl}/api/webhooks/pse/return`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `PSE respondió ${res.status}`);
  return {
    provider: 'pse',
    providerRef: data.session_id || data.id || null,
    status: String(data.status || 'pending').toLowerCase(),
    redirectUrl: data.redirect_url || null,
    raw: data,
  };
}

module.exports = { mode, isLive, BANKS, createSession };
