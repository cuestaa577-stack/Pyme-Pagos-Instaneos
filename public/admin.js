/* RemesaYa — panel de administración */
'use strict';

const A = {
  admin: null,
  csrf: sessionStorage.getItem('ry_csrf') || '',
  tab: 'resumen',
  stats: null,
  orders: null,
  ledger: null,
  withdrawals: null,
  payouts: null,
  beneficiaries: null,
  settings: null,
  audit: null,
  webhooks: null,
  rates: null,
  currency: 'USD',
};

const $ = (sel, root = document) => root.querySelector(sel);
const root = () => $('#admin');

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
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (A.csrf && options.method && options.method !== 'GET') headers['x-csrf-token'] = A.csrf;
  const res = await fetch(`/api/admin${path}`, { ...options, headers, credentials: 'same-origin' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401) {
    A.admin = null;
    renderLogin();
    throw new Error(data.error || 'Sesión expirada.');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function badge(status) {
  return `<span class="st st-${esc(status)}">${esc(status)}</span>`;
}

/* ---------------- login ---------------- */
function renderLogin() {
  root().innerHTML = `
    <div class="login">
      <div class="card login-card">
        <div class="logo">R</div>
        <h2>Panel de administración</h2>
        <p class="muted small mt8">Acceso exclusivo del propietario de la plataforma.</p>
        <label class="field mt16">
          <span>Correo</span>
          <input class="input" id="lg-email" type="email" placeholder="admin@tudominio.com" autocomplete="username" />
        </label>
        <label class="field">
          <span>Contraseña</span>
          <input class="input" id="lg-pass" type="password" placeholder="••••••••" autocomplete="current-password" />
        </label>
        <button class="btn btn-primary btn-block mt16" id="lg-go">Entrar</button>
        <div class="hint mt16" style="text-align:center"><a href="/" data-home>← Volver al sitio</a></div>
      </div>
    </div>`;
  const submit = async () => {
    const email = $('#lg-email').value.trim();
    const password = $('#lg-pass').value;
    if (!email || !password) return toast('Completa correo y contraseña.', 'err');
    try {
      const res = await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      A.admin = res.admin;
      A.csrf = res.csrf;
      sessionStorage.setItem('ry_csrf', res.csrf);
      toast('Bienvenido de nuevo.', 'ok');
      boot();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
  $('#lg-go').addEventListener('click', submit);
  $('#lg-pass').addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  $('[data-home]')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = '/';
  });
}

/* ---------------- shell ---------------- */
const TABS = [
  ['resumen', 'Resumen', 'chart'],
  ['ordenes', 'Órdenes', 'receipt'],
  ['saldos', 'Saldos y ledger', 'wallet'],
  ['retiros', 'Retiros', 'bank'],
  ['payouts', 'Pagos a beneficiarios', 'bolt'],
  ['beneficiarios', 'Beneficiarios', 'users'],
  ['pagos', 'Configuración de pagos', 'card'],
  ['ajustes', 'Ajustes', 'settings'],
  ['auditoria', 'Auditoría', 'shield'],
  ['webhooks', 'Webhooks', 'bell'],
];

function shell(content) {
  root().innerHTML = `
    <div class="admin">
      <aside class="side">
        <div class="brand"><div class="logo">R</div><div><strong>RemesaYa</strong><span>Administración</span></div></div>
        <nav class="side-nav">
          ${TABS.map(([id, label, ico]) => `<a href="#" data-tab="${id}" class="${A.tab === id ? 'active' : ''}">${icon(ico, 18)}<span>${label}</span></a>`).join('')}
        </nav>
        <div class="side-foot">
          <div class="small muted">${esc(A.admin?.email || '')}</div>
          <button class="btn btn-sm btn-ghost mt8" id="logout">${icon('logout', 15)} Cerrar sesión</button>
        </div>
      </aside>
      <main class="admin-main">
        <header class="admin-head">
          <div>
            <h1>${esc(TABS.find((t) => t[0] === A.tab)?.[1] || 'Resumen')}</h1>
            <p class="muted small">${new Date().toLocaleString('es-VE')}</p>
          </div>
          <a class="btn btn-sm btn-ghost" href="/" target="_blank">${icon('external', 15)} Ver sitio</a>
        </header>
        <div id="panel">${content}</div>
      </main>
    </div>`;

  document.querySelectorAll('[data-tab]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      A.tab = a.dataset.tab;
      renderTab();
    });
  });
  $('#logout')?.addEventListener('click', async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    A.admin = null;
    A.csrf = '';
    sessionStorage.removeItem('ry_csrf');
    renderLogin();
  });
}

