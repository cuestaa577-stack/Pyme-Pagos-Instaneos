'use strict';

/**
 * Catálogo de países, monedas, métodos de cobro (payer) y vías de entrega
 * (beneficiary). Es la fuente única de verdad: el backend valida contra este
 * catálogo y el frontend lo consume desde GET /api/config.
 *
 * Convención:
 *  - `pay`     → métodos con los que se puede PAGAR desde ese país.
 *  - `receive` → vías con las que se puede ENTREGAR dinero en ese país.
 */

const COUNTRIES = [
  {
    code: 'VE',
    name: 'Venezuela',
    currency: 'VES',
    dial: '+58',
    doc: 'Cédula V/E/J/G/P',
    pay: ['ve_pago_movil', 've_transfer', 've_cash', 'card'],
    receive: ['pago_movil_ve', 'transfer_ve', 'cash_ve'],
    banks: [
      { code: '0102', name: 'Banco de Venezuela' },
      { code: '0105', name: 'Mercantil' },
      { code: '0108', name: 'BBVA Provincial' },
      { code: '0114', name: 'Bancaribe' },
      { code: '0134', name: 'Banesco' },
      { code: '0138', name: 'Banco Plaza' },
      { code: '0151', name: 'BFC Banco Fondo Común' },
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
      { code: '0191', name: 'Banco Nacional de Crédito' },
    ],
  },
  {
    code: 'CO',
    name: 'Colombia',
    currency: 'COP',
    dial: '+57',
    doc: 'Cédula / NIT',
    pay: ['pse', 'breb', 'co_nequi', 'co_daviplata', 'card', 'cash'],
    receive: ['breb', 'pse', 'wallet', 'bank', 'cash_pickup'],
    banks: [
      { code: '1007', name: 'Bancolombia' },
      { code: '1006', name: 'Banco Davivienda' },
      { code: '1001', name: 'Banco de Bogotá' },
      { code: '1013', name: 'BBVA Colombia' },
      { code: '1023', name: 'Banco Caja Social' },
      { code: '1052', name: 'Banco AV Villas' },
      { code: '1051', name: 'Banco Popular' },
      { code: '1002', name: 'Banco de Occidente' },
      { code: '1005', name: 'Banco CorpBanca' },
      { code: '1060', name: 'Banco Falabella' },
      { code: '1507', name: 'Nequi' },
      { code: '1551', name: 'Daviplata' },
    ],
  },
  {
    code: 'CL',
    name: 'Chile',
    currency: 'CLP',
    dial: '+56',
    doc: 'RUT',
    pay: ['cl_webpay', 'cl_mercadopago', 'cl_transfer', 'card', 'cash_cl'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'CL-BCH', name: 'Banco de Chile' },
      { code: 'CL-EST', name: 'Banco Estado' },
      { code: 'CL-BCI', name: 'BCI' },
      { code: 'CL-SANT', name: 'Santander Chile' },
      { code: 'CL-ITAU', name: 'Itaú Chile' },
      { code: 'CL-SEC', name: 'Scotiabank Chile' },
      { code: 'CL-BICE', name: 'Banco BICE' },
      { code: 'CL-CONS', name: 'Banco Consorcio' },
      { code: 'CL-FAL', name: 'Banco Falabella' },
      { code: 'CL-RIP', name: 'Banco Ripley' },
      { code: 'CL-TEN', name: 'Tenpo' },
      { code: 'CL-MAC', name: 'MACH' },
      { code: 'CL-MP', name: 'Mercado Pago Chile' },
    ],
  },
  {
    code: 'PE',
    name: 'Perú',
    currency: 'PEN',
    dial: '+51',
    doc: 'DNI / CE',
    pay: ['pe_yape', 'pe_plin', 'pe_transfer', 'card', 'cash_pe'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'PE-BCP', name: 'BCP' },
      { code: 'PE-BBVA', name: 'BBVA Perú' },
      { code: 'PE-INT', name: 'Interbank' },
      { code: 'PE-SCO', name: 'Scotiabank Perú' },
      { code: 'PE-BN', name: 'Banco de la Nación' },
      { code: 'PE-BIF', name: 'BanBif' },
      { code: 'PE-PICH', name: 'Banco Pichincha' },
      { code: 'PE-YAPE', name: 'Yape' },
      { code: 'PE-PLIN', name: 'Plin' },
    ],
  },
  {
    code: 'AR',
    name: 'Argentina',
    currency: 'ARS',
    dial: '+54',
    doc: 'DNI / CUIT',
    pay: ['ar_mercadopago', 'ar_transfer', 'card', 'cash_ar'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'AR-NACION', name: 'Banco Nación' },
      { code: 'AR-GALICIA', name: 'Banco Galicia' },
      { code: 'AR-SANT', name: 'Santander Argentina' },
      { code: 'AR-BBVA', name: 'BBVA Argentina' },
      { code: 'AR-MACRO', name: 'Banco Macro' },
      { code: 'AR-PROVINCIA', name: 'Banco Provincia' },
      { code: 'AR-BRUBANK', name: 'Brubank' },
      { code: 'AR-MP', name: 'Mercado Pago' },
      { code: 'AR-UALA', name: 'Ualá' },
    ],
  },
  {
    code: 'MX',
    name: 'México',
    currency: 'MXN',
    dial: '+52',
    doc: 'CURP / RFC',
    pay: ['mx_spei', 'mx_oxxo', 'mx_transfer', 'card', 'cash_mx'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'MX-BBVA', name: 'BBVA México' },
      { code: 'MX-BANORTE', name: 'Banorte' },
      { code: 'MX-SANT', name: 'Santander México' },
      { code: 'MX-CITI', name: 'Citibanamex' },
      { code: 'MX-HSBC', name: 'HSBC México' },
      { code: 'MX-SCOTIA', name: 'Scotiabank México' },
      { code: 'MX-AZTEC', name: 'Banco Azteca' },
      { code: 'MX-STP', name: 'STP' },
      { code: 'MX-MP', name: 'Mercado Pago México' },
    ],
  },
  {
    code: 'EC',
    name: 'Ecuador',
    currency: 'USD',
    dial: '+593',
    doc: 'Cédula / Pasaporte',
    pay: ['ec_transfer', 'ec_pichincha', 'card', 'cash_ec'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'EC-PICH', name: 'Banco Pichincha' },
      { code: 'EC-PACIF', name: 'Banco del Pacífico' },
      { code: 'EC-GUAY', name: 'Banco Guayaquil' },
      { code: 'EC-PROD', name: 'Produbanco' },
      { code: 'EC-BOL', name: 'Banco Bolivariano' },
      { code: 'EC-SOLID', name: 'Banco Solidario' },
      { code: 'EC-DINERS', name: 'Diners Club Ecuador' },
    ],
  },
  {
    code: 'PA',
    name: 'Panamá',
    currency: 'USD',
    dial: '+507',
    doc: 'Cédula / Pasaporte',
    pay: ['pa_ach', 'pa_yappy', 'card', 'cash_pa'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'PA-BG', name: 'Banco General' },
      { code: 'PA-BANISTMO', name: 'Banistmo' },
      { code: 'PA-BAC', name: 'BAC Panamá' },
      { code: 'PA-GLOBAL', name: 'Global Bank' },
      { code: 'PA-CAPITAL', name: 'Banco Capital' },
      { code: 'PA-YAPPY', name: 'Yappy' },
    ],
  },
  {
    code: 'DO',
    name: 'Rep. Dominicana',
    currency: 'DOP',
    dial: '+1',
    doc: 'Cédula / Pasaporte',
    pay: ['do_tpago', 'do_transfer', 'card', 'cash_do'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'DO-POPULAR', name: 'Banco Popular Dominicano' },
      { code: 'DO-BHD', name: 'BHD' },
      { code: 'DO-RESERVAS', name: 'Banreservas' },
      { code: 'DO-SCOTIA', name: 'Scotiabank RD' },
      { code: 'DO-BANESCO', name: 'Banesco RD' },
      { code: 'DO-TPAGO', name: 'tPago' },
    ],
  },
  {
    code: 'ES',
    name: 'España',
    currency: 'EUR',
    dial: '+34',
    doc: 'DNI / NIE',
    pay: ['es_bizum', 'es_sepa', 'card', 'cash_es'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'ES-SANT', name: 'Santander España' },
      { code: 'ES-BBVA', name: 'BBVA España' },
      { code: 'ES-CAIXA', name: 'CaixaBank' },
      { code: 'ES-SABADELL', name: 'Banco Sabadell' },
      { code: 'ES-BANKINTER', name: 'Bankinter' },
      { code: 'ES-ING', name: 'ING España' },
      { code: 'ES-REVOLUT', name: 'Revolut' },
      { code: 'ES-BIZUM', name: 'Bizum' },
    ],
  },
  {
    code: 'US',
    name: 'Estados Unidos',
    currency: 'USD',
    dial: '+1',
    doc: 'SSN / Pasaporte',
    pay: ['us_ach', 'us_zelle', 'card', 'cash_us'],
    receive: ['bank', 'wallet', 'cash_pickup'],
    banks: [
      { code: 'US-CHASE', name: 'Chase' },
      { code: 'US-BOA', name: 'Bank of America' },
      { code: 'US-WELLS', name: 'Wells Fargo' },
      { code: 'US-CITI', name: 'Citibank' },
      { code: 'US-TD', name: 'TD Bank' },
      { code: 'US-ZELLE', name: 'Zelle' },
      { code: 'US-WISE', name: 'Wise' },
    ],
  },
];

