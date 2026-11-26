'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db, getSettings, setSetting, audit } = require('../db');
const { format } = require('../lib/money');
const auth = require('../auth');
const orders = require('../services/orders');
const withdrawals = require('../services/withdrawals');
const payouts = require('../services/payouts');
const ledger = require('../services/ledger');
const pricing = require('../services/pricing');
const config = require('../config');
const backup = require('../services/backup');
const breb = require('../providers/breb');
const pse = require('../providers/pse');
const vepay = require('../providers/vepay');
const dlocalgo = require('../providers/dlocalgo');
const {
  loginSchema,
  withdrawalSchema,
  payoutSchema,
  dlocalPayoutSchema,
  parse,
} = require('../lib/validate');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Un login correcto no consume cuota: así, si te equivocas 3 veces y aciertas
  // a la cuarta, no te quedas bloqueado por tus propios aciertos.
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    const retry = Math.ceil((req.rateLimit?.resetTime ? new Date(req.rateLimit.resetTime).getTime() - Date.now() : 600000) / 1000);
    res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${Math.max(1, Math.ceil(retry / 60))} minuto(s) o reinicia el servicio.`,
      retry_after_seconds: Math.max(1, retry),
    });
  },
});

// Validamos ANTES del rate limit: una petición mal formada (contraseña de 2
// letras, correo sin @) no debe gastar intentos. Antes sí los gastaba y dejaba
// al propietario fuera 10 minutos sin haber probado nada real.
function validateLogin(req, res, next) {
  try {
    req.loginData = parse(loginSchema, req.body || {});
    return next();
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Datos inválidos.' });
  }
}

router.post('/login', validateLogin, loginLimiter, (req, res) => {
  const data = req.loginData;
  const result = auth.login({ email: data.email, password: data.password, ip: req.ip, userAgent: req.headers['user-agent'] });
  if (!result) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  res.cookie(auth.COOKIE, result.cookie, auth.cookieOptions());
  audit({ actor: result.admin.email, action: 'admin.login', entity: 'admin', entityId: result.admin.id, ip: req.ip });
  res.json({ admin: result.admin, csrf: result.csrf, expires: result.expires });
});

router.post('/logout', (req, res) => {
  auth.logout(req);
  res.clearCookie(auth.COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.use(auth.requireAdmin);

router.get('/me', (req, res) => {
  res.json({ admin: req.admin, csrf: req.session.csrf_token });
});

function toMap(rows) {
  return Object.fromEntries((rows || []).map((r) => [r.account, r.balance]));
}

router.get('/stats', (req, res) => {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN status IN ('approved','completed') THEN amount_cents ELSE 0 END), 0) AS collected,
              COALESCE(SUM(CASE WHEN status IN ('approved','completed') THEN fee_cents ELSE 0 END), 0) AS fees,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending
       FROM transactions WHERE kind = 'collection'`
    )
    .get();
  const today = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(amount_cents), 0) AS collected
       FROM transactions WHERE kind = 'collection' AND status IN ('approved','completed')
         AND date(created_at) = date('now')`
    )
    .get();
  const usd = toMap(ledger.balances('USD'));
  const cop = toMap(ledger.balances('COP'));
  const ves = toMap(ledger.balances('VES'));
  res.json({
    totals: {
      ...totals,
      collected_formatted: format(totals.collected, 'USD'),
      fees_formatted: format(totals.fees, 'USD'),
    },
    today: { ...today, collected_formatted: format(today.collected, 'USD') },
    balances: { USD: usd, COP: cop, VES: ves },
    available_usd: format(usd.merchant_available || 0, 'USD'),
    available_cop: format(cop.merchant_available || 0, 'COP'),
    available_ves: format(ves.merchant_available || 0, 'VES'),
    fees_usd: format(usd.fee_income || 0, 'USD'),
    fees_cop: format(cop.fee_income || 0, 'COP'),
    fees_ves: format(ves.fee_income || 0, 'VES'),
  });
});

router.get('/orders', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  res.json(orders.listOrders({ status: req.query.status, query: req.query.q, limit, offset }));
});

router.get('/orders/:id', (req, res) => {
  const order = orders.getOrder(req.params.id) || orders.getOrderById(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Orden no encontrada.' });
  const payout = db.prepare('SELECT * FROM payouts WHERE transaction_id = ?').get(order.id);
  const proofs = orders.listProofs(order.id);
  res.json({ order: { ...order, proofs }, payout: payout ? payouts.serialize(payout) : null });
});

/** Descarga el archivo de un comprobante (solo administradores). */
router.get('/proofs/:id/file', (req, res) => {
  const file = orders.proofFile(Number(req.params.id));
  if (!file) return res.status(404).json({ error: 'Comprobante no encontrado.' });
  res.setHeader('Content-Type', file.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${file.file_name}"`);
  res.sendFile(file.path);
});

