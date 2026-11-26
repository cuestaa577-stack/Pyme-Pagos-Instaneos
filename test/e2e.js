'use strict';

/**
 * Pruebas end-to-end de RemesaYa.
 * Requiere el servidor corriendo (por defecto http://localhost:3000).
 * Uso: npm test
 */

const BASE = process.env.E2E_BASE || `http://localhost:${process.env.PORT || 3000}`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'cuestaa577@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Angelo18@';

let passed = 0;
let failed = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name} ${detail ? `— ${detail}` : ''}`);
  }
}

async function req(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main() {
  console.log(`RemesaYa E2E · ${BASE}`);

  section('1. Salud y configuración');
  const health = await req('/api/health');
  ok('health responde ok', health.status === 200 && health.data?.ok === true);
  const cfg = await req('/api/config');
  ok('config expone métodos', Array.isArray(cfg.data?.methods) && cfg.data.methods.includes('ve_pago_movil'));
  ok('config expone bancos VE', Array.isArray(cfg.data?.vepay?.banks) && cfg.data.vepay.banks.length > 10);

  section('2. Cotización internacional (USD → VES)');
  const q1 = await req('/api/quote', {
    method: 'POST',
    body: { amountCents: 10000, currency: 'USD', country: 'VE', method: 'card' },
  });
  ok('cotización 200', q1.status === 200, JSON.stringify(q1.data));
  ok('comisión calculada', q1.data?.fee_cents > 0);
  ok('destino en VES', q1.data?.destination_currency === 'VES');
  ok('monto destino > 0', q1.data?.destination_amount_cents > 0);

  section('3. Orden internacional con tarjeta (modo demo)');
  const order1 = await req('/api/orders', {
    method: 'POST',
    body: {
      fullName: 'María Alejandra Pérez',
      email: 'maria@example.com',
      phone: '+584141234567',
      document: 'V-12345678',
      beneficiaryName: 'Luis Gómez',
      beneficiaryDocument: 'V-23456789',
      rail: 'pago_movil',
      keyType: 'phone',
      brebKey: '04141234567',
      bankCode: '0134',
      bankName: 'Banesco',
      amountCents: 10000,
      currency: 'USD',
      payerCountry: 'US',
      country: 'VE',
      method: 'card',
      description: 'Remesa familiar',
    },
  });
  ok('orden creada 201', order1.status === 201, JSON.stringify(order1.data));
  const pid1 = order1.data?.order?.public_id;
  ok('tiene public_id', Boolean(pid1));
  ok('checkout demo', String(order1.data?.order?.checkout_url || '').startsWith('/pay/'), order1.data?.order?.checkout_url);

  const approve1 = await req(`/api/orders/${pid1}/demo-approve`, { method: 'POST' });
  ok('aprobación demo 200', approve1.status === 200, JSON.stringify(approve1.data));
  ok('orden completada', approve1.data?.order?.status === 'completed', approve1.data?.order?.status);

  section('4. Pago desde Venezuela (VES, Pago Móvil)');
  const q2 = await req('/api/quote', {
    method: 'POST',
    body: { amountCents: 100000, currency: 'VES', country: 'VE', method: 've_pago_movil' },
  });
  ok('cotización VES 200', q2.status === 200, JSON.stringify(q2.data));
  ok('sin conversión (VES→VES)', q2.data?.fx_rate === 1);
  ok('destino VES', q2.data?.destination_currency === 'VES');

  const order2 = await req('/api/orders', {
    method: 'POST',
    body: {
      fullName: 'José Ramírez',
      email: 'jose@example.com',
      phone: '04141234567',
      document: 'V-87654321',
      beneficiaryName: 'Ana Torres',
      beneficiaryDocument: 'V-11223344',
      rail: 'pago_movil_ve',
      brebKey: '04241234567',
      bankCode: '0102',
      bankName: 'Banco de Venezuela',
      amountCents: 100000,
      currency: 'VES',
      payerCountry: 'VE',
      country: 'VE',
      method: 've_pago_movil',
      description: 'Remesa dentro de Venezuela',
    },
  });
  ok('orden VE creada 201', order2.status === 201, JSON.stringify(order2.data));
  const pid2 = order2.data?.order?.public_id;
  ok('checkout /pay/ve', String(order2.data?.order?.checkout_url || '').startsWith('/pay/ve/'), order2.data?.order?.checkout_url);
  ok('proveedor vepay_simulator', order2.data?.order?.provider === 'vepay_simulator', order2.data?.order?.provider);

  const approve2 = await req(`/api/orders/${pid2}/demo-approve`, { method: 'POST' });
  ok('aprobación VE 200', approve2.status === 200, JSON.stringify(approve2.data));
  ok('orden VE completada', approve2.data?.order?.status === 'completed', approve2.data?.order?.status);

  section('5. Administración');
  const login = await req('/api/admin/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  ok('login admin 200', login.status === 200, JSON.stringify(login.data));
  const setCookie = login.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const csrf = login.data?.csrf;
  ok('cookie de sesión', cookie.startsWith('ry_session='));
  ok('csrf presente', Boolean(csrf));

  const auth = { cookie, 'x-csrf-token': csrf };
  const stats = await req('/api/admin/stats', { headers: auth });
  ok('stats 200', stats.status === 200, JSON.stringify(stats.data));
  ok('stats incluye VES', Boolean(stats.data?.balances?.VES));

  const bal = await req('/api/admin/balance?currency=VES', { headers: auth });
  ok('balance VES 200', bal.status === 200);

  const sweep = await req('/api/admin/fees/sweep', {
    method: 'POST',
    headers: auth,
    body: { currency: 'VES' },
  });
  ok('barrido de comisiones VES', sweep.status === 200, JSON.stringify(sweep.data));

  section('6. Retiro instantáneo en VES');
  // Flujo realista: el comercio cobra una orden VE sin auto-entrega, de modo
  // que el neto queda en su saldo disponible, y luego retira por Pago Móvil.
  await req('/api/admin/settings', {
    method: 'PUT',
    headers: auth,
    body: { auto_disburse: '0' },
  });
  const order3 = await req('/api/orders', {
    method: 'POST',
    body: {
      fullName: 'María Pérez',
      email: 'maria@example.com',
      phone: '04141234567',
      document: 'V-13579246',
      beneficiaryName: 'Carlos Díaz',
      beneficiaryDocument: 'V-24681357',
      rail: 'pago_movil_ve',
      brebKey: '04141234567',
      bankCode: '0134',
      bankName: 'Banesco',
      amountCents: 300000,
      currency: 'VES',
      payerCountry: 'VE',
      country: 'VE',
      method: 've_pago_movil',
      description: 'Cobro para retiro',
    },
  });
  const pid3 = order3.data?.order?.public_id;
  const approve3 = await req(`/api/orders/${pid3}/demo-approve`, { method: 'POST' });
  ok('orden VE para retiro aprobada', approve3.data?.order?.status === 'approved', approve3.data?.order?.status);

  const wd = await req('/api/admin/withdrawals', {
    method: 'POST',
    headers: auth,
    body: {
      amountCents: 50000,
      currency: 'VES',
      keyType: 'phone',
      keyValue: '04141234567',
      rail: 'pago_movil_ve',
      phone: '04141234567',
      bankCode: '0134',
      destinationName: 'José Ramírez',
    },
  });
  ok('retiro VES 201', wd.status === 201, JSON.stringify(wd.data));
  ok('retiro completado', wd.data?.withdrawal?.status === 'completed', wd.data?.withdrawal?.status);

  await req('/api/admin/settings', {
    method: 'PUT',
    headers: auth,
    body: { auto_disburse: '1' },
  });

  section('7. Seguridad');
  const noCsrf = await req('/api/admin/withdrawals', {
    method: 'POST',
    headers: { cookie },
    body: { amountCents: 1000, currency: 'VES', keyType: 'phone', keyValue: '04141234567' },
  });
  ok('rechaza POST sin CSRF', noCsrf.status === 403, String(noCsrf.status));

  const badDoc = await req('/api/validate-document', { method: 'POST', body: { document: 'V-11111111' } });
  ok('rechaza cédula con dígitos repetidos', badDoc.data?.valid === false);

  console.log(`\n\x1b[1mResultado:\x1b[0m ${passed} ok, ${failed} fallos`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nError fatal en E2E:', err);
  process.exit(1);
});