const RAILS = [
  'breb',
  'pago_movil',
  'bank',
  'pago_movil_ve',
  'transfer_ve',
  'cash_ve',
  'wallet',
  'cash_pickup',
];

/**
 * Métodos de cobro. `currency` es la moneda en la que se cobra, `rail` la vía
 * de entrega por defecto y `payer` el país del pagador.
 */
const METHODS = {
  card: { name: 'Tarjeta', sub: 'Visa / Mastercard · 3D Secure', ico: 'card', currency: null, rail: 'bank', payer: null },
  cash: { name: 'Efectivo', sub: 'Cupón de pago', ico: 'cash', currency: null, rail: 'cash_pickup', payer: null },

  pse: { name: 'PSE', sub: 'Débito bancario Colombia', ico: 'bank', currency: 'COP', rail: 'breb', payer: 'CO' },
  breb: { name: 'BRE-B', sub: 'Transferencia instantánea', ico: 'key', currency: 'COP', rail: 'breb', payer: 'CO' },
  co_nequi: { name: 'Nequi', sub: 'Billetera digital Colombia', ico: 'wallet', currency: 'COP', rail: 'wallet', payer: 'CO' },
  co_daviplata: { name: 'Daviplata', sub: 'Billetera digital Colombia', ico: 'wallet', currency: 'COP', rail: 'wallet', payer: 'CO' },

  ve_pago_movil: { name: 'Pago Móvil', sub: 'Débito inmediato en bolívares', ico: 'phone', currency: 'VES', rail: 'pago_movil_ve', payer: 'VE' },
  ve_transfer: { name: 'Transferencia', sub: 'Banco venezolano en VES', ico: 'transfer', currency: 'VES', rail: 'transfer_ve', payer: 'VE' },
  ve_cash: { name: 'Efectivo', sub: 'Taquilla / agente en Venezuela', ico: 'cash', currency: 'VES', rail: 'cash_ve', payer: 'VE' },

  cl_webpay: { name: 'Webpay Plus', sub: 'Transbank · débito y crédito', ico: 'card', currency: 'CLP', rail: 'bank', payer: 'CL' },
  cl_mercadopago: { name: 'Mercado Pago', sub: 'Billetera y tarjetas', ico: 'wallet', currency: 'CLP', rail: 'wallet', payer: 'CL' },
  cl_transfer: { name: 'Transferencia bancaria', sub: 'Cuenta corriente / vista', ico: 'bank', currency: 'CLP', rail: 'bank', payer: 'CL' },
  cash_cl: { name: 'Efectivo', sub: 'Servipag / Sencillito', ico: 'cash', currency: 'CLP', rail: 'cash_pickup', payer: 'CL' },

  pe_yape: { name: 'Yape', sub: 'Billetera BCP', ico: 'wallet', currency: 'PEN', rail: 'wallet', payer: 'PE' },
  pe_plin: { name: 'Plin', sub: 'Billetera interbancaria', ico: 'wallet', currency: 'PEN', rail: 'wallet', payer: 'PE' },
  pe_transfer: { name: 'Transferencia', sub: 'CCI / cuenta interbancaria', ico: 'bank', currency: 'PEN', rail: 'bank', payer: 'PE' },
  cash_pe: { name: 'Efectivo', sub: 'Agentes y bodegas', ico: 'cash', currency: 'PEN', rail: 'cash_pickup', payer: 'PE' },

  ar_mercadopago: { name: 'Mercado Pago', sub: 'Billetera y tarjetas', ico: 'wallet', currency: 'ARS', rail: 'wallet', payer: 'AR' },
  ar_transfer: { name: 'Transferencia', sub: 'CBU / CVU', ico: 'bank', currency: 'ARS', rail: 'bank', payer: 'AR' },
  cash_ar: { name: 'Efectivo', sub: 'Rapipago / Pago Fácil', ico: 'cash', currency: 'ARS', rail: 'cash_pickup', payer: 'AR' },

  mx_spei: { name: 'SPEI', sub: 'Transferencia interbancaria', ico: 'bolt', currency: 'MXN', rail: 'bank', payer: 'MX' },
  mx_oxxo: { name: 'OXXO', sub: 'Pago en tienda', ico: 'cash', currency: 'MXN', rail: 'cash_pickup', payer: 'MX' },
  mx_transfer: { name: 'Transferencia', sub: 'CLABE interbancaria', ico: 'bank', currency: 'MXN', rail: 'bank', payer: 'MX' },
  cash_mx: { name: 'Efectivo', sub: 'Farmacias y tiendas', ico: 'cash', currency: 'MXN', rail: 'cash_pickup', payer: 'MX' },

  ec_transfer: { name: 'Transferencia', sub: 'Cuenta bancaria Ecuador', ico: 'bank', currency: 'USD', rail: 'bank', payer: 'EC' },
  ec_pichincha: { name: 'Pichincha', sub: 'Banca en línea', ico: 'bank', currency: 'USD', rail: 'bank', payer: 'EC' },
  cash_ec: { name: 'Efectivo', sub: 'Puntos autorizados', ico: 'cash', currency: 'USD', rail: 'cash_pickup', payer: 'EC' },

  pa_ach: { name: 'ACH Panamá', sub: 'Transferencia local', ico: 'bank', currency: 'USD', rail: 'bank', payer: 'PA' },
  pa_yappy: { name: 'Yappy', sub: 'Billetera Banco General', ico: 'wallet', currency: 'USD', rail: 'wallet', payer: 'PA' },
  cash_pa: { name: 'Efectivo', sub: 'Puntos autorizados', ico: 'cash', currency: 'USD', rail: 'cash_pickup', payer: 'PA' },

  do_tpago: { name: 'tPago', sub: 'Billetera dominicana', ico: 'wallet', currency: 'DOP', rail: 'wallet', payer: 'DO' },
  do_transfer: { name: 'Transferencia', sub: 'Cuenta bancaria RD', ico: 'bank', currency: 'DOP', rail: 'bank', payer: 'DO' },
  cash_do: { name: 'Efectivo', sub: 'Agentes autorizados', ico: 'cash', currency: 'DOP', rail: 'cash_pickup', payer: 'DO' },

  es_bizum: { name: 'Bizum', sub: 'Pago móvil español', ico: 'phone', currency: 'EUR', rail: 'wallet', payer: 'ES' },
  es_sepa: { name: 'SEPA', sub: 'Transferencia IBAN', ico: 'bank', currency: 'EUR', rail: 'bank', payer: 'ES' },
  cash_es: { name: 'Efectivo', sub: 'Puntos autorizados', ico: 'cash', currency: 'EUR', rail: 'cash_pickup', payer: 'ES' },

  us_ach: { name: 'ACH', sub: 'Transferencia bancaria EE. UU.', ico: 'bank', currency: 'USD', rail: 'bank', payer: 'US' },
  us_zelle: { name: 'Zelle', sub: 'Pago instantáneo EE. UU.', ico: 'bolt', currency: 'USD', rail: 'wallet', payer: 'US' },
  cash_us: { name: 'Efectivo', sub: 'Puntos autorizados', ico: 'cash', currency: 'USD', rail: 'cash_pickup', payer: 'US' },
};