/* ---------------- tabs ---------------- */
async function renderTab() {
  shell('<div class="panel">Cargando…</div>');
  try {
    if (A.tab === 'resumen') await tabResumen();
    else if (A.tab === 'ordenes') await tabOrdenes();
    else if (A.tab === 'saldos') await tabSaldos();
    else if (A.tab === 'retiros') await tabRetiros();
    else if (A.tab === 'payouts') await tabPayouts();
    else if (A.tab === 'beneficiarios') await tabBeneficiarios();
    else if (A.tab === 'pagos') await tabPagos();
    else if (A.tab === 'ajustes') await tabAjustes();
    else if (A.tab === 'auditoria') await tabAuditoria();
    else if (A.tab === 'webhooks') await tabWebhooks();
  } catch (err) {
    $('#panel').innerHTML = `<div class="panel"><p style="color:var(--danger)">${esc(err.message)}</p></div>`;
  }
}

async function tabResumen() {
  const [stats, rates] = await Promise.all([api('/stats'), api('/rates')]);
  A.stats = stats;
  A.rates = rates;
  $('#panel').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Órdenes totales</span><strong>${stats.totals.orders}</strong><small>${stats.totals.pending} pendientes</small></div>
      <div class="kpi"><span>Recaudado</span><strong>${stats.totals.collected_formatted}</strong><small>Histórico aprobado</small></div>
      <div class="kpi"><span>Comisiones</span><strong>${stats.totals.fees_formatted}</strong><small>Por barrer a disponible</small></div>
      <div class="kpi"><span>Hoy</span><strong>${stats.today.collected_formatted}</strong><small>${stats.today.orders} órdenes</small></div>
    </div>
    <div class="grid2 mt24">
      <div class="panel">
        <div class="panel-head"><h3>Saldo disponible</h3></div>
        <div class="summary-list">
          <div class="sr"><span>USD</span><strong>${stats.available_usd}</strong></div>
          <div class="sr"><span>COP</span><strong>${stats.available_cop}</strong></div>
          <div class="sr"><span>VES</span><strong>${stats.available_ves}</strong></div>
        </div>
        <div class="panel-head mt24"><h3>Comisiones acumuladas</h3></div>
        <div class="summary-list">
          <div class="sr"><span>USD</span><strong>${stats.fees_usd}</strong></div>
          <div class="sr"><span>COP</span><strong>${stats.fees_cop}</strong></div>
          <div class="sr"><span>VES</span><strong>${stats.fees_ves}</strong></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Barrido de comisiones</h3></div>
        <p class="muted small">Mueve las comisiones acumuladas al saldo disponible para poder retirarlas o pagar a beneficiarios.</p>
        <div class="row2 mt16">
          <label class="field"><span>Moneda</span>
            <select class="input" id="sweep-cur"><option>USD</option><option>COP</option><option>VES</option></select>
          </label>
          <label class="field"><span>Monto (opcional)</span><input class="input" id="sweep-amount" placeholder="Todo el saldo" /></label>
        </div>
        <button class="btn btn-primary mt16" id="sweep-go">Barrer comisiones</button>
        <div class="panel-head mt24"><h3>Tasas activas</h3></div>
        <div class="summary-list">
          <div class="sr"><span>1 USD</span><strong>${rates.rates.COP} COP</strong></div>
          <div class="sr"><span>1 USD</span><strong>${rates.rates.VES} VES</strong></div>
        </div>
      </div>
    </div>`;

  $('#sweep-go').addEventListener('click', async () => {
    const currency = $('#sweep-cur').value;
    const raw = $('#sweep-amount').value.trim();
    const body = { currency };
    if (raw) body.amountCents = Math.round(Number(raw) * (currency === 'COP' || currency === 'VES' ? 1 : 100));
    try {
      const res = await api('/fees/sweep', { method: 'POST', body: JSON.stringify(body) });
      toast(`Barrido: ${res.swept_formatted}`, 'ok');
      renderTab();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function tabOrdenes() {
  const data = await api('/orders?limit=100');
  A.orders = data;
  $('#panel').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>${data.total} órdenes</h3>
        <input class="input" id="ord-q" placeholder="Buscar por ID, nombre o cédula…" style="max-width:280px" />
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Orden</th><th>Cliente</th><th>Método</th><th>Monto</th><th>Destino</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${data.items.map((o) => `
              <tr>
                <td class="mono">${esc(o.public_id)}</td>
                <td>${esc(o.customer_name || '—')}<div class="muted small">${esc(o.doc_type || '')}-***${esc(o.doc_last4 || '')}</div></td>
                <td>${esc(o.method)}</td>
                <td>${esc(o.amount_formatted)}</td>
                <td>${esc(o.destination_amount_formatted || '—')}</td>
                <td>${badge(o.status)}</td>
                <td><button class="btn btn-sm btn-ghost" data-refund="${esc(o.public_id)}">Reembolsar</button></td>
              </tr>`).join('') || '<tr><td colspan="7" class="muted">Sin órdenes todavía.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  document.querySelectorAll('[data-refund]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Reembolsar la orden ${btn.dataset.refund}?`)) return;
      try {
        await api(`/orders/${btn.dataset.refund}/refund`, { method: 'POST', body: JSON.stringify({}) });
        toast('Reembolso registrado.', 'ok');
        renderTab();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
  $('#ord-q')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.tbl tbody tr').forEach((tr) => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

async function tabSaldos() {
  const [bal, led] = await Promise.all([api(`/balance?currency=${A.currency}`), api(`/ledger?limit=100&currency=${A.currency}`)]);
  A.ledger = led;
  $('#panel').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Balance contable</h3>
        <select class="input" id="led-cur" style="max-width:120px">
          ${['USD', 'COP', 'VES'].map((c) => `<option ${c === A.currency ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="grid4">
        ${Object.entries(bal.formatted).map(([k, v]) => `<div class="kpi"><span>${esc(k)}</span><strong style="font-size:1.1rem">${esc(v)}</strong></div>`).join('')}
      </div>
      <div class="panel-head mt24"><h3>Últimos movimientos</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>#</th><th>Cuenta</th><th>Dirección</th><th>Monto</th><th>Descripción</th><th>Fecha</th></tr></thead>
          <tbody>
            ${led.items.map((e) => `<tr><td>${e.id}</td><td class="mono">${esc(e.account)}</td><td>${esc(e.direction)}</td><td>${esc(e.amount_formatted)}</td><td>${esc(e.description || '')}</td><td class="muted small">${esc(e.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin movimientos.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  $('#led-cur').addEventListener('change', (e) => {
    A.currency = e.target.value;
    renderTab();
  });
}

async function tabRetiros() {
  const data = await api('/withdrawals?limit=100');
  A.withdrawals = data;
  $('#panel').innerHTML = `
    <div class="grid2">
      <div class="panel">
        <div class="panel-head"><h3>Nuevo retiro instantáneo</h3></div>
        <div class="row2">
          <label class="field"><span>Moneda</span>
            <select class="input" id="wd-cur"><option>USD</option><option>COP</option><option selected>VES</option></select>
          </label>
          <label class="field"><span>Monto</span><input class="input" id="wd-amount" placeholder="100.00" /></label>
        </div>
        <label class="field"><span>Vía</span>
          <select class="input" id="wd-rail">
            <option value="pago_movil_ve">Pago Móvil (VES)</option>
            <option value="transfer_ve">Transferencia banco VE (VES)</option>
            <option value="breb">BRE-B (COP)</option>
          </select>
        </label>
        <div class="row2">
          <label class="field"><span>Banco</span><select class="input" id="wd-bank"><option value="">—</option></select></label>
          <label class="field"><span>Teléfono / cuenta</span><input class="input" id="wd-key" placeholder="04141234567" /></label>
        </div>
        <label class="field"><span>Titular</span><input class="input" id="wd-name" placeholder="Nombre del titular" /></label>
        <button class="btn btn-primary btn-block mt16" id="wd-go">Retirar ahora</button>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Historial</h3></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>ID</th><th>Monto</th><th>Vía</th><th>Estado</th></tr></thead>
            <tbody>
              ${data.items.map((w) => `<tr><td class="mono">${esc(w.public_id)}</td><td>${esc(w.total_formatted)}</td><td>${esc(w.rail)}</td><td>${badge(w.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin retiros.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => ({}));
  const banks = cfg?.vepay?.banks || [];
  const bankSel = $('#wd-bank');
  bankSel.innerHTML = `<option value="">—</option>${banks.map((b) => `<option value="${b.code}">${esc(b.name)}</option>`).join('')}`;

  $('#wd-rail').addEventListener('change', (e) => {
    const ves = e.target.value !== 'breb';
    $('#wd-cur').value = ves ? 'VES' : 'COP';
  });

  $('#wd-go').addEventListener('click', async () => {
    const currency = $('#wd-cur').value;
    const amount = Number($('#wd-amount').value);
    if (!amount) return toast('Ingresa un monto.', 'err');
    const body = {
      amountCents: Math.round(amount * (currency === 'COP' || currency === 'VES' ? 1 : 100)),
      currency,
      keyType: 'phone',
      keyValue: $('#wd-key').value.trim(),
      rail: $('#wd-rail').value,
      phone: $('#wd-key').value.trim(),
      bankCode: $('#wd-bank').value || undefined,
      destinationName: $('#wd-name').value.trim() || undefined,
    };
    try {
      const res = await api('/withdrawals', { method: 'POST', body: JSON.stringify(body) });
      toast(`Retiro ${res.withdrawal.status}: ${res.withdrawal.total_formatted}`, 'ok');
      renderTab();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function tabPayouts() {
  const [data, bens] = await Promise.all([api('/payouts?limit=100'), api('/beneficiaries?limit=100')]);
  A.payouts = data;
  $('#panel').innerHTML = `
    <div class="grid2">
      <div class="panel">
        <div class="panel-head"><h3>Pago instantáneo</h3></div>
        <label class="field"><span>Beneficiario</span>
          <select class="input" id="po-ben">${bens.items.map((b) => `<option value="${b.id}">${esc(b.full_name)} · ${esc(b.rail)} · ${esc(b.country)}</option>`).join('')}</select>
        </label>
        <div class="row2">
          <label class="field"><span>Monto destino</span><input class="input" id="po-amount" placeholder="100.00" /></label>
          <label class="field"><span>Debitar de</span><select class="input" id="po-src"><option>USD</option><option>COP</option><option>VES</option></select></label>
        </div>
        <button class="btn btn-primary btn-block mt16" id="po-go">Pagar al instante</button>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Historial</h3></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>ID</th><th>Beneficiario</th><th>Monto</th><th>Estado</th></tr></thead>
            <tbody>
              ${data.items.map((p) => `<tr><td class="mono">${esc(p.public_id)}</td><td>${esc(p.beneficiary_name || '—')}</td><td>${esc(p.amount_formatted)}</td><td>${badge(p.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin pagos.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  $('#po-go').addEventListener('click', async () => {
    const amount = Number($('#po-amount').value);
    if (!amount) return toast('Ingresa un monto.', 'err');
    const src = $('#po-src').value;
    try {
      const res = await api('/payouts', {
        method: 'POST',
        body: JSON.stringify({
          beneficiaryId: Number($('#po-ben').value),
          amountCents: Math.round(amount * (src === 'COP' || src === 'VES' ? 1 : 100)),
          sourceCurrency: src,
        }),
      });
      toast(`Pago ${res.payout.status}`, 'ok');
      renderTab();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function tabBeneficiarios() {
  const data = await api('/beneficiaries?limit=100');
  $('#panel').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>${data.total} beneficiarios</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Nombre</th><th>Cédula</th><th>País</th><th>Vía</th><th>Banco</th><th>Llave / teléfono</th></tr></thead>
          <tbody>
            ${data.items.map((b) => `<tr><td>${esc(b.full_name)}</td><td class="mono">${esc(b.doc_type)}-***${esc(b.doc_last4)}</td><td>${esc(b.country)}</td><td>${esc(b.rail)}</td><td>${esc(b.bank_name || b.bank_code || '—')}</td><td class="mono">${esc(b.breb_key || b.phone || '—')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin beneficiarios.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function tabPagos() {
  const [p, cfg] = await Promise.all([api('/providers'), api('/settings')]);
  const s = cfg.settings || {};
  const modeBadge = (live) =>
    live
      ? '<span class="st st-completed">En vivo</span>'
      : '<span class="st st-pending">Demostración</span>';

  const switchRow = (key, label, desc, on) => `
    <div class="switch-row">
      <div>
        <strong>${label}</strong>
        <div class="muted small">${desc}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-switch="${key}" ${on ? 'checked' : ''} />
        <span></span>
      </label>
    </div>`;

  $('#panel').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Pasarelas conectadas</h3></div>
      <div class="prov-grid">
        <div class="prov">
          <div class="prov-top"><strong>dLocal Go</strong>${modeBadge(p.dlocalgo.live)}</div>
          <div class="muted small">Tarjeta alojada y tarjeta transparente (SmartFields).</div>
          <div class="small mt8">SmartFields: ${p.dlocalgo.smartfields ? 'configurado' : 'sin llave'}</div>
          ${p.dlocalgo.demo_fallback ? '<div class="small mt8" style="color:var(--warn)">Fallback demo activo</div>' : ''}
        </div>
        <div class="prov">
          <div class="prov-top"><strong>BRE-B (Colombia)</strong>${modeBadge(p.breb.live)}</div>
          <div class="muted small">Transferencias instantáneas con llave.</div>
          <div class="small mt8">Llave comercio: ${esc(p.breb.merchant_key || '—')}</div>
        </div>
        <div class="prov">
          <div class="prov-top"><strong>PSE (Colombia)</strong>${modeBadge(p.pse.live)}</div>
          <div class="muted small">Débito bancario · ${p.pse.banks} bancos.</div>
        </div>
        <div class="prov">
          <div class="prov-top"><strong>Venezuela (VES)</strong>${modeBadge(p.vepay.live)}</div>
          <div class="muted small">Pago Móvil, transferencia y efectivo.</div>
          <div class="small mt8">${Object.values(p.vepay.rails).join(' · ')}</div>
        </div>
      </div>
    </div>

    <div class="panel mt16">
      <div class="panel-head"><h3>Vías de pago activas</h3></div>
      <div class="switch-list">
        ${switchRow('pay_card', 'Tarjeta', 'Cobros con tarjeta internacional (USD).', p.switches.card)}
        ${switchRow('pay_pse', 'PSE', 'Débito desde bancos de Colombia (COP).', p.switches.pse)}
        ${switchRow('pay_breb', 'BRE-B', 'Transferencia instantánea en Colombia (COP).', p.switches.breb)}
        ${switchRow('pay_cash', 'Efectivo', 'Pago en corresponsales (USD).', p.switches.cash)}
        ${switchRow('pay_ve', 'Pago Móvil / Venezuela', 'Cobros en bolívares desde Venezuela (VES).', p.switches.ve)}
      </div>
      <button class="btn btn-primary mt16" id="sw-go">Guardar vías de pago</button>
    </div>

    <div class="panel mt16">
      <div class="panel-head"><h3>Datos de recaudo en Venezuela</h3></div>
      <p class="muted small">Estos datos se muestran al pagador cuando cobras por Pago Móvil o transferencia en bolívares.</p>
      <div class="grid2 mt16">
        <label class="field"><span>Nombre / razón social</span><input class="input" data-set="ve_merchant_name" value="${esc(s.ve_merchant_name || p.vepay.merchant.name || '')}" /></label>
        <label class="field"><span>Cédula o RIF</span><input class="input" data-set="ve_merchant_document" value="${esc(s.ve_merchant_document || p.vepay.merchant.document || '')}" /></label>
        <label class="field"><span>Teléfono Pago Móvil</span><input class="input" data-set="ve_merchant_phone" value="${esc(s.ve_merchant_phone || p.vepay.merchant.phone || '')}" placeholder="04141234567" /></label>
        <label class="field"><span>Banco</span>
          <select class="input" data-set="ve_merchant_bank">
            <option value="">Selecciona…</option>
            ${Object.entries(p.vepay.banks).map(([code, name]) => `<option value="${code}" ${String(s.ve_merchant_bank || p.vepay.merchant.bank) === code ? 'selected' : ''}>${code} · ${esc(name)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Número de cuenta</span><input class="input" data-set="ve_merchant_account" value="${esc(s.ve_merchant_account || p.vepay.merchant.account || '')}" placeholder="01340000000000000000" /></label>
      </div>
      <button class="btn btn-primary mt16" id="ve-go">Guardar datos de recaudo</button>
    </div>

    <div class="panel mt16">
      <div class="panel-head"><h3>Llaves y secretos</h3></div>
      <p class="muted small">Por seguridad, las claves de las pasarelas (dLocal Go, BRE-B, PSE y Venezuela) se configuran en el archivo <code>.env</code> del servidor y nunca se muestran en el navegador. Al cambiarlas y reiniciar, las pasarelas pasan a modo «En vivo» automáticamente.</p>
      <div class="tbl-wrap mt16">
        <table class="tbl">
          <thead><tr><th>Pasarela</th><th>Variables en .env</th></tr></thead>
          <tbody>
            <tr><td>dLocal Go</td><td class="mono small">DLOCALGO_API_KEY · DLOCALGO_API_SECRET · SMARTFIELDS_API_KEY</td></tr>
            <tr><td>BRE-B</td><td class="mono small">BREB_MODE · BREB_API_URL · BREB_API_KEY</td></tr>
            <tr><td>PSE</td><td class="mono small">PSE_MODE · PSE_API_URL · PSE_API_KEY</td></tr>
            <tr><td>Venezuela</td><td class="mono small">VE_MODE · VE_API_URL · VE_API_KEY</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;

  $('#sw-go').addEventListener('click', async () => {
    const body = {};
    document.querySelectorAll('[data-switch]').forEach((el) => {
      body[el.dataset.switch] = el.checked ? '1' : '0';
    });
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Vías de pago actualizadas.', 'ok');
      renderTab();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('#ve-go').addEventListener('click', async () => {
    const body = {};
    document.querySelectorAll('[data-set]').forEach((el) => {
      body[el.dataset.set] = el.value;
    });
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Datos de recaudo guardados.', 'ok');
      renderTab();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function tabAjustes() {
  const { settings } = await api('/settings');
  A.settings = settings;
  const fields = [
    ['fees_percent', 'Comisión (%)'],
    ['fee_fixed_cents', 'Comisión fija (centavos USD)'],
    ['min_order_cents', 'Mínimo orden (centavos USD)'],
    ['max_order_cents', 'Máximo orden (centavos USD)'],
    ['withdrawal_fee_percent', 'Comisión retiro (%)'],
    ['payout_fee_percent', 'Comisión payout (%)'],
    ['min_withdrawal_cents', 'Mínimo retiro (centavos)'],
    ['ves_rate', 'Tasa Bs por USD'],
    ['cop_rate', 'Tasa COP por USD'],
    ['support_email', 'Correo de soporte'],
    ['support_whatsapp', 'WhatsApp de soporte'],
    ['breb_merchant_key', 'Llave BRE-B del comercio'],
  ];
  $('#panel').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Parámetros de la plataforma</h3></div>
      <div class="grid2">
        ${fields.map(([k, label]) => `<label class="field"><span>${label}</span><input class="input" data-set="${k}" value="${esc(settings[k] ?? '')}" /></label>`).join('')}
      </div>
      <div class="row2 mt16">
        <label class="field"><span>Entrega automática</span>
          <select class="input" data-set="auto_disburse"><option value="1" ${settings.auto_disburse === '1' ? 'selected' : ''}>Activada</option><option value="0" ${settings.auto_disburse !== '1' ? 'selected' : ''}>Desactivada</option></select>
        </label>
        <label class="field"><span>Mantenimiento</span>
          <select class="input" data-set="maintenance_mode"><option value="0" ${settings.maintenance_mode !== '1' ? 'selected' : ''}>Sitio activo</option><option value="1" ${settings.maintenance_mode === '1' ? 'selected' : ''}>Mantenimiento</option></select>
        </label>
      </div>
      <button class="btn btn-primary mt16" id="set-go">Guardar cambios</button>
    </div>`;
  $('#set-go').addEventListener('click', async () => {
    const body = {};
    document.querySelectorAll('[data-set]').forEach((el) => {
      body[el.dataset.set] = el.value;
    });
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Ajustes guardados.', 'ok');
      renderTab();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function tabAuditoria() {
  const data = await api('/audit?limit=100');
  $('#panel').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>${data.total} eventos</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>#</th><th>Actor</th><th>Acción</th><th>Entidad</th><th>Detalle</th><th>Fecha</th></tr></thead>
          <tbody>
            ${data.items.map((a) => `<tr><td>${a.id}</td><td>${esc(a.actor)}</td><td class="mono">${esc(a.action)}</td><td>${esc(a.entity || '')} ${esc(a.entity_id || '')}</td><td class="muted small">${esc(JSON.stringify(a.metadata || {}))}</td><td class="muted small">${esc(a.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin eventos.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function tabWebhooks() {
  const data = await api('/webhooks?limit=100');
  $('#panel').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Últimos webhooks</h3></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>#</th><th>Fuente</th><th>Evento</th><th>Firma</th><th>Estado</th><th>Fecha</th></tr></thead>
          <tbody>
            ${data.items.map((w) => `<tr><td>${w.id}</td><td>${esc(w.source)}</td><td class="mono">${esc(w.event_id)}</td><td>${w.signature_valid ? icon('check', 15) : icon('close', 15)}</td><td>${badge(w.status)}</td><td class="muted small">${esc(w.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin webhooks.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ---------------- boot ---------------- */
async function boot() {
  try {
    const me = await api('/me');
    A.admin = me.admin;
    A.csrf = me.csrf;
    sessionStorage.setItem('ry_csrf', me.csrf);
    renderTab();
  } catch {
    renderLogin();
  }
}

boot();