/** Aprueba o rechaza el pago manual de una orden. */
router.post('/orders/:id/review', async (req, res, next) => {
  try {
    const action = String(req.body?.action || '').toLowerCase();
    const updated = await orders.reviewProof(req.params.id, {
      action,
      actor: req.admin.email,
      ip: req.ip,
      note: req.body?.note,
    });
    res.json({ order: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:id/refund', async (req, res, next) => {
  try {
    const result = await orders.refundOrder(req.params.id, {
      amountCents: req.body?.amountCents ? Number(req.body.amountCents) : undefined,
      actor: req.admin.email,
      ip: req.ip,
    });
    res.json({ order: result });
  } catch (err) {
    next(err);
  }
});

router.get('/balance', (req, res) => {
  const currency = String(req.query.currency || 'USD').toUpperCase();
  const balances = toMap(ledger.balances(currency));
  res.json({
    currency,
    balances,
    formatted: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, format(v, currency)])),
  });
});

router.get('/ledger', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const clauses = [];
  const params = [];
  if (req.query.account) {
    clauses.push('account = ?');
    params.push(req.query.account);
  }
  if (req.query.currency) {
    clauses.push('currency = ?');
    params.push(String(req.query.currency).toUpperCase());
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const items = db
    .prepare(`SELECT * FROM ledger_entries ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ledger_entries ${where}`).get(...params).n;
  res.json({
    total,
    items: items.map((e) => ({ ...e, amount_formatted: format(e.amount_cents, e.currency) })),
  });
});

router.get('/withdrawals', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  res.json(withdrawals.listWithdrawals({ limit, offset }));
});

router.post('/withdrawals', async (req, res, next) => {
  try {
    const data = parse(withdrawalSchema, req.body || {});
    const result = await withdrawals.createWithdrawal({ ...data, actor: req.admin.email, ip: req.ip });
    res.status(201).json({ withdrawal: result });
  } catch (err) {
    next(err);
  }
});

router.post('/withdrawals/:id/paid', (req, res, next) => {
  try {
    const result = withdrawals.markPaid(req.params.id, {
      reference: req.body?.reference,
      actor: req.admin.email,
      ip: req.ip,
    });
    res.json({ withdrawal: result });
  } catch (err) {
    next(err);
  }
});

router.get('/payouts', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  res.json(payouts.listPayouts({ limit, offset }));
});

router.post('/payouts', async (req, res, next) => {
  try {
    const data = parse(payoutSchema, req.body || {});
    const result = await payouts.createInstantPayout({ ...data, actor: req.admin.email, ip: req.ip });
    res.status(201).json({ payout: result });
  } catch (err) {
    next(err);
  }
});

router.post('/payouts/:id/paid', (req, res, next) => {
  try {
    const result = payouts.markPaid(req.params.id, {
      reference: req.body?.reference,
      actor: req.admin.email,
      ip: req.ip,
    });
    res.json({ payout: result });
  } catch (err) {
    next(err);
  }
});

router.post('/payouts/dlocal', async (req, res, next) => {
  try {
    const data = parse(dlocalPayoutSchema, req.body || {});
    const result = await payouts.createDlocalPayout({ ...data, actor: req.admin.email, ip: req.ip });
    res.status(201).json({ payout: result });
  } catch (err) {
    next(err);
  }
});

