/* RemesaYa — frontend público */
'use strict';

const state = {
  config: null,
  draft: {
    amount: 100,
    currency: 'USD',
    payerCountry: 'US',
    country: 'VE',
    fullName: '',
    document: '',
    email: '',
    phone: '',
    beneficiaryName: '',
    beneficiaryDocument: '',
    rail: 'pago_movil',
    keyType: 'phone',
    brebKey: '',
    bankCode: '',
    bankName: '',
    accountNumber: '',
    accountType: 'CHECKING',
    method: 'card',
    description: '',
  },
  step: 1,
  quote: null,
  order: null,
};

const VE_BANKS = [
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
];

const COUNTRIES = [
  { code: 'VE', name: 'Venezuela' },
  { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Perú' },
  { code: 'CL', name: 'Chile' },
  { code: 'AR', name: 'Argentina' },
  { code: 'MX', name: 'México' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'PA', name: 'Panamá' },
  { code: 'DO', name: 'Rep. Dominicana' },
  { code: 'ES', name: 'España' },
  { code: 'US', name: 'Estados Unidos' },
];

const PAYER_COUNTRIES = [
  { code: 'US', name: 'Estados Unidos / Otro', currency: 'USD' },
  { code: 'CO', name: 'Colombia', currency: 'COP' },
  { code: 'VE', name: 'Venezuela', currency: 'VES' },
];

// Chip de país sobrio (código ISO) en lugar de emoji de bandera.
function countryChip(code) {
  return `<span class="cc">${code}</span>`;
}

const METHOD_CATALOG = {
  card: { ico: 'card', name: 'Tarjeta', sub: 'Visa / Mastercard · 3D Secure' },
  card_transparent: { ico: 'spark', name: 'Tarjeta transparente', sub: 'Checkout en la página' },
  pse: { ico: 'bank', name: 'PSE', sub: 'Débito bancario Colombia' },
  breb: { ico: 'key', name: 'BRE-B', sub: 'Transferencia instantánea' },
  cash: { ico: 'cash', name: 'Efectivo', sub: 'Cupón de pago' },
  ve_pago_movil: { ico: 'phone', name: 'Pago Móvil', sub: 'Débito inmediato en bolívares' },
  ve_transfer: { ico: 'transfer', name: 'Transferencia', sub: 'Banco venezolano en VES' },
  ve_cash: { ico: 'cash', name: 'Efectivo', sub: 'Taquilla / agente en Venezuela' },
};

function payerCurrency(payerCountry) {
  return payerCountry === 'VE' ? 'VES' : payerCountry === 'CO' ? 'COP' : 'USD';
}

function methodsFor(payerCountry) {
  if (payerCountry === 'VE') return ['ve_pago_movil', 've_transfer', 've_cash'];
  if (payerCountry === 'CO') return ['card', 'card_transparent', 'pse', 'breb', 'cash'];
  return ['card', 'card_transparent', 'cash'];
}

function railsFor(payerCountry, destination) {
  if (payerCountry === 'VE') return ['pago_movil_ve', 'transfer_ve', 'cash_ve'];
  if (destination === 'VE') return ['pago_movil', 'breb', 'bank'];
  return ['bank'];
}

function railLabel(rail) {
  return {
    pago_movil: 'Pago Móvil',
    breb: 'BRE-B',
    bank: 'Cuenta bancaria',
    pago_movil_ve: 'Pago Móvil (VES)',
    transfer_ve: 'Transferencia bancaria (VES)',
    cash_ve: 'Efectivo (VES)',
  }[rail] || 'Cuenta bancaria';
}

/* ---------------- utilidades ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const app = () => $('#app');

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(cents, currency) {
  const zero = ['COP', 'CLP', 'PYG'].includes(currency);
  const value = zero ? Number(cents || 0) : Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency,
      minimumFractionDigits: zero ? 0 : 2,
      maximumFractionDigits: zero ? 0 : 2,
    }).format(value).replace(/Bs\.?S?/g, 'Bs').replace(/\s+/g, ' ').trim();
  } catch {
    return `${currency} ${value.toFixed(zero ? 0 : 2)}`;
  }
}

function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = 'toast'), 3800);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function navigate(path, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

window.addEventListener('popstate', render);

/* ---------------- componentes ---------------- */
function nav() {
  return `
  <div class="nav">
    <div class="wrap nav-inner">
      <a class="logo" href="/" data-link>
        <span class="logo-mark">R</span>
        <span>RemesaYa</span>
      </a>
      <div class="nav-links">
        <a href="/#como-funciona" data-anchor>Cómo funciona</a>
        <a href="/#vias" data-anchor>Vías de pago</a>
        <a href="/#tarifas" data-anchor>Tarifas</a>
        <a class="nav-login" href="/admin" data-link>${icon('lock', 16)} Iniciar sesión</a>
        <a class="btn btn-primary btn-sm" href="/enviar" data-link>Enviar dinero</a>
      </div>
      <div class="nav-mobile-actions">
        <a class="nav-login" href="/admin" data-link>${icon('lock', 16)} Entrar</a>
        <a class="btn btn-primary btn-sm" href="/enviar" data-link>Enviar</a>
      </div>
    </div>
  </div>`;
}

function footer() {
  const s = state.config?.support || {};
  return `
  <div class="footer">
    <div class="wrap footer-inner">
      <div>
        <div class="logo" style="margin-bottom:10px"><span class="logo-mark">R</span><span>RemesaYa</span></div>
        <div class="small">Remesas y pagos para venezolanos en el extranjero.</div>
        <div class="small mt8">© ${new Date().getFullYear()} RemesaYa. Todos los derechos reservados.</div>
      </div>
      <div class="small">
        <div><strong>Soporte</strong></div>
        <div class="mt8">${esc(s.email || 'soporte@remesaya.app')}</div>
        <div>${esc(s.whatsapp || '')}</div>
      </div>
      <div class="small">
        <div><strong>Legal</strong></div>
        <div class="mt8">Términos y condiciones</div>
        <div>Política de privacidad</div>
        <div>Prevención de fraude</div>
      </div>
    </div>
  </div>`;
}

function statusBadge(status) {
  const map = {
    pending: ['st-pending', 'Pendiente'],
    processing: ['st-pending', 'Procesando'],
    approved: ['st-approved', 'Aprobado'],
    completed: ['st-completed', 'Completado'],
    rejected: ['st-rejected', 'Rechazado'],
    declined: ['st-rejected', 'Declinado'],
    failed: ['st-failed', 'Fallido'],
    cancelled: ['st-failed', 'Cancelado'],
    refunded: ['st-refunded', 'Reembolsado'],
    partially_refunded: ['st-refunded', 'Reembolso parcial'],
  };
  const [cls, label] = map[status] || ['st-pending', status];
  return `<span class="status-badge ${cls}">${esc(label)}</span>`;
}

/* ---------------- landing ---------------- */
function landingView() {
  const c = state.config || {};
  const fees = c.fees || {};
  const rates = c.rates || {};
  return `
  ${nav()}
  <section class="hero">
    <div class="hero-media" aria-hidden="true"></div>
    <div class="hero-veil" aria-hidden="true"></div>
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <div class="pill"><span class="dot"></span> Entrega instantánea 24/7</div>
        <h1 class="mt16">Envía dinero a Venezuela <span class="grad">en segundos</span>, no en días.</h1>
        <p class="lead">RemesaYa conecta a los venezolanos en el extranjero con su familia: pagas con tarjeta, PSE, BRE-B o efectivo, y tu beneficiario recibe al instante en Pago Móvil o transferencia, validando siempre su cédula venezolana.</p>
        <div class="hero-badges">
          <span class="pill">${icon('id', 15)} Cédula venezolana</span>
          <span class="pill">${icon('bolt', 15)} BRE-B instantáneo</span>
          <span class="pill">${icon('bank', 15)} PSE Colombia</span>
          <span class="pill">${icon('lock', 15)} Datos cifrados</span>
        </div>
        <div class="hero-stats">
          <div><strong>${rates.usd_ves ? rates.usd_ves.toFixed(2) : '—'}</strong><span>Bs por USD</span></div>
          <div><strong>${fees.percent ?? 3.5}%</strong><span>Comisión</span></div>
          <div><strong>< 1 min</strong><span>Entrega promedio</span></div>
        </div>
      </div>
    </div>
    <div class="flag-ribbon" aria-hidden="true"><i></i><i></i><i></i></div>
  </section>

  <div class="wrap">
    <section class="calc-section">
      <div class="card calc-card" id="calc">
        <div class="calc-head">
          <div>
            <div class="card-title">Calcula tu envío</div>
            <div class="card-sub">Sin sorpresas: ves la comisión y el monto exacto que recibe tu familia.</div>
          </div>
          <span class="pill">${icon('bolt', 14)} Instantáneo</span>
        </div>
        <div class="calc-grid">
          <label class="field">
            <span>Monto a enviar</span>
            <div class="amount-input">
              <input class="input" id="calc-amount" type="number" min="5" step="1" value="100" />
              <span class="cur" id="calc-cur">USD</span>
            </div>
          </label>
          <label class="field">
            <span>Pagas desde</span>
            <select class="input" id="calc-payer">
              ${PAYER_COUNTRIES.map((x) => `<option value="${x.code}">${x.name}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Destino</span>
            <select class="input" id="calc-country">
              ${COUNTRIES.map((x) => `<option value="${x.code}" ${x.code === 'VE' ? 'selected' : ''}>${x.name}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Método de pago</span>
            <select class="input" id="calc-method"></select>
          </label>
        </div>
        <div class="quote-box" id="calc-quote"><div class="quote-row"><span>Calculando…</span></div></div>
        <button class="btn btn-primary btn-block mt16" id="calc-go">Continuar con el envío</button>
      </div>
    </section>
  </div>

  <section class="block" id="como-funciona">
    <div class="wrap">
      <div class="section-head">
        <h2>Cuatro pasos. Menos de un minuto.</h2>
        <p>Diseñado para que retirar el dinero sea tan rápido como recibir un mensaje.</p>
      </div>
      <div class="steps">
        <div class="step"><h4>Indica el monto</h4><p>Elige cuánto envías y a qué país. Ves la comisión y la tasa en tiempo real.</p></div>
        <div class="step"><h4>Identifícate con tu cédula</h4><p>Validamos tu cédula venezolana (V, E, J, G o pasaporte) al instante.</p></div>
        <div class="step"><h4>Paga como prefieras</h4><p>Tarjeta, PSE, BRE-B o efectivo. Todo desde la misma plataforma.</p></div>
        <div class="step"><h4>Entrega instantánea</h4><p>Tu beneficiario recibe en Pago Móvil o transferencia, con comprobante y seguimiento.</p></div>
      </div>
    </div>
  </section>

  <section class="block" id="vias">
    <div class="wrap">
      <div class="section-head">
        <h2>Todas las vías, una sola plataforma</h2>
        <p>Conectamos cobros internacionales con los rieles de pago que tu familia ya usa.</p>
      </div>
      <div class="grid3">
        <div class="rail-card">
          <div class="logo-sq rail-breb">BRE-B</div>
          <div><h4>BRE-B instantáneo</h4><p class="muted small mt8">Transferencias inmediatas en Colombia con llave de cédula, teléfono, correo o alfanumérica. Liquidación en segundos.</p></div>
        </div>
        <div class="rail-card">
          <div class="logo-sq rail-pse">PSE</div>
          <div><h4>PSE Colombia</h4><p class="muted small mt8">Paga desde tu banco colombiano con débito seguro. Compatible con Bancolombia, Davivienda, Bogotá, BBVA y más.</p></div>
        </div>
        <div class="rail-card">
          <div class="logo-sq rail-pm">PM</div>
          <div><h4>Pago Móvil Venezuela</h4><p class="muted small mt8">Entrega inmediata al teléfono y banco de tu beneficiario, validando su cédula venezolana.</p></div>
        </div>
      </div>
      <div class="grid3 mt24">
        <div class="feature"><div class="ico">${icon('card', 22)}</div><h4>Tarjeta internacional</h4><p>Visa y Mastercard con 3D Secure. Checkout alojado o transparente con SmartFields.</p></div>
        <div class="feature"><div class="ico">${icon('cash', 22)}</div><h4>Efectivo</h4><p>Paga en efectivo con cupón y completa la operación sin cuenta bancaria.</p></div>
        <div class="feature"><div class="ico">${icon('refresh', 22)}</div><h4>Cobros recurrentes</h4><p>Guarda la tarjeta con token seguro para tus suscripciones o pagos mensuales.</p></div>
      </div>
    </div>
  </section>

  <section class="block" id="tarifas">
    <div class="wrap">
      <div class="section-head">
        <h2>Tarifas claras</h2>
        <p>Sin cargos escondidos. Lo que ves es lo que pagas.</p>
      </div>
      <div class="grid4">
        <div class="feature"><div class="ico">${icon('chart', 22)}</div><h4>${fees.percent ?? 3.5}% + ${money(fees.fixed_cents ?? 50, 'USD')}</h4><p>Comisión por envío. Se muestra antes de pagar.</p></div>
        <div class="feature"><div class="ico">${icon('bank', 22)}</div><h4>${fees.withdrawal_fee_percent ?? 1}%</h4><p>Retiro del saldo de la plataforma vía BRE-B.</p></div>
        <div class="feature"><div class="ico">${icon('bolt', 22)}</div><h4>Entrega inmediata</h4><p>Sin costo adicional por velocidad.</p></div>
        <div class="feature"><div class="ico">${icon('shield', 22)}</div><h4>Datos cifrados</h4><p>Cédulas y cuentas protegidas con AES-256-GCM.</p></div>
      </div>
    </div>
  </section>
  ${footer()}`;
}

/* ---------------- wizard ---------------- */
function wizardView() {
  const d = state.draft;
  const steps = ['Monto', 'Tus datos', 'Beneficiario', 'Pago'];
  const pct = (state.step / 4) * 100;
  let body = '';

  if (state.step === 1) {
    const isVes = d.currency === 'VES';
    const minLabel = isVes ? money(50000, 'VES') : money(state.config?.fees?.min_order_cents ?? 500, 'USD');
    const maxLabel = isVes ? money(500000000, 'VES') : money(state.config?.fees?.max_order_cents ?? 500000, 'USD');
    body = `
      <label class="field">
        <span>Pagas desde</span>
        <select class="input" id="w-payer">
          ${PAYER_COUNTRIES.map((x) => `<option value="${x.code}" ${x.code === d.payerCountry ? 'selected' : ''}>${x.name}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span>¿Cuánto deseas ${d.payerCountry === 'VE' ? 'pagar' : 'enviar'}?</span>
        <div class="amount-input">
          <input class="input" id="w-amount" type="number" min="${isVes ? 500 : 5}" step="1" value="${d.amount}" />
          <span class="cur">${d.currency}</span>
        </div>
        <div class="hint">Mínimo ${minLabel} · Máximo ${maxLabel}</div>
      </label>
      <label class="field">
        <span>País de destino</span>
        <select class="input" id="w-country" ${d.payerCountry === 'VE' ? 'disabled' : ''}>
          ${COUNTRIES.map((x) => `<option value="${x.code}" ${x.code === d.country ? 'selected' : ''}>${x.name}</option>`).join('')}
        </select>
        ${d.payerCountry === 'VE' ? '<div class="hint">Los pagos desde Venezuela se entregan dentro de Venezuela.</div>' : ''}
      </label>
      <div class="quote-box" id="w-quote"></div>`;
  }

  if (state.step === 2) {
    body = `
      <label class="field">
        <span>Nombre y apellido</span>
        <input class="input" id="w-name" placeholder="María Alejandra Pérez" value="${esc(d.fullName)}" />
      </label>
      <label class="field">
        <span>Cédula de identidad venezolana</span>
        <input class="input" id="w-doc" placeholder="V-12345678" value="${esc(d.document)}" autocomplete="off" />
        <div class="hint" id="w-doc-hint">Formatos válidos: V-12345678, E-12345678, J-123456789, P-1234567</div>
      </label>
      <div class="row2">
        <label class="field">
          <span>Correo electrónico</span>
          <input class="input" id="w-email" type="email" placeholder="tu@correo.com" value="${esc(d.email)}" />
        </label>
        <label class="field">
          <span>Teléfono</span>
          <input class="input" id="w-phone" placeholder="+58 412 000 0000" value="${esc(d.phone)}" />
        </label>
      </div>
      <div class="hint">Usamos tu cédula para verificar tu identidad y proteger la operación. Se almacena cifrada.</div>`;
  }

  if (state.step === 3) {
    const rails = railsFor(d.payerCountry, d.country);
    const isVeRail = ['pago_movil_ve', 'transfer_ve', 'cash_ve'].includes(d.rail);
    const banks = d.country === 'VE' || d.payerCountry === 'VE' ? VE_BANKS : (state.config?.pse?.banks || []);
    const railIcons = {
      pago_movil: 'phone',
      breb: 'bolt',
      bank: 'bank',
      pago_movil_ve: 'phone',
      transfer_ve: 'bank',
      cash_ve: 'cash',
    };
    const railSubs = {
      pago_movil: 'Instantáneo a su banco',
      breb: 'Llave instantánea',
      bank: 'Transferencia',
      pago_movil_ve: 'Débito inmediato en VES',
      transfer_ve: 'Cuenta bancaria en VES',
      cash_ve: 'Retiro en efectivo',
    };
    body = `
      <label class="field">
        <span>Nombre del beneficiario</span>
        <input class="input" id="w-bname" placeholder="Luis Gómez" value="${esc(d.beneficiaryName)}" />
      </label>
      <label class="field">
        <span>Cédula del beneficiario</span>
        <input class="input" id="w-bdoc" placeholder="V-23456789" value="${esc(d.beneficiaryDocument)}" />
        <div class="hint" id="w-bdoc-hint">La cédula venezolana del beneficiario es obligatoria.</div>
      </label>
      <label class="field">
        <span>Vía de entrega</span>
        <div class="choice-grid">
          ${rails.map((r) => `<div class="choice ${d.rail === r ? 'sel' : ''}" data-rail="${r}"><div class="ci">${icon(railIcons[r], 20)}</div><div><strong>${railLabel(r)}</strong><span>${railSubs[r]}</span></div></div>`).join('')}
        </div>
      </label>
      ${d.rail === 'breb' ? `
        <label class="field">
          <span>Tipo de llave BRE-B</span>
          <select class="input" id="w-keytype">
            <option value="cedula" ${d.keyType === 'cedula' ? 'selected' : ''}>Cédula</option>
            <option value="phone" ${d.keyType === 'phone' ? 'selected' : ''}>Teléfono</option>
            <option value="email" ${d.keyType === 'email' ? 'selected' : ''}>Correo</option>
            <option value="alphanumeric" ${d.keyType === 'alphanumeric' ? 'selected' : ''}>Alfanumérica</option>
          </select>
        </label>
        <label class="field">
          <span>Llave BRE-B</span>
          <input class="input" id="w-key" placeholder="Ej. 3001234567 o @llave" value="${esc(d.brebKey)}" />
        </label>` : ''}
      ${d.rail === 'pago_movil' || d.rail === 'pago_movil_ve' ? `
        <div class="row2">
          <label class="field">
            <span>Banco</span>
            <select class="input" id="w-bank">
              <option value="">Selecciona…</option>
              ${banks.map((b) => `<option value="${b.code}" data-name="${esc(b.name)}" ${d.bankCode === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Teléfono de Pago Móvil</span>
            <input class="input" id="w-key" placeholder="04141234567" value="${esc(d.brebKey)}" />
          </label>
        </div>` : ''}
      ${d.rail === 'bank' || d.rail === 'transfer_ve' ? `
        <div class="row2">
          <label class="field">
            <span>Banco</span>
            <select class="input" id="w-bank">
              <option value="">Selecciona…</option>
              ${banks.map((b) => `<option value="${b.code}" data-name="${esc(b.name)}" ${d.bankCode === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Tipo de cuenta</span>
            <select class="input" id="w-acctype">
              <option value="CHECKING">Corriente</option>
              <option value="SAVINGS">Ahorro</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span>Número de cuenta</span>
          <input class="input" id="w-key" placeholder="0102 0000 0000 0000 0000" value="${esc(d.brebKey)}" />
        </label>` : ''}
      ${d.rail === 'cash_ve' ? `
        <div class="hint">El beneficiario retira en efectivo en un agente autorizado presentando su cédula. Le enviaremos un código de retiro.</div>` : ''}`;
  }

  if (state.step === 4) {
    const methods = methodsFor(d.payerCountry).map((id) => ({ id, ...METHOD_CATALOG[id] }));
    body = `
      <label class="field">
        <span>¿Cómo deseas pagar?</span>
        <div class="choice-grid">
          ${methods.map((m) => `<div class="choice ${d.method === m.id ? 'sel' : ''}" data-method="${m.id}"><div class="ci">${icon(m.ico, 20)}</div><div><strong>${m.name}</strong><span>${m.sub}</span></div></div>`).join('')}
        </div>
      </label>
      <label class="field">
        <span>Concepto (opcional)</span>
        <input class="input" id="w-desc" placeholder="Remesa familiar" value="${esc(d.description)}" maxlength="100" />
      </label>
      <div class="summary-list" id="w-summary"></div>
      <div class="hint mt8">Al continuar aceptas los términos y la política de privacidad de RemesaYa.</div>`;
  }

  return `
  ${nav()}
  <div class="wrap">
    <div class="wizard">
      <div class="wizard-steps">${steps.map((_, i) => `<div class="wstep ${i < state.step ? 'active' : ''}"></div>`).join('')}</div>
      <div class="card">
        <div class="wizard-head">
          <h2>${steps[state.step - 1]}</h2>
          <p>Paso ${state.step} de 4 · ${pct}% completado</p>
        </div>
        ${body}
        <div class="wizard-actions">
          ${state.step > 1 ? '<button class="btn btn-ghost" id="w-back">Atrás</button>' : '<a class="btn btn-ghost" href="/" data-link>Cancelar</a>'}
          <button class="btn btn-primary" id="w-next">${state.step === 4 ? 'Crear orden y pagar' : 'Continuar'}</button>
        </div>
      </div>
    </div>
  </div>`;
}

function bindWizard() {
  const d = state.draft;

  const amountEl = $('#w-amount');
  if (amountEl) {
    const update = () => {
      d.amount = Number(amountEl.value) || 0;
      refreshQuote();
    };
    amountEl.addEventListener('input', update);
    $('#w-country')?.addEventListener('change', (e) => {
      d.country = e.target.value;
      refreshQuote();
    });
    $('#w-payer')?.addEventListener('change', (e) => {
      d.payerCountry = e.target.value;
      d.currency = payerCurrency(d.payerCountry);
      const allowed = methodsFor(d.payerCountry);
      if (!allowed.includes(d.method)) d.method = allowed[0];
      const rails = railsFor(d.payerCountry, d.country);
      if (!rails.includes(d.rail)) d.rail = rails[0];
      if (d.payerCountry === 'VE') {
        d.country = 'VE';
        d.currency = 'VES';
      }
      if (d.method === 'pse' || d.method === 'breb') d.currency = 'COP';
      render();
    });
    refreshQuote();
  }

  document.querySelectorAll('[data-rail]').forEach((el) => {
    el.addEventListener('click', () => {
      d.rail = el.dataset.rail;
      if (d.rail === 'breb') d.keyType = 'cedula';
      render();
    });
  });

  document.querySelectorAll('[data-method]').forEach((el) => {
    el.addEventListener('click', () => {
      d.method = el.dataset.method;
      document.querySelectorAll('[data-method]').forEach((x) => x.classList.toggle('sel', x === el));
      renderSummary();
    });
  });

  const docEl = $('#w-doc');
  if (docEl) {
    let t;
    docEl.addEventListener('input', () => {
      d.document = docEl.value;
      clearTimeout(t);
      t = setTimeout(async () => {
        const hint = $('#w-doc-hint');
        if (!docEl.value.trim()) return;
        try {
          const r = await api('/validate-document', { method: 'POST', body: JSON.stringify({ document: docEl.value }) });
          docEl.classList.toggle('err', !r.valid);
          hint.className = `hint ${r.valid ? 'ok' : 'error'}`;
          hint.textContent = r.valid ? `Cédula válida (${r.type}) · ${r.masked}` : r.error;
        } catch {
          /* silencioso */
        }
      }, 350);
    });
  }

  const bdocEl = $('#w-bdoc');
  if (bdocEl) {
    let t;
    bdocEl.addEventListener('input', () => {
      d.beneficiaryDocument = bdocEl.value;
      clearTimeout(t);
      t = setTimeout(async () => {
        const hint = $('#w-bdoc-hint');
        if (!bdocEl.value.trim()) return;
        try {
          const r = await api('/validate-document', { method: 'POST', body: JSON.stringify({ document: bdocEl.value }) });
          bdocEl.classList.toggle('err', !r.valid);
          hint.className = `hint ${r.valid ? 'ok' : 'error'}`;
          hint.textContent = r.valid ? `Cédula válida · ${r.masked}` : r.error;
        } catch {
          /* silencioso */
        }
      }, 350);
    });
  }

  $('#w-back')?.addEventListener('click', () => {
    state.step = Math.max(1, state.step - 1);
    render();
  });

  $('#w-next')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!collectStep()) return;
    if (state.step < 4) {
      state.step += 1;
      render();
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creando orden…';
    try {
      const payload = buildPayload();
      const res = await api('/orders', { method: 'POST', body: JSON.stringify(payload) });
      state.order = res.order;
      toast('Orden creada. Continúa con el pago.', 'ok');
      navigate(res.order.checkout_url || `/pay/${res.order.public_id}`);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = 'Crear orden y pagar';
    }
  });

  if (state.step === 4) renderSummary();
}

function collectStep() {
  const d = state.draft;
  if (state.step === 1) {
    const minAmount = d.currency === 'VES' ? 500 : 5;
    if (!d.amount || d.amount < minAmount) return toast(`Ingresa un monto válido (mínimo ${minAmount} ${d.currency}).`, 'err'), false;
    return true;
  }
  if (state.step === 2) {
    d.fullName = $('#w-name')?.value.trim() || d.fullName;
    d.document = $('#w-doc')?.value.trim() || d.document;
    d.email = $('#w-email')?.value.trim() || d.email;
    d.phone = $('#w-phone')?.value.trim() || d.phone;
    if (d.fullName.length < 3) return toast('Escribe tu nombre completo.', 'err'), false;
    if (!d.document) return toast('Ingresa tu cédula venezolana.', 'err'), false;
    return true;
  }
  if (state.step === 3) {
    d.beneficiaryName = $('#w-bname')?.value.trim() || d.beneficiaryName;
    d.beneficiaryDocument = $('#w-bdoc')?.value.trim() || d.beneficiaryDocument;
    const keyEl = $('#w-key');
    if (keyEl) d.brebKey = keyEl.value.trim();
    const bankEl = $('#w-bank');
    if (bankEl) {
      d.bankCode = bankEl.value;
      d.bankName = bankEl.selectedOptions[0]?.dataset.name || '';
    }
    const ktEl = $('#w-keytype');
    if (ktEl) d.keyType = ktEl.value;
    const atEl = $('#w-acctype');
    if (atEl) d.accountType = atEl.value;
    if (d.beneficiaryName.length < 3) return toast('Escribe el nombre del beneficiario.', 'err'), false;
    if (!d.beneficiaryDocument) return toast('Ingresa la cédula del beneficiario.', 'err'), false;
    if (d.rail !== 'cash_ve' && !d.brebKey) return toast('Ingresa la llave, teléfono o cuenta de entrega.', 'err'), false;
    if (['pago_movil', 'pago_movil_ve', 'bank', 'transfer_ve'].includes(d.rail) && !d.bankCode) {
      return toast('Selecciona el banco.', 'err'), false;
    }
    if (d.rail === 'bank' || d.rail === 'transfer_ve') d.accountNumber = d.brebKey;
    return true;
  }
  if (state.step === 4) {
    d.description = $('#w-desc')?.value.trim() || '';
    if (d.method === 'pse' && d.currency !== 'COP') {
      toast('PSE opera en pesos colombianos. Cambia la moneda a COP.', 'err');
      return false;
    }
    if (d.method.startsWith('ve_') && d.currency !== 'VES') {
      toast('Los pagos desde Venezuela se procesan en bolívares (VES).', 'err');
      return false;
    }
    return true;
  }
  return true;
}

function buildPayload() {
  const d = state.draft;
  const isVe = d.method.startsWith('ve_');
  const currency = isVe ? 'VES' : ['pse', 'breb'].includes(d.method) ? 'COP' : d.currency;
  return {
    fullName: d.fullName,
    email: d.email || undefined,
    phone: d.phone || undefined,
    document: d.document,
    beneficiaryName: d.beneficiaryName,
    beneficiaryDocument: d.beneficiaryDocument,
    rail: d.rail,
    keyType: d.rail === 'breb' ? d.keyType : 'phone',
    brebKey: d.brebKey,
    bankCode: d.bankCode || undefined,
    bankName: d.bankName || undefined,
    accountNumber: d.rail === 'bank' || d.rail === 'transfer_ve' ? d.accountNumber || d.brebKey : undefined,
    accountType: d.accountType,
    amountCents: Math.round(Number(d.amount) * 100),
    currency,
    payerCountry: isVe ? 'VE' : d.method === 'pse' ? 'CO' : d.payerCountry || 'US',
    country: isVe ? 'VE' : d.country,
    method: d.method,
    description: d.description || undefined,
  };
}

async function refreshQuote() {
  const d = state.draft;
  const box = $('#w-quote') || $('#calc-quote');
  if (!box) return;
  const amountCents = Math.round(Number(d.amount) * 100);
  if (!amountCents) return;
  try {
    const q = await api('/quote', {
      method: 'POST',
      body: JSON.stringify({ amountCents, currency: d.currency, country: d.country, method: d.method }),
    });
    state.quote = q;
    box.innerHTML = `
      <div class="quote-row"><span>Envías</span><strong>${q.amount_formatted}</strong></div>
      <div class="quote-row"><span>Comisión (${q.fee_percent}%)</span><strong>${q.fee_formatted}</strong></div>
      <div class="quote-row total"><span>Total a pagar</span><strong>${q.total_formatted}</strong></div>
      <div class="quote-row"><span>Recibe tu beneficiario</span><strong>${q.destination_amount_formatted}</strong></div>
      <div class="quote-row"><span>Tasa</span><strong>1 ${q.currency} = ${q.fx_rate} ${q.destination_currency}</strong></div>`;
    return q;
  } catch (err) {
    box.innerHTML = `<div class="quote-row"><span style="color:var(--danger)">${esc(err.message)}</span></div>`;
    return null;
  }
}

async function renderSummary() {
  const el = $('#w-summary');
  if (!el) return;
  const d = state.draft;
  const q = await refreshQuote();
  if (!q) return;
  el.innerHTML = `
    <div class="sr"><span>Envías</span><strong>${q.amount_formatted}</strong></div>
    <div class="sr"><span>Comisión</span><strong>${q.fee_formatted}</strong></div>
    <div class="sr"><span>Total</span><strong>${q.total_formatted}</strong></div>
    <div class="sr"><span>Beneficiario</span><strong>${esc(d.beneficiaryName)}</strong></div>
    <div class="sr"><span>Cédula</span><strong>${esc(d.beneficiaryDocument)}</strong></div>
    <div class="sr"><span>Entrega</span><strong>${railLabel(d.rail)}</strong></div>
    <div class="sr"><span>Recibe</span><strong style="color:var(--brand)">${q.destination_amount_formatted}</strong></div>`;
}

/* ---------------- checkout ---------------- */
async function checkoutView(publicId) {
  let order = state.order;
  if (!order || order.public_id !== publicId) {
    try {
      const res = await api(`/orders/${publicId}`);
      order = res.order;
      state.order = order;
    } catch (err) {
      return `<div class="wrap"><div class="checkout card"><h2>Orden no encontrada</h2><p class="muted mt8">Verifica el enlace o crea una nueva operación.</p><a class="btn btn-primary mt16" href="/enviar" data-link>Nueva remesa</a></div></div>`;
    }
  }
  if (['approved', 'completed', 'rejected', 'declined', 'failed'].includes(order.status)) {
    navigate(`/success/${order.public_id}`, true);
    return '';
  }

  const isDemo = ['demo', 'pse_simulator', 'breb_simulator', 'vepay_simulator'].includes(order.provider);
  let panel = '';

  if (order.method === 'card_transparent') {
    panel = `
      <div class="panel" style="margin:0">
        <div class="card-title">Datos de la tarjeta</div>
        <div class="card-sub">Procesado de forma segura con SmartFields de dLocal Go.</div>
        <label class="field"><span>Número de tarjeta</span><input class="input" id="cc-num" placeholder="4111 1111 1111 1111" inputmode="numeric" /></label>
        <div class="row2">
          <label class="field"><span>Vencimiento</span><input class="input" id="cc-exp" placeholder="MM/AA" /></label>
          <label class="field"><span>CVV</span><input class="input" id="cc-cvv" placeholder="123" inputmode="numeric" /></label>
        </div>
        <label class="field"><span>Nombre del titular</span><input class="input" id="cc-name" placeholder="Como aparece en la tarjeta" /></label>
        <label class="field"><span>Cuotas</span><select class="input" id="cc-inst"><option value="">1 cuota (sin interés)</option></select></label>
        <button class="btn btn-primary btn-block" id="cc-pay">Pagar ${order.amount_formatted}</button>
        <div class="hint mt8">Los datos de tu tarjeta nunca pasan por nuestros servidores: se tokenizan directamente con dLocal Go.</div>
      </div>`;
  } else if (order.method === 'pse') {
    const banks = state.config?.pse?.banks || [];
    panel = `
      <div class="panel" style="margin:0">
        <div class="card-title">Paga con PSE</div>
        <div class="card-sub">Selecciona tu banco colombiano y confirma el débito.</div>
        <div class="bank-grid" id="bank-grid">
          ${banks.map((b) => `<div class="bank-item" data-code="${b.code}">${esc(b.name)}</div>`).join('')}
        </div>
        <button class="btn btn-primary btn-block mt16" id="pse-pay" disabled>Ir al banco</button>
        <div class="hint mt8">Serás redirigido al portal de tu banco para autorizar el pago.</div>
      </div>`;
  } else if (order.method === 'breb') {
    panel = `
      <div class="panel" style="margin:0">
        <div class="card-title">Paga con BRE-B</div>
        <div class="card-sub">Transfiere el monto exacto a nuestra llave y la orden se aprueba al instante.</div>
        <div class="summary-list">
          <div class="sr"><span>Llave BRE-B</span><strong class="mono">${esc(state.config?.breb?.merchant_key || '@remesaya')}</strong></div>
          <div class="sr"><span>Monto exacto</span><strong>${order.amount_formatted}</strong></div>
          <div class="sr"><span>Referencia</span><strong class="mono">${esc(order.public_id)}</strong></div>
        </div>
        <button class="btn btn-primary btn-block mt16" id="breb-paid">Ya realicé la transferencia</button>
        <div class="hint mt8">La confirmación llega automáticamente por webhook BRE-B.</div>
      </div>`;
  } else if (order.method === 'cash') {
    panel = `
      <div class="panel" style="margin:0">
        <div class="card-title">Pago en efectivo</div>
        <div class="card-sub">Presenta este código en el punto de pago autorizado.</div>
        <div style="text-align:center;padding:22px 0">
          <div class="mono" style="font-size:1.7rem;font-weight:800;letter-spacing:0.12em">${esc(order.public_id)}</div>
          <div class="hint mt8">Válido por 24 horas · Monto ${order.amount_formatted}</div>
        </div>
        <button class="btn btn-primary btn-block" id="cash-paid">Ya pagué en efectivo</button>
      </div>`;
  } else if (String(order.method).startsWith('ve_')) {
    const ins = order.metadata?.instructions || {};
    const m = ins.merchant || {};
    const code = order.metadata?.payment_code || ins.payment_code || '—';
    const isCash = order.method === 've_cash';
    panel = `
      <div class="panel" style="margin:0">
        <div class="card-title">${isCash ? 'Paga en efectivo en Venezuela' : order.method === 've_pago_movil' ? 'Paga con Pago Móvil' : 'Paga con transferencia bancaria'}</div>
        <div class="card-sub">${isCash ? 'Presenta este código en un agente autorizado y paga el monto exacto.' : 'Envía el monto exacto a los datos del comercio y la orden se aprueba al instante.'}</div>
        <div class="summary-list">
          ${isCash ? `
            <div class="sr"><span>Código de pago</span><strong class="mono">${esc(code)}</strong></div>
          ` : `
            <div class="sr"><span>Titular</span><strong>${esc(m.name || 'RemesaYa')}</strong></div>
            ${m.document ? `<div class="sr"><span>RIF / Cédula</span><strong class="mono">${esc(m.document)}</strong></div>` : ''}
            ${m.phone ? `<div class="sr"><span>Pago Móvil</span><strong class="mono">${esc(m.phone)}</strong></div>` : ''}
            ${m.bank ? `<div class="sr"><span>Banco</span><strong class="mono">${esc(m.bank)}</strong></div>` : ''}
            ${m.account ? `<div class="sr"><span>Cuenta</span><strong class="mono">${esc(m.account)}</strong></div>` : ''}
          `}
          <div class="sr"><span>Monto exacto</span><strong>${order.amount_formatted}</strong></div>
          <div class="sr"><span>Referencia</span><strong class="mono">${esc(order.public_id)}</strong></div>
        </div>
        <button class="btn btn-primary btn-block mt16" id="ve-paid">${isCash ? 'Ya pagué en efectivo' : 'Ya realicé el pago'}</button>
        <div class="hint mt8">La confirmación llega automáticamente por webhook del agregador venezolano.</div>
      </div>`;
  } else {
    panel = `
      <div class="panel" style="margin:0">
        <div class="card-title">Pago con tarjeta</div>
        <div class="card-sub">Serás dirigido al checkout seguro de dLocal Go para completar el pago con 3D Secure.</div>
        <div style="text-align:center;padding:16px 0">
          <div class="pay-ico">${icon('card', 40)}</div>
        </div>
        <button class="btn btn-primary btn-block" id="hosted-pay">Pagar ${order.amount_formatted}</button>
        <div class="hint mt8">Acepta Visa, Mastercard y American Express.</div>
      </div>`;
  }

  const demoBox = isDemo
    ? `<div class="panel" style="margin:16px 0 0;border-color:rgba(255,207,77,0.35);background:rgba(255,207,77,0.05)">
        <div class="flex between center gap12" style="flex-wrap:wrap">
          <div>
            <strong style="font-size:0.9rem">Modo demostración</strong>
            <div class="hint" style="margin-top:4px">Esta operación usa el simulador. Puedes aprobar o rechazar el pago para probar el flujo completo.</div>
          </div>
          <div class="flex gap8">
            <button class="btn btn-sm btn-ghost" id="demo-decline">Rechazar</button>
            <button class="btn btn-sm btn-primary" id="demo-approve">Aprobar pago</button>
          </div>
        </div>
      </div>`
    : '';

  return `
  ${nav()}
  <div class="wrap">
    <div class="checkout">
      <div class="co-head">
        ${statusBadge(order.status)}
        <div class="amount mt16">${order.amount_formatted}</div>
        <div class="sub">Orden <span class="mono">${esc(order.public_id)}</span> · Recibe ${order.destination_amount_formatted}</div>
      </div>
      <div class="card">
        <div class="summary-list" style="margin-bottom:18px">
          <div class="sr"><span>Beneficiario</span><strong>${esc(order.beneficiary_name)}</strong></div>
          <div class="sr"><span>Cédula</span><strong>${esc(order.beneficiary_doc_type)}-***${esc(order.beneficiary_doc_last4)}</strong></div>
          <div class="sr"><span>Entrega</span><strong>${railLabel(order.rail)}</strong></div>
          <div class="sr"><span>Comisión</span><strong>${order.fee_formatted}</strong></div>
        </div>
        ${panel}
        ${demoBox}
      </div>
      <div class="hint mt16" style="text-align:center">¿Problemas con tu pago? Escríbenos a ${esc(state.config?.support?.email || 'soporte@remesaya.app')}</div>
    </div>
  </div>`;
}

function bindCheckout(publicId) {
  const approve = async (status) => {
    try {
      await api(`/orders/${publicId}/demo-${status}`, { method: 'POST' });
      toast(status === 'approve' ? 'Pago aprobado. Entrega en proceso.' : 'Pago rechazado.', status === 'approve' ? 'ok' : 'err');
      navigate(`/success/${publicId}`);
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  $('#demo-approve')?.addEventListener('click', () => approve('approve'));
  $('#demo-decline')?.addEventListener('click', () => approve('decline'));

  document.querySelectorAll('#bank-grid .bank-item').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('#bank-grid .bank-item').forEach((x) => x.classList.toggle('sel', x === el));
      const btn = $('#pse-pay');
      if (btn) btn.disabled = false;
    });
  });

  $('#pse-pay')?.addEventListener('click', () => {
    toast('Redirigiendo al banco (simulado)…');
    setTimeout(() => approve('approve'), 900);
  });

  ['#breb-paid', '#cash-paid', '#ve-paid', '#hosted-pay'].forEach((sel) => {
    $(sel)?.addEventListener('click', () => {
      const isDemo = ['demo', 'pse_simulator', 'breb_simulator', 'vepay_simulator'].includes(state.order?.provider);
      if (isDemo) approve('approve');
      else if (state.order?.checkout_url?.startsWith('http')) window.location.href = state.order.checkout_url;
      else toast('Esperando confirmación del proveedor…');
    });
  });

  $('#cc-pay')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const num = ($('#cc-num')?.value || '').replace(/\s/g, '');
    if (num.length < 13) return toast('Número de tarjeta inválido.', 'err');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Procesando…';
    try {
      const res = await api(`/orders/${publicId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ cardToken: `tok_demo_${num.slice(-4)}`, installmentsId: $('#cc-inst')?.value || undefined }),
      });
      if (res.requires_3ds && res.redirect_url) {
        window.location.href = res.redirect_url;
        return;
      }
      navigate(`/success/${publicId}`);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = 'Reintentar pago';
    }
  });
}

/* ---------------- success / tracking ---------------- */
async function successView(publicId) {
  let order = state.order;
  try {
    const res = await api(`/orders/${publicId}`);
    order = res.order;
    state.order = order;
  } catch {
    return `<div class="wrap"><div class="checkout card"><h2>Orden no encontrada</h2><a class="btn btn-primary mt16" href="/" data-link>Volver al inicio</a></div></div>`;
  }

  const ok = ['approved', 'completed'].includes(order.status);
  const bad = ['rejected', 'declined', 'failed', 'cancelled'].includes(order.status);

  const timeline = [
    { t: 'Orden creada', d: order.created_at, done: true },
    { t: 'Pago confirmado', d: order.updated_at, done: ok },
    { t: 'Entrega al beneficiario', d: ok ? order.updated_at : '—', done: order.status === 'completed' },
    { t: 'Comprobante disponible', d: ok ? order.updated_at : '—', done: ok },
  ];

  return `
  ${nav()}
  <div class="wrap">
    <div class="checkout">
      <div class="card" style="text-align:center">
        <div style="font-size:3.4rem;line-height:1">${ok ? icon('checkCircle', 54) : bad ? icon('alert', 54) : icon('clock', 54)}</div>
        <h2 class="mt16">${ok ? '¡Envío exitoso!' : bad ? 'El pago no se completó' : 'Procesando tu pago'}</h2>
        <p class="muted mt8">${ok ? 'Tu beneficiario ya puede disponer del dinero.' : bad ? 'No se realizó ningún cargo. Puedes intentarlo de nuevo.' : 'Estamos confirmando la operación con el proveedor.'}</p>
        <div class="mt24" style="font-size:2rem;font-weight:800">${order.destination_amount_formatted}</div>
        <div class="hint">para ${esc(order.beneficiary_name)} · ${esc(order.beneficiary_doc_type)}-***${esc(order.beneficiary_doc_last4)}</div>
        <div class="mt16">${statusBadge(order.status)}</div>
        <div class="summary-list mt24" style="text-align:left">
          <div class="sr"><span>Orden</span><strong class="mono">${esc(order.public_id)}</strong></div>
          <div class="sr"><span>Monto enviado</span><strong>${order.amount_formatted}</strong></div>
          <div class="sr"><span>Comisión</span><strong>${order.fee_formatted}</strong></div>
          <div class="sr"><span>Vía de entrega</span><strong>${railLabel(order.rail)}</strong></div>
          <div class="sr"><span>Tasa aplicada</span><strong>1 ${esc(order.currency)} = ${order.fx_rate} ${esc(order.destination_currency)}</strong></div>
        </div>
        <div class="timeline mt24" style="text-align:left">
          ${timeline.map((x) => `<div class="tl-item"><div class="tl-dot ${x.done ? 'done' : ''}">${x.done ? icon('check', 12) : '•'}</div><div class="tl-body"><strong>${x.t}</strong><span>${esc(x.d)}</span></div></div>`).join('')}
        </div>
        <div class="flex gap12 mt16">
          <a class="btn btn-ghost btn-block" href="/" data-link>Inicio</a>
          <button class="btn btn-primary btn-block" onclick="window.print()">Guardar comprobante</button>
        </div>
        ${ok ? `<div class="hint mt16">Guarda tu número de orden: <strong class="mono">${esc(order.public_id)}</strong></div>` : ''}
      </div>
    </div>
  </div>`;
}

/* ---------------- router ---------------- */
async function ensureConfig() {
  if (state.config) return;
  try {
    state.config = await api('/config');
  } catch {
    state.config = {};
  }
}

async function render() {
  await ensureConfig();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);

  if (parts[0] === 'admin') {
    window.location.href = '/admin.html';
    return;
  }

  let html = '';
  let bind = null;

  if (path === '/' || path === '') {
    html = landingView();
    bind = bindLanding;
  } else if (parts[0] === 'enviar') {
    html = wizardView();
    bind = bindWizard;
  } else if (parts[0] === 'pay' && parts[1]) {
    html = await checkoutView(parts[parts.length - 1]);
    if (html) bind = () => bindCheckout(parts[parts.length - 1]);
  } else if (parts[0] === 'success' && parts[1]) {
    html = await successView(parts[1]);
  } else {
    html = landingView();
    bind = bindLanding;
  }

  app().innerHTML = html;
  if (bind) bind();

  document.querySelectorAll('[data-link]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      navigate(a.getAttribute('href'));
    });
  });
  document.querySelectorAll('[data-anchor]').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (window.location.pathname !== '/') return;
      e.preventDefault();
      const id = a.getAttribute('href').split('#')[1];
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    });
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function bindLanding() {
  const amountEl = $('#calc-amount');
  const countryEl = $('#calc-country');
  const methodEl = $('#calc-method');
  const payerEl = $('#calc-payer');
  const curEl = $('#calc-cur');

  const fillMethods = () => {
    const payer = payerEl?.value || 'US';
    const allowed = methodsFor(payer);
    if (methodEl) {
      methodEl.innerHTML = allowed.map((id) => `<option value="${id}">${METHOD_CATALOG[id].name}</option>`).join('');
    }
    if (curEl) curEl.textContent = payerCurrency(payer);
    if (payer === 'VE' && countryEl) {
      countryEl.value = 'VE';
      countryEl.disabled = true;
    } else if (countryEl) {
      countryEl.disabled = false;
    }
  };

  const sync = () => {
    const payer = payerEl?.value || 'US';
    state.draft.amount = Number(amountEl.value) || 0;
    state.draft.country = countryEl.value;
    state.draft.payerCountry = payer;
    state.draft.currency = payerCurrency(payer);
    state.draft.method = methodEl.value;
    refreshQuote();
  };

  fillMethods();
  amountEl?.addEventListener('input', sync);
  countryEl?.addEventListener('change', sync);
  methodEl?.addEventListener('change', sync);
  payerEl?.addEventListener('change', () => {
    fillMethods();
    sync();
  });
  sync();

  $('#calc-go')?.addEventListener('click', () => {
    const payer = payerEl?.value || 'US';
    state.draft.amount = Number(amountEl.value) || 100;
    state.draft.country = payer === 'VE' ? 'VE' : countryEl.value;
    state.draft.payerCountry = payer;
    state.draft.currency = payerCurrency(payer);
    state.draft.method = methodEl.value;
    const rails = railsFor(payer, state.draft.country);
    state.draft.rail = rails[0];
    state.step = 1;
    navigate('/enviar');
  });
}

render();
