'use strict';

// Monedas sin decimales (ISO-4217 exponent 0)
const ZERO_DECIMAL = new Set(['CLP', 'COP', 'PYG', 'VND', 'JPY', 'KRW', 'ISK', 'XOF', 'XAF']);

const CURRENCIES = {
  USD: { name: 'Dólar estadounidense', symbol: '$', country: 'US' },
  COP: { name: 'Peso colombiano', symbol: '$', country: 'CO' },
  ARS: { name: 'Peso argentino', symbol: '$', country: 'AR' },
  BRL: { name: 'Real brasileño', symbol: 'R$', country: 'BR' },
  CLP: { name: 'Peso chileno', symbol: '$', country: 'CL' },
  MXN: { name: 'Peso mexicano', symbol: '$', country: 'MX' },
  PEN: { name: 'Sol peruano', symbol: 'S/', country: 'PE' },
  PYG: { name: 'Guaraní paraguayo', symbol: '₲', country: 'PY' },
  UYU: { name: 'Peso uruguayo', symbol: '$U', country: 'UY' },
  VES: { name: 'Bolívar venezolano', symbol: 'Bs.', country: 'VE' },
  EUR: { name: 'Euro', symbol: '€', country: 'EU' },
};

function exponent(currency) {
  return ZERO_DECIMAL.has(String(currency).toUpperCase()) ? 0 : 2;
}

function factor(currency) {
  return 10 ** exponent(currency);
}

/** Convierte unidades mayores (ej. 12.34) a unidades menores enteras (1234). */
function toMinor(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new Error('Monto inválido');
  return Math.round(n * factor(currency));
}

/** Convierte unidades menores a mayores con el número correcto de decimales. */
function toMajor(minor, currency) {
  const n = Number(minor);
  if (!Number.isFinite(n)) throw new Error('Monto inválido');
  return Number((n / factor(currency)).toFixed(exponent(currency)));
}

/** Monto que viaja a la API de dLocal Go (número en unidades mayores). */
function toProviderAmount(minor, currency) {
  return toMajor(minor, currency);
}

function format(minor, currency) {
  const exp = exponent(currency);
  const value = minor / factor(currency);
  try {
    return new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(value).replace(/Bs\.?S?/g, 'Bs').replace(/\s+/g, ' ').trim();
  } catch {
    return `${CURRENCIES[currency]?.symbol || ''}${value.toFixed(exp)}`;
  }
}

function formatPlain(minor, currency) {
  const exp = exponent(currency);
  return (minor / factor(currency)).toFixed(exp);
}

function isValidCurrency(currency) {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, String(currency).toUpperCase());
}

module.exports = {
  ZERO_DECIMAL,
  CURRENCIES,
  exponent,
  factor,
  toMinor,
  toMajor,
  toProviderAmount,
  format,
  formatPlain,
  isValidCurrency,
};
