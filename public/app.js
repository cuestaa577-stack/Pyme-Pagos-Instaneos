/* RemesaYa — frontend público (envíos y cobros multi-país) */
'use strict';

const ZERO_DECIMAL = ['CLP', 'COP', 'PYG', 'VES'];

const state = {
  config: null,
  draft: {
    direction: 'send',
    amount: 100,
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
    keyValue: '',
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

/* ---------------- catálogo de países y métodos ---------------- */

const FALLBACK_COUNTRIES = [
  { code: 'VE', name: 'Venezuela', currency: 'VES', pay: ['ve_pago_movil', 've_transfer', 've_cash', 'card'], receive: ['pago_movil_ve', 'transfer_ve', 'cash_ve'], banks: [] },
  { code: 'CO', name: 'Colombia', currency: 'COP', pay: ['pse', 'breb', 'co_nequi', 'co_daviplata', 'card', 'cash'], receive: ['breb', 'pse', 'wallet', 'bank', 'cash_pickup'], banks: [] },
  { code: 'CL', name: 'Chile', currency: 'CLP', pay: ['cl_webpay', 'cl_mercadopago', 'cl_transfer', 'card', 'cash_cl'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
  { code: 'PE', name: 'Perú', currency: 'PEN', pay: ['pe_yape', 'pe_plin', 'pe_transfer', 'card', 'cash_pe'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
  { code: 'AR', name: 'Argentina', currency: 'ARS', pay: ['ar_mercadopago', 'ar_transfer', 'card', 'cash_ar'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
  { code: 'MX', name: 'México', currency: 'MXN', pay: ['mx_spei', 'mx_oxxo', 'mx_transfer', 'card', 'cash_mx'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
  { code: 'EC', name: 'Ecuador', currency: 'USD', pay: ['ec_transfer', 'ec_pichincha', 'card', 'cash_ec'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
  { code: 'PA', name: 'Panamá', currency: 'USD', pay: ['pa_ach', 'pa_yappy', 'card', 'cash_pa'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
  { code: 'DO', name: 'Rep. Dominicana', currency: 'DOP', pay: ['do_tpago', 'do_transfer', 'card', 'cash_do'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
  { code: 'ES', name: 'España', currency: 'EUR', pay: ['es_bizum', 'es_sepa', 'card', 'cash_es'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
  { code: 'US', name: 'Estados Unidos', currency: 'USD', pay: ['us_ach', 'us_zelle', 'card', 'cash_us'], receive: ['bank', 'wallet', 'cash_pickup'], banks: [] },
];

const FLAGS = {
  VE: '🇻🇪', CO: '🇨🇴', CL: '🇨🇱', PE: '🇵🇪', AR: '🇦🇷', MX: '🇲🇽',
  EC: '🇪🇨', PA: '🇵🇦', DO: '🇩🇴', ES: '🇪🇸', US: '🇺🇸',
};

const METHOD_FALLBACK = {
  card: { name: 'Tarjeta', sub: 'Visa / Mastercard', ico: 'card' },
  card_transparent: { name: 'Tarjeta transparente', sub: 'Checkout en la página', ico: 'spark' },
  cash: { name: 'Efectivo', sub: 'Cupón de pago', ico: 'cash' },
  pse: { name: 'PSE', sub: 'Débito bancario Colombia', ico: 'bank' },
  breb: { name: 'BRE-B', sub: 'Transferencia instantánea', ico: 'key' },
  ve_pago_movil: { name: 'Pago Móvil', sub: 'Débito inmediato en bolívares', ico: 'phone' },
  ve_transfer: { name: 'Transferencia', sub: 'Banco venezolano', ico: 'transfer' },
  ve_cash: { name: 'Efectivo', sub: 'Agente en Venezuela', ico: 'cash' },
};

function countries() {
  const list = state.config?.countries;
  return Array.isArray(list) && list.length ? list : FALLBACK_COUNTRIES;
}

function countryByCode(code) {
  return countries().find((c) => c.code === code) || countries()[0];
}

function flagOf(code) {
  return FLAGS[code] || '🌎';
}

function currencyOf(code) {
  return countryByCode(code)?.currency || 'USD';
}

function methodsFor(code) {
  const c = countryByCode(code);
  const list = c?.pay || ['card', 'card_transparent'];
  return Array.from(new Set(list));
}

function methodInfo(id) {
  return state.config?.catalog?.methods?.[id] || METHOD_FALLBACK[id] || { name: id, sub: '', ico: 'card' };
}

function railsFor(code) {
  const c = countryByCode(code);
  return c?.receive || ['bank'];
}

function banksFor(code) {
  return countryByCode(code)?.banks || [];
}

function railLabel(rail) {
  return {
    breb: 'BRE-B',
    pago_movil: 'Pago Móvil',
    bank: 'Cuenta bancaria',
    pago_movil_ve: 'Pago Móvil (VES)',
    transfer_ve: 'Transferencia bancaria (VES)',
    cash_ve: 'Efectivo en Venezuela',
    wallet: 'Billetera digital',
    cash_pickup: 'Efectivo en punto de pago',
  }[rail] || 'Cuenta bancaria';
}

function railIcon(rail) {
  return {
    breb: 'key',
    pago_movil: 'phone',
    bank: 'bank',
    pago_movil_ve: 'phone',
    transfer_ve: 'bank',
    cash_ve: 'cash',
    wallet: 'wallet',
    cash_pickup: 'cash',
  }[rail] || 'bank';
}

function railSub(rail, code) {
  const cur = currencyOf(code);
  return {
    breb: 'Llave instantánea',
    pago_movil: 'Instantáneo a su banco',
    bank: `Transferencia en ${cur}`,
    pago_movil_ve: 'Débito inmediato en VES',
    transfer_ve: 'Cuenta bancaria en VES',
    cash_ve: 'Retiro en efectivo',
    wallet: 'Nequi, Yape, Mercado Pago…',
    cash_pickup: 'Retiro en efectivo',
  }[rail] || '';
}

function toMinor(amount, currency) {
  const factor = ZERO_DECIMAL.includes(currency) ? 1 : 100;
  return Math.round((Number(amount) || 0) * factor);
}

function toMajor(minor, currency) {
  const factor = ZERO_DECIMAL.includes(currency) ? 1 : 100;
  return Number(minor || 0) / factor;
}

function rateFor(currency) {
  const r = state.config?.rates || {};
  return Number(r[`usd_${String(currency).toLowerCase()}`] || 1);
}

/** Monto en moneda local → centavos de USD. */
function localToUsdCents(amount, currency) {
  return Math.round(((Number(amount) || 0) / rateFor(currency)) * 100);
}

/** Centavos de USD → unidades menores de la moneda local. */
function usdCentsToLocalMinor(cents, currency) {
  return Math.round((Number(cents || 0) / 100) * rateFor(currency) * (ZERO_DECIMAL.includes(currency) ? 1 : 100));
}

/**
 * Monto que se envía a /quote. En modo "recibir" el usuario escribe lo que
 * quiere COBRAR en su moneda local, así que se hace la conversión inversa.
 */
function amountCentsForQuote() {
  const d = state.draft;
  const payerCur = methodInfo(d.method).currency || currencyOf(d.payerCountry);
  if (d.direction === 'receive') {
    const destCur = currencyOf(d.country);
    const netUsd = localToUsdCents(d.amount, destCur);
    return Math.max(1, usdCentsToLocalMinor(netUsd, payerCur));
  }
  return Math.max(1, toMinor(d.amount, payerCur));
}

function defaultAmount(direction, country) {
  if (direction === 'receive') return Math.max(1, Math.round(100 * rateFor(currencyOf(country))));
  return 100;
}

function payerCurrencyForDraft() {
  return methodInfo(state.draft.method).currency || currencyOf(state.draft.payerCountry);
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
function supportPhone() {
  return state.config?.support?.phone || state.config?.support?.whatsapp || '+58 412 000 0000';
}

function whatsappLink(text) {
  const digits = String(supportPhone()).replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text || 'Hola RemesaYa, necesito ayuda con una operación.')}`;
}

function canSend() {
  return state.config?.directions?.send !== false;
}

function canReceive() {
  return state.config?.directions?.receive !== false;
}

function nav() {
  return `
  <div class="topbar">
    <div class="wrap topbar-inner">
      <span class="topbar-item">${icon('phone', 13)} <a href="tel:${esc(String(supportPhone()).replace(/\s/g, ''))}">${esc(supportPhone())}</a></span>
      <span class="topbar-sep"></span>
      <span class="topbar-item">${icon('clock', 13)} ${esc(state.config?.support?.hours || 'Lun a Dom · 8:00 a 22:00')}</span>
      <span class="topbar-item topbar-right">${icon('shield', 13)} Operaciones cifradas AES-256</span>
    </div>
  </div>
  <div class="nav" id="site-nav">
    <div class="wrap nav-inner">
      <a class="logo" href="/" data-link>
        <span class="logo-mark">R</span>
        <span>RemesaYa</span>
      </a>
      <div class="nav-links">
        <a href="/#como-funciona" data-anchor>Cómo funciona</a>
        <a href="/#paises" data-anchor>Países</a>
        <a href="/#vias" data-anchor>Vías de pago</a>
        <a href="/#tarifas" data-anchor>Tarifas</a>
        <a href="/#contacto" data-anchor>Contacto</a>
        <button class="btn btn-ghost btn-sm nav-install" id="ry-install" hidden>${icon('download', 16)} Instalar app</button>
        <a class="nav-login" href="/admin" data-link>${icon('lock', 16)} Iniciar sesión</a>
        ${canReceive() ? '<a class="btn btn-ghost btn-sm" href="/recibir" data-link>Recibir</a>' : ''}
        ${canSend() ? '<a class="btn btn-primary btn-sm" href="/enviar" data-link>Enviar dinero</a>' : ''}
      </div>
      <div class="nav-mobile-actions">
        ${canReceive() ? '<a class="btn btn-ghost btn-sm" href="/recibir" data-link>Recibir</a>' : ''}
        ${canSend() ? '<a class="btn btn-primary btn-sm" href="/enviar" data-link>Enviar</a>' : ''}
        <button class="btn btn-ghost btn-sm nav-install" id="ry-install-m" hidden>${icon('download', 16)}</button>
        <button class="nav-burger" id="nav-burger" aria-label="Menú">${icon('menu', 20)}</button>
      </div>
    </div>
    <div class="nav-drawer" id="nav-drawer">
      <a href="/#como-funciona" data-anchor>Cómo funciona</a>
      <a href="/#paises" data-anchor>Países</a>
      <a href="/#vias" data-anchor>Vías de pago</a>
      <a href="/#tarifas" data-anchor>Tarifas</a>
      <a href="/#contacto" data-anchor>Contacto</a>
      <a href="/admin" data-link>Iniciar sesión</a>
    </div>
  </div>`;
}

function footer() {
  const s = state.config?.support || {};
  const phone = s.phone || s.whatsapp || '+58 412 000 0000';
  return `
  <div class="footer" id="contacto">
    <div class="wrap footer-inner">
      <div class="footer-brand">
        <div class="logo" style="margin-bottom:12px"><span class="logo-mark">R</span><span>RemesaYa</span></div>
        <div class="small muted">Remesas y pagos instantáneos entre Venezuela, Chile, Colombia, Perú, Argentina, México, Ecuador, Panamá, República Dominicana, España y Estados Unidos.</div>
        <div class="footer-social mt16">
          <a class="social" href="${whatsappLink()}" target="_blank" rel="noopener">${icon('phone', 16)} WhatsApp</a>
          <a class="social" href="mailto:${esc(s.email || 'soporte@remesaya.app')}">${icon('mail', 16)} Correo</a>
        </div>
        <div class="small muted mt16">© ${new Date().getFullYear()} RemesaYa. Todos los derechos reservados.</div>
      </div>
      <div class="footer-col">
        <div class="footer-title">Contacto</div>
        <a class="footer-phone" href="tel:${esc(String(phone).replace(/\s/g, ''))}">${esc(phone)}</a>
        <div class="small muted">${esc(s.hours || 'Lun a Dom · 8:00 a 22:00')}</div>
        <div class="small mt8"><a href="${whatsappLink()}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a></div>
        <div class="small mt8"><a href="mailto:${esc(s.email || 'soporte@remesaya.app')}">${esc(s.email || 'soporte@remesaya.app')}</a></div>
      </div>
      <div class="footer-col">
        <div class="footer-title">Operaciones</div>
        <a class="small" href="/enviar" data-link>Enviar dinero</a>
        <a class="small" href="/recibir" data-link>Recibir dinero</a>
        <a class="small" href="/#paises" data-anchor>Países disponibles</a>
        <a class="small" href="/#tarifas" data-anchor>Tarifas y comisiones</a>
      </div>
      <div class="footer-col">
        <div class="footer-title">Legal</div>
        <div class="small">Términos y condiciones</div>
        <div class="small">Política de privacidad</div>
        <div class="small">Prevención de fraude</div>
      </div>
    </div>
    <div class="wrap footer-bottom">
      <span class="small muted">Cumplimos con validación de identidad (KYC) y prevención de lavado de activos.</span>
      <span class="small muted">Hecho para la diáspora venezolana 🇻🇪</span>
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
  const list = countries();
  const totalMethods = new Set(list.flatMap((x) => x.pay || [])).size;

  return `
  ${nav()}
  <section class="hero">
    <div class="hero-media" aria-hidden="true"></div>
    <div class="hero-veil" aria-hidden="true"></div>
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <div class="pill"><span class="dot"></span> Envía y recibe · 24/7 · ${list.length} países</div>
        <h1 class="mt16">Envía y recibe dinero <span class="grad">en segundos</span>, desde y hacia ${list.length} países.</h1>
        <p class="lead">RemesaYa conecta Venezuela con Chile, Colombia, Perú, Argentina, México, Ecuador, Panamá, República Dominicana, España y Estados Unidos. Pagas con tarjeta, PSE, BRE-B, Webpay, Yape, SPEI, Bizum, Zelle o efectivo, y tu beneficiario recibe al instante en su banco o billetera.</p>
        <div class="hero-badges">
          <span class="pill">${icon('send', 15)} Enviar</span>
          <span class="pill">${icon('wallet', 15)} Recibir</span>
          <span class="pill">${icon('bolt', 15)} Entrega instantánea</span>
          <span class="pill">${icon('lock', 15)} Datos cifrados</span>
        </div>
        <div class="hero-stats">
          <div><strong>${list.length}</strong><span>Países</span></div>
          <div><strong>${totalMethods}</strong><span>Métodos de pago</span></div>
          <div><strong>${fees.percent ?? 3.5}%</strong><span>Comisión</span></div>
          <div><strong>< 1 min</strong><span>Entrega promedio</span></div>
        </div>
        <div class="hero-cta">
          <a class="btn btn-primary" href="/enviar" data-link>${icon('send', 18)} Enviar dinero</a>
          <a class="btn btn-ghost" href="/recibir" data-link>${icon('wallet', 18)} Quiero recibir</a>
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
            <div class="card-title">Calcula tu operación</div>
            <div class="card-sub">Elige si envías o recibes: ves la comisión y el monto exacto, sin sorpresas.</div>
          </div>
          <div class="seg" id="calc-dir">
            <button class="seg-btn sel" data-dir="send">${icon('send', 15)} Enviar</button>
            <button class="seg-btn" data-dir="receive">${icon('wallet', 15)} Recibir</button>
          </div>
        </div>
        <div class="calc-grid">
          <label class="field">
            <span id="calc-amount-label">Monto a enviar</span>
            <div class="amount-input">
              <input class="input" id="calc-amount" type="number" min="1" step="1" value="100" />
              <span class="cur" id="calc-cur">USD</span>
            </div>
          </label>
          <label class="field">
            <span id="calc-payer-label">Pagas desde</span>
            <select class="input" id="calc-payer">
              ${list.map((x) => `<option value="${x.code}" ${x.code === 'US' ? 'selected' : ''}>${flagOf(x.code)} ${x.name}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span id="calc-country-label">Destino</span>
            <select class="input" id="calc-country">
              ${list.map((x) => `<option value="${x.code}" ${x.code === 'VE' ? 'selected' : ''}>${flagOf(x.code)} ${x.name}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Método de pago</span>
            <select class="input" id="calc-method"></select>
          </label>
        </div>
        <div class="quote-box" id="calc-quote"><div class="quote-row"><span>Calculando…</span></div></div>
        <button class="btn btn-primary btn-block mt16" id="calc-go">Continuar</button>
      </div>
    </section>
  </div>

  <section class="block" id="paises">
    <div class="wrap">
      <div class="section-head">
        <h2>${list.length} países, dos sentidos</h2>
        <p>Puedes <strong>enviar</strong> dinero a cada país y también <strong>recibir</strong> desde él. Todos los métodos locales están habilitados.</p>
      </div>
      <div class="country-grid">
        ${list.map((x) => `
          <div class="country-card">
            <div class="country-head">
              <span class="country-flag">${flagOf(x.code)}</span>
              <div>
                <strong>${esc(x.name)}</strong>
                <span class="country-cur">${esc(x.currency)}</span>
              </div>
            </div>
            <div class="country-split">
              <div>
                <span class="mini-label">${icon('send', 12)} Pagar desde</span>
                <div class="chips">${(x.pay || []).map((m) => `<span class="chip">${esc(methodInfo(m).name)}</span>`).join('')}</div>
              </div>
              <div>
                <span class="mini-label">${icon('wallet', 12)} Recibir en</span>
                <div class="chips">${(x.receive || []).map((r) => `<span class="chip chip-alt">${esc(railLabel(r))}</span>`).join('')}</div>
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>
  </section>

  <section class="block" id="como-funciona">
    <div class="wrap">
      <div class="section-head">
        <h2>Cuatro pasos. Menos de un minuto.</h2>
        <p>Diseñado para que enviar o cobrar sea tan rápido como recibir un mensaje.</p>
      </div>
      <div class="steps">
        <div class="step"><span class="step-n">1</span><h4>Elige enviar o recibir</h4><p>Indica el monto, el país de origen y el de destino. Ves la comisión y la tasa al instante.</p></div>
        <div class="step"><span class="step-n">2</span><h4>Identifícate</h4><p>Cédula venezolana o documento local (RUT, DNI, CURP, DNI/NIE). Validación inmediata.</p></div>
        <div class="step"><span class="step-n">3</span><h4>Paga como prefieras</h4><p>Tarjeta, PSE, BRE-B, Webpay, Yape, SPEI, Bizum, Zelle, Nequi o efectivo.</p></div>
        <div class="step"><span class="step-n">4</span><h4>Entrega instantánea</h4><p>Tu beneficiario recibe en su banco o billetera con comprobante y seguimiento.</p></div>
      </div>
    </div>
  </section>

  <section class="block" id="vias">
    <div class="wrap">
      <div class="section-head">
        <h2>Todos los rieles, una sola plataforma</h2>
        <p>Conectamos cobros internacionales con los métodos que tu familia ya usa en cada país.</p>
      </div>
      <div class="grid3">
        <div class="rail-card">
          <div class="logo-sq rail-breb">BRE-B</div>
          <div><h4>BRE-B Colombia</h4><p class="muted small mt8">Transferencias inmediatas con llave de cédula, teléfono, correo o alfanumérica. Liquidación en segundos.</p></div>
        </div>
        <div class="rail-card">
          <div class="logo-sq rail-pse">PSE</div>
          <div><h4>PSE Colombia</h4><p class="muted small mt8">Débito bancario seguro desde Bancolombia, Davivienda, Bogotá, BBVA y más.</p></div>
        </div>
        <div class="rail-card">
          <div class="logo-sq rail-pm">PM</div>
          <div><h4>Pago Móvil Venezuela</h4><p class="muted small mt8">Entrega inmediata al teléfono y banco del beneficiario, validando su cédula.</p></div>
        </div>
      </div>
      <div class="grid3 mt24">
        <div class="feature"><div class="ico">${icon('card', 22)}</div><h4>Webpay · SPEI · SEPA</h4><p>Rieles locales de Chile, México y España con redirección segura del banco.</p></div>
        <div class="feature"><div class="ico">${icon('wallet', 22)}</div><h4>Yape · Nequi · Bizum · Zelle</h4><p>Billeteras digitales para cobrar y pagar en segundos, solo con teléfono o alias.</p></div>
        <div class="feature"><div class="ico">${icon('cash', 22)}</div><h4>Efectivo</h4><p>OXXO, Servipag, Rapipago, agentes y taquillas: paga sin cuenta bancaria.</p></div>
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
        <div class="feature"><div class="ico">${icon('chart', 22)}</div><h4>${fees.percent ?? 3.5}% + ${money(fees.fixed_cents ?? 50, 'USD')}</h4><p>Comisión por operación. Se muestra antes de pagar.</p></div>
        <div class="feature"><div class="ico">${icon('bank', 22)}</div><h4>${fees.withdrawal_fee_percent ?? 1}%</h4><p>Retiro del saldo de la plataforma.</p></div>
        <div class="feature"><div class="ico">${icon('bolt', 22)}</div><h4>Entrega inmediata</h4><p>Sin costo adicional por velocidad.</p></div>
        <div class="feature"><div class="ico">${icon('shield', 22)}</div><h4>Datos cifrados</h4><p>Documentos y cuentas protegidos con AES-256-GCM.</p></div>
      </div>
    </div>
  </section>

  <section class="block" id="app">
    <div class="wrap">
      <div class="app-card">
        <div class="app-copy">
          <div class="pill">${icon('download', 14)} App instalable</div>
          <h2 class="mt16">Lleva RemesaYa en tu teléfono</h2>
          <p class="muted mt8">Instálala como aplicación en Android, iPhone o computadora. Se abre a pantalla completa, funciona más rápido y conserva tu sesión. También puedes generar un APK para distribuirla.</p>
          <div class="contact-actions mt24">
            <button class="btn btn-primary" id="ry-install-hero">${icon('download', 18)} Instalar la app</button>
            <a class="btn btn-ghost" href="/app.apk" id="ry-apk" hidden>${icon('download', 18)} Descargar APK</a>
          </div>
          <div class="hint mt12" id="ry-install-hint">En Android: menú ⋮ → “Instalar aplicación”. En iPhone: Compartir → “Añadir a pantalla de inicio”.</div>
        </div>
        <div class="app-visual">
          <div class="phone">
            <div class="phone-notch"></div>
            <div class="phone-screen">
              <div class="phone-brand"><span class="logo-mark">R</span> RemesaYa</div>
              <div class="phone-amount">Bs 12.000,00</div>
              <div class="phone-sub">Enviaste USD 100,00 · entrega inmediata</div>
              <div class="phone-rows">
                <div><span>Comisión</span><strong>USD 3,50</strong></div>
                <div><span>Beneficiario</span><strong>María Pérez</strong></div>
                <div><span>Vía</span><strong>Pago Móvil</strong></div>
              </div>
              <div class="phone-btn">Nueva operación</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="block contact-block" id="contacto">
    <div class="wrap">
      <div class="contact-card">
        <div>
          <div class="pill">${icon('phone', 14)} Atención directa</div>
          <h2 class="mt16">¿Necesitas ayuda con tu operación?</h2>
          <p class="muted mt8">Escríbenos por WhatsApp o llámanos. Atendemos todos los días.</p>
          <div class="contact-actions mt24">
            <a class="btn btn-primary" href="${whatsappLink()}" target="_blank" rel="noopener">${icon('phone', 18)} WhatsApp</a>
            <a class="btn btn-ghost" href="mailto:${esc(c.support?.email || 'soporte@remesaya.app')}">${icon('mail', 18)} Correo</a>
          </div>
        </div>
        <div class="contact-info">
          <div class="contact-row"><span>Teléfono</span><a href="tel:${esc(String(supportPhone()).replace(/\s/g, ''))}">${esc(supportPhone())}</a></div>
          <div class="contact-row"><span>Correo</span><a href="mailto:${esc(c.support?.email || 'soporte@remesaya.app')}">${esc(c.support?.email || 'soporte@remesaya.app')}</a></div>
          <div class="contact-row"><span>Horario</span><strong>${esc(c.support?.hours || 'Lun a Dom · 8:00 a 22:00')}</strong></div>
          <div class="contact-row"><span>Cobertura</span><strong>${list.length} países · envío y recepción</strong></div>
        </div>
      </div>
    </div>
  </section>
  ${footer()}`;
}

/* ---------------- wizard ---------------- */
function wizardView() {
  const d = state.draft;
  const isReceive = d.direction === 'receive';
  const steps = ['Monto', 'Tus datos', 'Beneficiario', 'Pago'];
  const pct = (state.step / 4) * 100;
  const list = countries();
  let body = '';

  if (state.step === 1) {
    const payerCur = payerCurrencyForDraft();
    const destCur = currencyOf(d.country);
    const shownCur = isReceive ? destCur : payerCur;
    body = `
      <div class="seg seg-wide" id="w-dir">
        <button class="seg-btn ${!isReceive ? 'sel' : ''}" data-dir="send">${icon('send', 15)} Enviar dinero</button>
        <button class="seg-btn ${isReceive ? 'sel' : ''}" data-dir="receive">${icon('wallet', 15)} Recibir dinero</button>
      </div>
      <div class="row2">
        <label class="field">
          <span>${isReceive ? 'Te envían desde' : 'Pagas desde'}</span>
          <select class="input" id="w-payer">
            ${list.map((x) => `<option value="${x.code}" ${x.code === d.payerCountry ? 'selected' : ''}>${flagOf(x.code)} ${x.name}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>${isReceive ? 'Recibes en' : 'Envías a'}</span>
          <select class="input" id="w-country">
            ${list.map((x) => `<option value="${x.code}" ${x.code === d.country ? 'selected' : ''}>${flagOf(x.code)} ${x.name}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="field">
        <span>${isReceive ? '¿Cuánto quieres recibir?' : '¿Cuánto deseas enviar?'}</span>
        <div class="amount-input">
          <input class="input" id="w-amount" type="number" min="1" step="1" value="${d.amount}" />
          <span class="cur">${shownCur}</span>
        </div>
        <div class="hint">${isReceive ? `Escribes el monto en ${destCur}; calculamos cuánto paga quien te envía.` : `El monto se cobra en ${payerCur}.`}</div>
      </label>
      <div class="quote-box" id="w-quote"></div>`;
  }

  if (state.step === 2) {
    const c = countryByCode(d.direction === 'receive' ? d.country : d.payerCountry);
    body = `
      <label class="field">
        <span>Nombre y apellido</span>
        <input class="input" id="w-name" placeholder="María Alejandra Pérez" value="${esc(d.fullName)}" />
      </label>
      <label class="field">
        <span>Documento de identidad (${esc(c.doc || 'Documento')})</span>
        <input class="input" id="w-doc" placeholder="${esc(c.doc || 'Documento')}" value="${esc(d.document)}" autocomplete="off" />
        <div class="hint" id="w-doc-hint">${d.payerCountry === 'VE' || d.country === 'VE' ? 'Formatos válidos: V-12345678, E-12345678, J-123456789, P-1234567' : `Documento local de ${esc(c.name)}`}</div>
      </label>
      <div class="row2">
        <label class="field">
          <span>Correo electrónico</span>
          <input class="input" id="w-email" type="email" placeholder="tu@correo.com" value="${esc(d.email)}" />
        </label>
        <label class="field">
          <span>Teléfono</span>
          <input class="input" id="w-phone" placeholder="${esc(c.dial || '')} 000 000 0000" value="${esc(d.phone)}" />
        </label>
      </div>
      <div class="hint">Usamos tu documento para verificar tu identidad y proteger la operación. Se almacena cifrado.</div>`;
  }

  if (state.step === 3) {
    const rails = railsFor(d.country);
    if (!rails.includes(d.rail)) d.rail = rails[0];
    const banks = banksFor(d.country);
    const destCur = currencyOf(d.country);
    const c = countryByCode(d.country);
    const needsBank = ['bank', 'pago_movil', 'pago_movil_ve', 'transfer_ve', 'wallet'].includes(d.rail);
    body = `
      <label class="field">
        <span>Nombre del beneficiario</span>
        <input class="input" id="w-bname" placeholder="Luis Gómez" value="${esc(d.beneficiaryName)}" />
      </label>
      <label class="field">
        <span>Documento del beneficiario (${esc(c.doc || 'Documento')})</span>
        <input class="input" id="w-bdoc" placeholder="${esc(c.doc || 'Documento')}" value="${esc(d.beneficiaryDocument)}" />
        <div class="hint" id="w-bdoc-hint">Identificación obligatoria para entregar el dinero.</div>
      </label>
      <label class="field">
        <span>Vía de entrega en ${esc(c.name)}</span>
        <div class="choice-grid">
          ${rails.map((r) => `<div class="choice ${d.rail === r ? 'sel' : ''}" data-rail="${r}"><div class="ci">${icon(railIcon(r), 20)}</div><div><strong>${railLabel(r)}</strong><span>${railSub(r, d.country)}</span></div></div>`).join('')}
        </div>
      </label>
      ${needsBank ? `
        <div class="row2">
          <label class="field">
            <span>${d.rail === 'wallet' ? 'Billetera' : 'Banco'}</span>
            <select class="input" id="w-bank">
              <option value="">Selecciona…</option>
              ${banks.map((b) => `<option value="${b.code}" data-name="${esc(b.name)}" ${d.bankCode === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>${d.rail === 'wallet' ? 'Teléfono o alias' : d.rail === 'bank' || d.rail === 'transfer_ve' ? 'Número de cuenta' : 'Teléfono'}</span>
            <input class="input" id="w-key" placeholder="${d.rail === 'wallet' ? '+56 9 1234 5678 / alias' : d.rail === 'bank' || d.rail === 'transfer_ve' ? 'Número de cuenta / IBAN / CBU' : '04141234567'}" value="${esc(d.keyValue)}" />
          </label>
        </div>
        ${d.rail === 'bank' || d.rail === 'transfer_ve' ? `
        <label class="field">
          <span>Tipo de cuenta</span>
          <select class="input" id="w-acctype">
            <option value="CHECKING" ${d.accountType === 'CHECKING' ? 'selected' : ''}>Corriente</option>
            <option value="SAVINGS" ${d.accountType === 'SAVINGS' ? 'selected' : ''}>Ahorro</option>
          </select>
        </label>` : ''}
      ` : ''}
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
          <input class="input" id="w-key" placeholder="Ej. 3001234567 o @llave" value="${esc(d.keyValue)}" />
        </label>` : ''}
      ${d.rail === 'cash_ve' || d.rail === 'cash_pickup' ? `
        <div class="hint">El beneficiario retira en efectivo en un punto autorizado presentando su documento. Le enviaremos un código de retiro.</div>` : ''}
      <div class="hint">Entrega en ${destCur} · ${esc(c.name)}</div>`;
  }

  if (state.step === 4) {
    const methods = methodsFor(d.payerCountry).map((id) => ({ id, ...methodInfo(id) }));
    body = `
      <label class="field">
        <span>¿Cómo deseas pagar?</span>
        <div class="choice-grid">
          ${methods.map((m) => `<div class="choice ${d.method === m.id ? 'sel' : ''}" data-method="${m.id}"><div class="ci">${icon(m.ico || 'card', 20)}</div><div><strong>${esc(m.name)}</strong><span>${esc(m.sub || '')}</span></div></div>`).join('')}
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
          <div>
            <span class="wizard-tag">${isReceive ? 'Recibir dinero' : 'Enviar dinero'}</span>
            <h2>${steps[state.step - 1]}</h2>
          </div>
          <p>Paso ${state.step} de 4</p>
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

  document.querySelectorAll('#w-dir [data-dir]').forEach((el) => {
    el.addEventListener('click', () => {
      d.direction = el.dataset.dir;
      if (d.direction === 'receive') {
        d.payerCountry = 'US';
        d.country = 'CL';
      } else {
        d.payerCountry = 'US';
        d.country = 'VE';
      }
      const allowed = methodsFor(d.payerCountry);
      if (!allowed.includes(d.method)) d.method = allowed[0];
      const rails = railsFor(d.country);
      if (!rails.includes(d.rail)) d.rail = rails[0];
      d.amount = defaultAmount(d.direction, d.country);
      render();
    });
  });

  const amountEl = $('#w-amount');
  if (amountEl) {
    amountEl.addEventListener('input', () => {
      d.amount = Number(amountEl.value) || 0;
      refreshQuote();
    });
  }

  $('#w-country')?.addEventListener('change', (e) => {
    d.country = e.target.value;
    const rails = railsFor(d.country);
    if (!rails.includes(d.rail)) d.rail = rails[0];
    render();
  });

  $('#w-payer')?.addEventListener('change', (e) => {
    d.payerCountry = e.target.value;
    const allowed = methodsFor(d.payerCountry);
    if (!allowed.includes(d.method)) d.method = allowed[0];
    render();
  });

  document.querySelectorAll('[data-rail]').forEach((el) => {
    el.addEventListener('click', () => {
      d.rail = el.dataset.rail;
      d.bankCode = '';
      d.bankName = '';
      d.keyValue = '';
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
        if (!docEl.value.trim() || !hint) return;
        if (d.payerCountry !== 'VE' && d.country !== 'VE') {
          docEl.classList.remove('err');
          hint.className = 'hint';
          hint.textContent = 'Documento local válido.';
          return;
        }
        try {
          const r = await api('/validate-document', { method: 'POST', body: JSON.stringify({ document: docEl.value }) });
          docEl.classList.toggle('err', !r.valid);
          hint.className = `hint ${r.valid ? 'ok' : 'error'}`;
          hint.textContent = r.valid ? `Cédula válida (${r.type}) · ${r.masked}` : r.error;
        } catch {
          /* silencioso */
        }
      }, 380);
    });
  }

  const bdocEl = $('#w-bdoc');
  if (bdocEl) {
    bdocEl.addEventListener('input', () => {
      d.beneficiaryDocument = bdocEl.value;
      const hint = $('#w-bdoc-hint');
      if (!hint) return;
      if (d.country === 'VE') {
        hint.className = 'hint';
        hint.textContent = 'La cédula venezolana del beneficiario es obligatoria.';
      } else {
        hint.className = 'hint';
        hint.textContent = `Documento local de ${countryByCode(d.country).name}.`;
      }
    });
  }

  $('#w-next')?.addEventListener('click', async () => {
    if (!collectStep()) return;
    if (state.step < 4) {
      state.step += 1;
      render();
      return;
    }
    const btn = $('#w-next');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creando orden…';
    try {
      const payload = buildPayload();
      const res = await api('/orders', { method: 'POST', body: JSON.stringify(payload) });
      state.order = res.order;
      navigate(`/pay/${res.order.public_id}`);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
      btn.textContent = 'Crear orden y pagar';
    }
  });

  $('#w-back')?.addEventListener('click', () => {
    state.step = Math.max(1, state.step - 1);
    render();
  });

  if (state.step === 1) refreshQuote();
  if (state.step === 4) renderSummary();
}

function collectStep() {
  const d = state.draft;
  if (state.step === 1) {
    if (!d.amount || Number(d.amount) <= 0) {
      toast('Ingresa un monto válido.', 'err');
      return false;
    }
    return true;
  }
  if (state.step === 2) {
    d.fullName = $('#w-name')?.value.trim() || d.fullName;
    d.document = $('#w-doc')?.value.trim() || d.document;
    d.email = $('#w-email')?.value.trim() || d.email;
    d.phone = $('#w-phone')?.value.trim() || d.phone;
    if (d.fullName.length < 3) {
      toast('Escribe tu nombre completo.', 'err');
      return false;
    }
    if (!d.document || d.document.length < 5) {
      toast('Ingresa tu documento de identidad.', 'err');
      return false;
    }
    return true;
  }
  if (state.step === 3) {
    d.beneficiaryName = $('#w-bname')?.value.trim() || d.beneficiaryName;
    d.beneficiaryDocument = $('#w-bdoc')?.value.trim() || d.beneficiaryDocument;
    const keyEl = $('#w-key');
    if (keyEl) d.keyValue = keyEl.value.trim();
    const bankEl = $('#w-bank');
    if (bankEl) {
      d.bankCode = bankEl.value;
      d.bankName = bankEl.selectedOptions[0]?.dataset.name || '';
    }
    const ktEl = $('#w-keytype');
    if (ktEl) d.keyType = ktEl.value;
    const atEl = $('#w-acctype');
    if (atEl) d.accountType = atEl.value;
    if (d.beneficiaryName.length < 3) {
      toast('Escribe el nombre del beneficiario.', 'err');
      return false;
    }
    if (!d.beneficiaryDocument || d.beneficiaryDocument.length < 5) {
      toast('Ingresa el documento del beneficiario.', 'err');
      return false;
    }
    if (['bank', 'pago_movil', 'pago_movil_ve', 'transfer_ve', 'wallet'].includes(d.rail)) {
      if (!d.bankCode) {
        toast(d.rail === 'wallet' ? 'Selecciona la billetera.' : 'Selecciona el banco.', 'err');
        return false;
      }
      if (!d.keyValue) {
        toast('Ingresa el teléfono, cuenta o alias de entrega.', 'err');
        return false;
      }
    }
    if (d.rail === 'breb' && !d.keyValue) {
      toast('Ingresa la llave BRE-B.', 'err');
      return false;
    }
    if (d.rail === 'bank' || d.rail === 'transfer_ve') d.accountNumber = d.keyValue;
    return true;
  }
  if (state.step === 4) {
    d.description = $('#w-desc')?.value.trim() || '';
    return true;
  }
  return true;
}

function buildPayload() {
  const d = state.draft;
  const method = methodInfo(d.method);
  const currency = method.currency || currencyOf(d.payerCountry);
  const amountCents = amountCentsForQuote();
  return {
    direction: d.direction,
    fullName: d.fullName,
    email: d.email || undefined,
    phone: d.phone || undefined,
    document: d.document,
    beneficiaryName: d.beneficiaryName,
    beneficiaryDocument: d.beneficiaryDocument,
    rail: d.rail,
    keyType: d.rail === 'breb' ? d.keyType : 'phone',
    brebKey: d.keyValue || undefined,
    bankCode: d.bankCode || undefined,
    bankName: d.bankName || undefined,
    accountNumber: ['bank', 'transfer_ve'].includes(d.rail) ? d.accountNumber || d.keyValue : undefined,
    accountType: d.accountType,
    amountCents,
    currency,
    payerCountry: d.payerCountry,
    country: d.country,
    method: d.method,
    description: d.description || undefined,
  };
}

async function refreshQuote() {
  const d = state.draft;
  const box = $('#w-quote') || $('#calc-quote');
  if (!box) return null;
  const amountCents = amountCentsForQuote();
  if (!amountCents) return null;
  const method = methodInfo(d.method);
  const currency = method.currency || currencyOf(d.payerCountry);
  try {
    const q = await api('/quote', {
      method: 'POST',
      body: JSON.stringify({ amountCents, currency, country: d.country, method: d.method }),
    });
    state.quote = q;
    box.innerHTML = `
      <div class="quote-row"><span>${d.direction === 'receive' ? 'Recibes' : 'Envías'}</span><strong>${q.destination_amount_formatted}</strong></div>
      <div class="quote-row"><span>Comisión (${q.fee_percent}%)</span><strong>${q.fee_formatted}</strong></div>
      <div class="quote-row total"><span>${d.direction === 'receive' ? 'Paga quien te envía' : 'Total a pagar'}</span><strong>${q.total_formatted}</strong></div>
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
    <div class="sr"><span>Dirección</span><strong>${d.direction === 'receive' ? 'Recibir' : 'Enviar'}</strong></div>
    <div class="sr"><span>Origen → destino</span><strong>${esc(countryByCode(d.payerCountry).name)} → ${esc(countryByCode(d.country).name)}</strong></div>
    <div class="sr"><span>Monto</span><strong>${q.amount_formatted}</strong></div>
    <div class="sr"><span>Comisión</span><strong>${q.fee_formatted}</strong></div>
    <div class="sr"><span>Total</span><strong>${q.total_formatted}</strong></div>
    <div class="sr"><span>Beneficiario</span><strong>${esc(d.beneficiaryName)}</strong></div>
    <div class="sr"><span>Documento</span><strong>${esc(d.beneficiaryDocument)}</strong></div>
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
  } else if (order.method === 'card') {
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
  } else {
    const info = methodInfo(order.method);
    panel = `
      <div class="panel" style="margin:0">
        <div class="card-title">Paga con ${esc(info.name)}</div>
        <div class="card-sub">${esc(info.sub || 'Método de pago local')} · ${order.amount_formatted}</div>
        <div class="summary-list">
          <div class="sr"><span>Método</span><strong>${esc(info.name)}</strong></div>
          <div class="sr"><span>Monto exacto</span><strong>${order.amount_formatted}</strong></div>
          <div class="sr"><span>Referencia</span><strong class="mono">${esc(order.public_id)}</strong></div>
        </div>
        <button class="btn btn-primary btn-block mt16" id="local-paid">Ya realicé el pago</button>
        <div class="hint mt8">La confirmación llega automáticamente cuando el proveedor valida la operación.</div>
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
          <div class="sr"><span>Documento</span><strong>${esc(order.beneficiary_doc_type)}-***${esc(order.beneficiary_doc_last4)}</strong></div>
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

  ['#breb-paid', '#cash-paid', '#ve-paid', '#hosted-pay', '#local-paid'].forEach((sel) => {
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
        <h2 class="mt16">${ok ? (order.metadata?.direction === 'receive' ? '¡Cobro exitoso!' : '¡Envío exitoso!') : bad ? 'El pago no se completó' : 'Procesando tu pago'}</h2>
        <p class="muted mt8">${ok ? (order.metadata?.direction === 'receive' ? 'El dinero ya está disponible para ti.' : 'Tu beneficiario ya puede disponer del dinero.') : bad ? 'No se realizó ningún cargo. Puedes intentarlo de nuevo.' : 'Estamos confirmando la operación con el proveedor.'}</p>
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

function defaultDraft(direction) {
  const d = state.draft;
  d.direction = direction;
  d.payerCountry = 'US';
  d.country = direction === 'receive' ? 'CL' : 'VE';
  const allowed = methodsFor(d.payerCountry);
  if (!allowed.includes(d.method)) d.method = allowed[0];
  const rails = railsFor(d.country);
  if (!rails.includes(d.rail)) d.rail = rails[0];
  d.bankCode = '';
  d.bankName = '';
  d.keyValue = '';
  d.accountNumber = '';
  d.amount = defaultAmount(direction, d.country);
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
    if (!state.wizardStarted) {
      defaultDraft('send');
      state.wizardStarted = true;
      state.step = 1;
    }
    html = wizardView();
    bind = bindWizard;
  } else if (parts[0] === 'recibir') {
    if (state.wizardDirection !== 'receive') {
      defaultDraft('receive');
      state.wizardDirection = 'receive';
      state.wizardStarted = true;
      state.step = 1;
    }
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
      const href = a.getAttribute('href');
      if (href === '/enviar') state.wizardStarted = false;
      if (href === '/recibir') state.wizardDirection = null;
      navigate(href);
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

  const burger = $('#nav-burger');
  const drawer = $('#nav-drawer');
  burger?.addEventListener('click', () => drawer?.classList.toggle('open'));

  setupPwa();

  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ---------------- PWA: instalación y estado de conexión ---------------- */
function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function setupPwa() {
  const buttons = [$('#ry-install'), $('#ry-install-m'), $('#ry-install-hero')].filter(Boolean);
  const hint = $('#ry-install-hint');
  const apk = $('#ry-apk');

  // Si ya está instalada, no mostramos los botones.
  if (isStandalone()) {
    buttons.forEach((b) => (b.hidden = true));
    if (hint) hint.textContent = 'Ya estás usando la app instalada. ¡Todo listo!';
  } else if (window.__ryInstall) {
    buttons.forEach((b) => (b.hidden = false));
  } else if (isIos() && hint) {
    hint.textContent = 'En iPhone: toca Compartir ↑ y luego “Añadir a pantalla de inicio”.';
  }

  // Muestra el botón cuando el navegador avisa que es instalable.
  document.addEventListener('ry-installable', () => {
    if (isStandalone()) return;
    buttons.forEach((b) => (b.hidden = false));
  });
  document.addEventListener('ry-installed', () => {
    buttons.forEach((b) => (b.hidden = true));
    toast('App instalada. ¡Ya puedes abrirla desde tu pantalla de inicio!', 'ok');
  });

  buttons.forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', async () => {
      const evt = window.__ryInstall;
      if (!evt) {
        toast(
          isIos()
            ? 'En iPhone: Compartir ↑ → Añadir a pantalla de inicio.'
            : 'Abre el menú del navegador y elige “Instalar aplicación”.',
          ''
        );
        return;
      }
      evt.prompt();
      try {
        const choice = await evt.userChoice;
        if (choice?.outcome === 'accepted') toast('Instalando RemesaYa…', 'ok');
      } catch {
        /* ignorar */
      }
      window.__ryInstall = null;
    });
  });

  // Barra de "sin conexión" (los datos financieros nunca se cachean).
  let bar = $('#ry-offline');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ry-offline';
    bar.className = 'offline-bar';
    bar.innerHTML = `${icon('wifiOff', 15)} <span>Sin conexión. Puedes ver la app, pero no enviar ni recibir dinero.</span>`;
    document.body.appendChild(bar);
  }
  const sync = () => bar.classList.toggle('show', !navigator.onLine);
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}

function bindLanding() {
  const amountEl = $('#calc-amount');
  const payerEl = $('#calc-payer');
  const countryEl = $('#calc-country');
  const methodEl = $('#calc-method');
  const curEl = $('#calc-cur');
  const quoteEl = $('#calc-quote');
  const amountLabel = $('#calc-amount-label');
  const payerLabel = $('#calc-payer-label');
  const countryLabel = $('#calc-country-label');
  let direction = 'send';

  const fillMethods = () => {
    const payer = payerEl?.value || 'US';
    const allowed = methodsFor(payer);
    if (methodEl) {
      methodEl.innerHTML = allowed
        .map((id) => `<option value="${id}">${esc(methodInfo(id).name)}</option>`)
        .join('');
    }
    if (curEl) curEl.textContent = direction === 'receive' ? currencyOf(countryEl?.value || 'VE') : currencyOf(payer);
  };

  const refresh = async () => {
    if (!quoteEl) return;
    const payer = payerEl?.value || 'US';
    const country = countryEl?.value || 'VE';
    const method = methodEl?.value || 'card';
    const amount = Number(amountEl?.value) || 0;
    if (!amount) {
      quoteEl.innerHTML = '<div class="quote-row"><span>Ingresa un monto para ver la cotizaci\u00f3n</span></div>';
      return;
    }
    const payerCur = methodInfo(method).currency || currencyOf(payer);
    const destCur = currencyOf(country);
    let amountCents;
    if (direction === 'receive') {
      const netUsd = localToUsdCents(amount, destCur);
      amountCents = Math.max(1, usdCentsToLocalMinor(netUsd, payerCur));
    } else {
      amountCents = Math.max(1, toMinor(amount, payerCur));
    }
    try {
      const q = await api('/quote', {
        method: 'POST',
        body: JSON.stringify({ amountCents, currency: payerCur, country, method }),
      });
      quoteEl.innerHTML = `
        <div class="quote-row"><span>${direction === 'receive' ? 'Recibes' : 'Env\u00edas'}</span><strong>${q.destination_amount_formatted}</strong></div>
        <div class="quote-row"><span>Comisi\u00f3n (${q.fee_percent}%)</span><strong>${q.fee_formatted}</strong></div>
        <div class="quote-row total"><span>${direction === 'receive' ? 'Paga quien te env\u00eda' : 'Total a pagar'}</span><strong>${q.total_formatted}</strong></div>
        <div class="quote-row"><span>Tasa</span><strong>1 ${q.currency} = ${q.fx_rate} ${q.destination_currency}</strong></div>`;
    } catch (err) {
      quoteEl.innerHTML = `<div class="quote-row"><span style="color:var(--danger)">${esc(err.message)}</span></div>`;
    }
  };

  document.querySelectorAll('#calc-dir [data-dir]').forEach((el) => {
    el.addEventListener('click', () => {
      direction = el.dataset.dir;
      document.querySelectorAll('#calc-dir [data-dir]').forEach((x) => x.classList.toggle('sel', x === el));
      if (amountLabel) amountLabel.textContent = direction === 'receive' ? 'Monto a recibir' : 'Monto a enviar';
      if (payerLabel) payerLabel.textContent = direction === 'receive' ? 'Te env\u00edan desde' : 'Pagas desde';
      if (countryLabel) countryLabel.textContent = direction === 'receive' ? 'Recibes en' : 'Destino';
      fillMethods();
      refresh();
    });
  });

  fillMethods();
  refresh();

  amountEl?.addEventListener('input', refresh);
  countryEl?.addEventListener('change', () => { fillMethods(); refresh(); });
  methodEl?.addEventListener('change', refresh);
  payerEl?.addEventListener('change', () => { fillMethods(); refresh(); });

  $('#calc-go')?.addEventListener('click', () => {
    const payer = payerEl?.value || 'US';
    const country = countryEl?.value || 'VE';
    state.draft.direction = direction;
    state.draft.amount = Number(amountEl?.value) || defaultAmount(direction, country);
    state.draft.payerCountry = payer;
    state.draft.country = country;
    state.draft.method = methodEl?.value || 'card';
    const rails = railsFor(country);
    state.draft.rail = rails[0];
    state.step = 1;
    state.wizardStarted = true;
    state.wizardDirection = direction;
    navigate(direction === 'receive' ? '/recibir' : '/enviar');
  });
}

render();
