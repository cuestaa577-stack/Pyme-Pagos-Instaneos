'use strict';
const { getSettings } = require('../db');
const { toMinor, toMajor, exponent } = require('../lib/money');

const DESTINATION_CURRENCY = {
  CO: 'COP',
  VE: 'VES',
  AR: 'ARS',
  BR: 'BRL',
  CL: 'CLP',
  MX: 'MXN',
  PE: 'PEN',
  PY: 'PYG',
  UY: 'UYU',
};

function rates() {
  const s = getSettings();
  return {
    USD: 1,
    COP: Number(s.cop_rate || 4000),
    VES: Number(s.ves_rate || 120),
  };
}

function convertMinor(minor, from, to, customRates) {
  if (from === to) return minor;
  const r = customRates || rates();
  const usdMajor = toMajor(minor, from) / (r[from] || 1);
  const destMajor = usdMajor * (r[to] || 1);
  return toMinor(destMajor, to);
}

function feeFor(amountCents, settings, currency = 'USD') {
  const pct = Number(settings.fees_percent || 3.5);
  // El mínimo fijo está expresado en centavos de USD; para VES usamos un piso
  // razonable en bolívares para que la comisión no quede simbólica.
  const minFee =
    currency === 'VES'
      ? Math.max(Number(settings.fee_fixed_cents || 50) * 200, 10000)
      : Number(settings.fee_fixed_cents || 50);
  return Math.max(Math.round((amountCents * pct) / 100), minFee);
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
  // Los topes están configurados en centavos de USD; para VES usamos topes
  // propios en bolívares (Bs 500 mínimo / Bs 5.000.000 máximo).
  const isVes = currency === 'VES';
  const min = isVes ? 50000 : Number(settings.min_order_cents || 500);
  const max = isVes ? 500000000 : Number(settings.max_order_cents || 500000);
  if (!Number.isInteger(amountCents) || amountCents < min) {
    throw new Error(`El monto mínimo es ${(min / 10 ** exponent(currency)).toFixed(exponent(currency))} ${currency}.`);
  }
  if (amountCents > max) {
    throw new Error(`El monto máximo es ${(max / 10 ** exponent(currency)).toFixed(exponent(currency))} ${currency}.`);
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