const METHOD_IDS = Object.keys(METHODS);

function country(code) {
  return COUNTRIES.find((c) => c.code === String(code || '').toUpperCase()) || null;
}

/** Métodos de cobro válidos para pagar desde `countryCode`. */
function payMethods(countryCode) {
  const c = country(countryCode);
  if (!c) return ['card'];
  // Tarjeta internacional está disponible desde cualquier país.
  return Array.from(new Set([...c.pay, 'card']));
}

/** Vías de entrega válidas en `countryCode`. */
function receiveRails(countryCode) {
  const c = country(countryCode);
  return c ? c.receive : ['bank'];
}

function currencyFor(method, payerCountry) {
  const m = METHODS[method];
  if (m && m.currency) return m.currency;
  const c = country(payerCountry);
  return c ? c.currency : 'USD';
}

function railFor(method) {
  return (METHODS[method] && METHODS[method].rail) || 'bank';
}

function isValidMethodFor(method, payerCountry) {
  if (!METHODS[method]) return false;
  const m = METHODS[method];
  if (!m.payer) return true; // tarjeta / efectivo genéricos
  return m.payer === String(payerCountry || '').toUpperCase();
}

/** Métodos por país, listos para el frontend. */
function publicCatalog() {
  return COUNTRIES.map((c) => ({
    code: c.code,
    name: c.name,
    currency: c.currency,
    dial: c.dial,
    doc: c.doc,
    banks: c.banks,
    pay: payMethods(c.code),
    receive: c.receive,
  }));
}

module.exports = {
  COUNTRIES,
  RAILS,
  METHODS,
  METHOD_IDS,
  country,
  payMethods,
  receiveRails,
  currencyFor,
  railFor,
  isValidMethodFor,
  publicCatalog,
};