router.get('/beneficiaries', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const items = db
    .prepare(
      `SELECT id, full_name, doc_type, doc_last4, country, rail, bank_name, bank_code, breb_key, phone, email, created_at
       FROM beneficiaries ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM beneficiaries').get().n;
  res.json({ total, items });
});

const EDITABLE_SETTINGS = new Set([
  'fees_percent',
  'fee_fixed_cents',
  'min_order_cents',
  'max_order_cents',
  'withdrawal_fee_percent',
  'payout_fee_percent',
  'min_withdrawal_cents',
  'ves_rate',
  'cop_rate',
  'clp_rate',
  'pen_rate',
  'ars_rate',
  'mxn_rate',
  'dop_rate',
  'brl_rate',
  'eur_rate',
  'support_email',
  'support_whatsapp',
  'support_phone',
  'support_hours',
  'direction_send',
  'direction_receive',
  'maintenance_mode',
  'auto_disburse',
  'breb_merchant_key',
  've_merchant_name',
  've_merchant_document',
  've_merchant_phone',
  've_merchant_bank',
  've_merchant_account',
  'pay_card',
  'pay_pse',
  'pay_breb',
  'pay_cash',
  'pay_ve',
  'collect_ve_pago_movil_holder',
  'collect_ve_pago_movil_id',
  'collect_ve_pago_movil_phone',
  'collect_ve_pago_movil_bank',
  'collect_ve_transfer_holder',
  'collect_ve_transfer_id',
  'collect_ve_transfer_bank',
  'collect_ve_transfer_account',
  'collect_intl_holder',
  'collect_intl_bank',
  'collect_intl_account',
  'collect_intl_swift',
  'collect_intl_zelle',
  'collect_cash_note',
  'collect_instructions',
  'manual_review',
]);

/**
 * Estado de las pasarelas y datos públicos del comercio (sin secretos).
 * Permite al propietario ver, desde el panel, qué vías están en vivo y cuáles
 * operan por cobro manual con comprobante, y editar los datos de recaudo.
 */
router.get('/providers', (req, res) => {
  const s = getSettings();
  res.json({
    dlocalgo: {
      mode: dlocalgo.isLive() ? 'live' : 'off',
      live: dlocalgo.isLive(),
      smartfields: Boolean(config.smartfields.apiKey),
    },
    breb: { mode: breb.mode(), live: breb.isLive(), merchant_key: s.breb_merchant_key },
    pse: { mode: pse.mode(), live: pse.isLive(), banks: pse.BANKS.length },
    vepay: {
      mode: vepay.mode(),
      live: vepay.isLive(),
      merchant: vepay.merchantInfo(s),
      banks: vepay.BANKS,
      rails: vepay.RAILS,
    },
    // Estado de configuración de cada credencial (nunca el valor).
    env: {
      dlocalgo: {
        DLOCALGO_API_URL: Boolean(config.dlocalgo.apiUrl),
        DLOCALGO_API_KEY: Boolean(config.dlocalgo.apiKey),
        DLOCALGO_API_SECRET: Boolean(config.dlocalgo.apiSecret),
        DLOCALGO_WEBHOOK_SECRET: Boolean(config.dlocalgo.webhookSecret),
        SMARTFIELDS_API_KEY: Boolean(config.smartfields.apiKey),
      },
      breb: {
        BREB_API_URL: Boolean(config.breb.apiUrl),
        BREB_API_KEY: Boolean(config.breb.apiKey),
        BREB_PARTICIPANT_ID: Boolean(config.breb.participantId),
      },
      pse: {
        PSE_API_URL: Boolean(config.pse.apiUrl),
        PSE_API_KEY: Boolean(config.pse.apiKey),
        PSE_MERCHANT_ID: Boolean(config.pse.merchantId),
      },
      vepay: {
        VE_API_URL: Boolean(config.vepay.apiUrl),
        VE_API_KEY: Boolean(config.vepay.apiKey),
        VE_MERCHANT_PHONE: Boolean(s.ve_merchant_phone),
        VE_MERCHANT_ACCOUNT: Boolean(s.ve_merchant_account),
      },
    },
    switches: {
      card: s.pay_card !== '0',
      pse: s.pay_pse !== '0',
      breb: s.pay_breb !== '0',
      cash: s.pay_cash !== '0',
      ve: s.pay_ve !== '0',
    },
  });
});

router.get('/settings', (req, res) => {
  res.json({ settings: getSettings() });
});

/* ---------------- respaldos de la base de datos ---------------- */

// Lista los respaldos disponibles en el disco persistente.
router.get('/backups', auth.requireAdmin, (req, res) => {
  res.json({
    data_dir: config.dataDir,
    db_file: config.dbFile,
    interval_hours: config.backupIntervalHours,
    keep: config.backupKeep,
    encryption: {
      algorithm: 'AES-256-GCM',
      kdf: 'scrypt (N=2^15, r=8, p=1)',
      key_configured: Boolean(config.backupEncryptionKey),
      note: 'Los respaldos solo se pueden restaurar con BACKUP_ENCRYPTION_KEY.',
    },
    backups: backup.listBackups(),
  });
});

// Genera un respaldo nuevo y lo descarga.
router.get('/backup', auth.requireAdmin, (req, res, next) => {
  try {
    const r = backup.runBackup('manual');
    audit({ actor: req.admin.email, action: 'backup.download', entity: 'database', ip: req.ip, metadata: { file: r.name, encrypted: true } });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Backup-Encryption', 'AES-256-GCM');
    res.download(r.file, r.name);
  } catch (err) {
    next(err);
  }
});

router.put('/settings', (req, res) => {
  const updates = req.body || {};
  const applied = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!EDITABLE_SETTINGS.has(key)) continue;
    setSetting(key, value);
    applied[key] = String(value);
  }
  audit({ actor: req.admin.email, action: 'settings.update', entity: 'settings', ip: req.ip, metadata: applied });
  res.json({ ok: true, settings: getSettings() });
});

router.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const items = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  res.json({
    total,
    items: items.map((a) => ({ ...a, metadata: a.metadata ? JSON.parse(a.metadata) : {} })),
  });
});

router.get('/webhooks', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const items = db.prepare('SELECT * FROM webhook_events ORDER BY id DESC LIMIT ?').all(limit);
  res.json({
    items: items.map((w) => ({ ...w, payload: w.payload ? JSON.parse(w.payload) : null })),
  });
});

router.post('/fees/sweep', (req, res, next) => {
  try {
    const currency = String(req.body?.currency || 'USD').toUpperCase();
    const result = ledger.sweepFees({
      currency,
      amountCents: req.body?.amountCents ? Number(req.body.amountCents) : undefined,
      description: `Barrido de comisiones a saldo disponible (${req.admin.email})`,
    });
    audit({ actor: req.admin.email, action: 'fees.sweep', entity: 'ledger', ip: req.ip, metadata: result });
    res.json({ ok: true, swept: result, swept_formatted: format(result.amount_cents, currency) });
  } catch (err) {
    next(err);
  }
});

router.get('/rates', (req, res) => {
  res.json({ rates: pricing.rates(), destination: pricing.DESTINATION_CURRENCY });
});

module.exports = router;
