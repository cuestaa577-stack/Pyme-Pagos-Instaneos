'use strict';
const { getSettings } = require('../db');
const { toMinor, toMajor, exponent } = require('../lib/money');

const DESTINATION_CURRENCY = {
  VE: 'VES',
  CO: 'COP',
  CL: 'CLP',
  PE: 'PEN',
  AR: 'ARS',
  MX: 'MXN',
  EC: 'USD',
  PA: 'USD',
  DO: 'DOP',
  BR: 'BRL',
  PY: 'PYG',
  UY: 'UYU',
  ES: 'EUR',
  US: 'USD',
};

// Tasas de referencia (unidades de moneda local por 1 USD). El propietario
// puede sobreescribirlas desde Ajustes o por .env; estos valores solo evitan
// que una moneda sin tasa configurada rompa la cotización.
const DEFAULT_RATES = {
  USD: 1,
  VES: 120,
  COP: 4000,
  CLP: 950,
  PEN: 3.75,
  ARS: 1000,
  MXN: 18.5,
  DOP: 59,
  BRL: 5.4,
  PYG: 7300,
  UYU: 40,
  EUR: 0.92,
};

function rates() {
  const s = getSettings();
  const out = { ...DEFAULT_RATES };
  for (const code of Object.keys(DEFAULT_RATES)) {
    const key = `${code.toLowerCase()}_rate`;
    const value = Number(s[key]);
    if (Number.isFinite(value) && value > 0) out[code] = value;
  }
  return out;
}

function convertMinor(minor, from, to, customRates) {
  if (from === to) return minor;
  const r = customRates || rates();
  const usdMajor = toMajor(minor, from) / (r[from] || 1);
  const destMajor = usdMajor * (r[to] || 1);
  return toMinor(destMajor, to);
}

function feeFor(amountMinor, settings, currency = 'USD') {
  const pct = Number(settings.fees_percent || 3.5);
  const pctFee = Math.round((amountMinor * pct) / 100);
  // El fijo está configurado en centavos de USD: se convierte a la moneda
  // local para que la comisión mínima tenga sentido en cualquier corredor.
  const fixedUsdCents = Number(settings.fee_fixed_cents || 50);
  const localRate = rates()[currency] || 1;
  const fixedLocal = Math.round((fixedUsdCents / 100) * localRate * 10 ** exponent(currency));
  const floor = currency === 'VES' ? 10000 : 1;
  return Math.max(pctFee, fixedLocal, floor);
}

/**
 * Cotiza una operación.
 * @param {number} amountCents Monto base que se envía (en `currency`)
 * @param {string} currency Moneda de pago (USD/COP)
 * @param {string} country País destino (CO/VE/...)
 * @param {string} method card|pse|breb|cash
 */
function quote({ amountCents, currency, country, method }) {
  const settings = getSettings();
  // No hay monto mínimo: cualquier importe mayor que cero es válido.
  // Sólo se conserva un techo por operación (antifraude / límites del riel).
  const isVes = currency === 'VES';
  const rate = rates()[currency] || 1;
  const exp = exponent(currency);
  const min = 1;
  const max = isVes
    ? 500000000
    : Math.max(1, Math.round((Number(settings.max_order_cents || 500000) / 100) * rate * 10 ** exp));
  if (!Number.isInteger(amountCents) || amountCents < min) {
    throw new Error('Escribe un monto mayor que cero.');
  }
  if (amountCents > max) {
    throw new Error(`El monto máximo por operación es ${(max / 10 ** exponent(currency)).toFixed(exponent(currency))} ${currency}.`);
  }

  const feeCents = feeFor(amountCents, settings, currency);
  const totalCents = amountCents + feeCents;
  const destinationCurrency = DESTINATION_CURRENCY[country] || currency;
  const destinationAmountCents = convertMinor(amountCents, currency, destinationCurrency);

  return {
    amount_cents: amountCents,
    fee_cents: feeCents,
    total_cents: totalCents,
    net_cents: amountCents,
    currency,
    destination_currency: destinationCurrency,
    destination_amount_cents: destinationAmountCents,
    fx_rate: destinationCurrency === currency ? 1 : rates()[destinationCurrency] / (rates()[currency] || 1),
    fee_percent: Number(settings.fees_percent || 3.5),
  };
}

function withdrawalFee(amountCents) {
  const settings = getSettings();
  const pct = Number(settings.withdrawal_fee_percent || 1);
  const minFee = Number(settings.fee_fixed_cents || 50);
  return Math.max(Math.round((amountCents * pct) / 100), minFee);
}

function payoutFee(amountCents) {
  const settings = getSettings();
  const pct = Number(settings.payout_fee_percent || 1.5);
  const minFee = Number(settings.fee_fixed_cents || 50);
  return Math.max(Math.round((amountCents * pct) / 100), minFee);
}

module.exports = {
  DESTINATION_CURRENCY,
  rates,
  convertMinor,
  feeFor,
  quote,
  withdrawalFee,
  payoutFee,
};
