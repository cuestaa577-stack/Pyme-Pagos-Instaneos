'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { getSettings } = require('../db');
const { format } = require('../lib/money');
const cedula = require('../lib/cedula');
const pricing = require('../services/pricing');
const orders = require('../services/orders');
const pse = require('../providers/pse');
const breb = require('../providers/breb');
const vepay = require('../providers/vepay');
const dlocalgo = require('../providers/dlocalgo');
const { orderSchema, parse } = require('../lib/validate');
const catalog = require('../lib/countries');

const router = express.Router();

const COUNTRIES = catalog.publicCatalog();

const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera un momento.' },
});

// Ping ultraligero: no toca la base. Lo usa el keep-alive y los monitores
// externos (UptimeRobot, cron-job.org) para no dejar dormir el contenedor.
router.get('/ping', (req, res) => {
  res.type('text/plain').send('pong');
});

// Health check de Render: además de "vivo", comprueba que la base responde.
router.get('/health', (req, res) => {
  const guardian = require('../services/guardian');
  let dbOk = true;
  let dbError = null;
  try {
    require('../db').db.prepare('SELECT 1').get();
  } catch (err) {
    dbOk = false;
    dbError = err.message;
  }
  const snap = guardian.snapshot();
  const ok = dbOk && !snap.degraded;
  res.status(ok ? 200 : 503).json({
    ok,
    app: config.appName,
    env: config.env,
    time: new Date().toISOString(),
    db: dbOk ? 'ok' : 'error',
    ...(dbError ? { db_error: dbError } : {}),
    uptime_seconds: snap.uptime_seconds,
    degraded: snap.degraded,
    recoveries: snap.recoveries,
    last_checkpoint_at: snap.last_checkpoint_at,
  });
});

router.get('/config', (req, res) => {
  const s = getSettings();
  res.json({
    app_name: config.appName,
    currency: config.defaultCurrency,
    methods: orders.METHODS.filter((m) => {
      const sw = {
        card: 'pay_card',
        card_transparent: 'pay_card',
        pse: 'pay_pse',
        breb: 'pay_breb',
        cash: 'pay_cash',
        ve_pago_movil: 'pay_ve',
        ve_transfer: 'pay_ve',
        ve_cash: 'pay_ve',
      }[m];
      return !sw || s[sw] !== '0';
    }),
    rails: orders.RAILS,
    fees: {
      percent: Number(s.fees_percent),
      fixed_cents: Number(s.fee_fixed_cents),
      min_order_cents: Number(s.min_order_cents),
      max_order_cents: Number(s.max_order_cents),
      withdrawal_fee_percent: Number(s.withdrawal_fee_percent),
      payout_fee_percent: Number(s.payout_fee_percent),
      min_withdrawal_cents: Number(s.min_withdrawal_cents),
    },
    rates: {
      usd_ves: Number(s.ves_rate),
      usd_cop: Number(s.cop_rate),
      usd_clp: Number(s.clp_rate || 950),
      usd_pen: Number(s.pen_rate || 3.75),
      usd_ars: Number(s.ars_rate || 1000),
      usd_mxn: Number(s.mxn_rate || 18.5),
      usd_dop: Number(s.dop_rate || 59),
      usd_brl: Number(s.brl_rate || 5.4),
      usd_eur: Number(s.eur_rate || 0.92),
      usd_usd: 1,
    },
    breb: {
      key_types: breb.KEY_TYPES,
      mode: breb.mode(),
      live: breb.isLive(),
      merchant_key: s.breb_merchant_key,
    },
    pse: { banks: pse.BANKS, mode: pse.mode(), live: pse.isLive() },
    vepay: {
      rails: vepay.RAILS,
      banks: vepay.BANKS,
      mode: vepay.mode(),
      live: vepay.isLive(),
      merchant: vepay.merchantInfo(s),
      currency: 'VES',
    },
    smartfields: { api_key: config.smartfields.apiKey, sdk_url: config.smartfields.sdkUrl },
    support: {
      email: s.support_email,
      whatsapp: s.support_whatsapp,
      phone: s.support_phone || s.support_whatsapp,
      hours: s.support_hours,
    },
    directions: {
      send: s.direction_send !== '0',
      receive: s.direction_receive !== '0',
    },
    countries: COUNTRIES,
    catalog: { methods: catalog.METHODS, rails: catalog.RAILS },
    maintenance: s.maintenance_mode === '1',
    demo_mode: config.demoFallback,
  });
});

router.post('/quote', createLimiter, (req, res, next) => {
  try {
    const amountCents = Number(req.body?.amountCents);
    const currency = String(req.body?.currency || 'USD').toUpperCase();
    const country = String(req.body?.country || 'VE').toUpperCase();
    const method = String(req.body?.method || 'card');
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: 'Monto inválido.' });
    }
    const q = pricing.quote({ amountCents, currency, country, method });
    res.json({
      ...q,
      amount_formatted: format(q.amount_cents, q.currency),
      fee_formatted: format(q.fee_cents, q.currency),
      total_formatted: format(q.total_cents, q.currency),
      net_formatted: format(q.net_cents, q.currency),
      destination_amount_formatted: format(q.destination_amount_cents, q.destination_currency),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/orders', createLimiter, async (req, res, next) => {
  try {
    const input = parse(orderSchema, req.body || {});
    const order = await orders.createOrder(input, { ip: req.ip });
    res.status(201).json({ order: sanitize(order) });
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:publicId', (req, res) => {
  const order = orders.getOrder(req.params.publicId);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada.' });
  res.json({ order: sanitize(order) });
});

router.get('/orders/:publicId/status', (req, res) => {
  const order = orders.getOrder(req.params.publicId);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada.' });
  res.json({
    public_id: order.public_id,
    status: order.status,
    provider: order.provider,
    destination_amount_formatted: order.destination_amount_formatted,
    updated_at: order.updated_at,
  });
});

/** Confirmación de checkout transparente con SmartFields (token de tarjeta). */
router.post('/orders/:publicId/confirm', createLimiter, async (req, res, next) => {
  try {
    const order = orders.getOrder(req.params.publicId);
    if (!order) return res.status(404).json({ error: 'Orden no encontrada.' });
    if (!order.checkout_token) {
      return res.status(400).json({ error: 'Esta orden no admite confirmación transparente.' });
    }
    if (!['pending', 'processing'].includes(order.status)) {
      return res.status(409).json({ error: `La orden ya está ${order.status}.` });
    }
    const { cardToken, installmentsId, saveCard } = req.body || {};
    if (!cardToken) return res.status(400).json({ error: 'Falta el token de tarjeta.' });

    const payload = { card_token: cardToken };
    if (installmentsId) payload.installments_id = installmentsId;
    if (saveCard) payload.save_card = true;

    const result = await dlocalgo.confirmPayment(order.checkout_token, payload);
    const updated = await orders.settlePayment(order.public_id, {
      status: result.status,
      providerRef: result.providerRef,
      source: 'smartfields',
      raw: result.raw,
    });
    res.json({
      order: sanitize(updated),
      redirect_url: result.redirectUrl || null,
      requires_3ds: Boolean(result.redirectUrl),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Aprobación / rechazo en modo demostración. Solo funciona con órdenes cuyo
 * proveedor es un simulador; nunca sobre una orden real de dLocal Go.
 */
function demoGuard(req, res, next) {
  const order = orders.getOrder(req.params.publicId);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada.' });
  const simulators = ['demo', 'pse_simulator', 'breb_simulator', 'vepay_simulator'];
  if (!simulators.includes(order.provider)) {
    return res.status(403).json({ error: 'Esta orden no está en modo demostración.' });
  }
  if (!['pending', 'processing'].includes(order.status)) {
    return res.status(409).json({ error: `La orden ya está ${order.status}.` });
  }
  req.order = order;
  next();
}

router.post('/orders/:publicId/demo-approve', createLimiter, demoGuard, async (req, res, next) => {
  try {
    const updated = await orders.settlePayment(req.order.public_id, {
      status: 'APPROVED',
      providerRef: `DEMO-${req.order.public_id}`,
      source: 'demo',
    });
    res.json({ order: sanitize(updated) });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:publicId/demo-decline', createLimiter, demoGuard, async (req, res, next) => {
  try {
    const updated = await orders.settlePayment(req.order.public_id, {
      status: 'REJECTED',
      source: 'demo',
    });
    res.json({ order: sanitize(updated) });
  } catch (err) {
    next(err);
  }
});

/** Valida una cédula venezolana sin crear orden (feedback en el formulario). */
router.post('/validate-document', createLimiter, (req, res) => {
  const result = cedula.validate(req.body?.document);
  res.json({ ...result, masked: result.valid ? cedula.mask(req.body.document) : null });
});

function sanitize(order) {
  if (!order) return order;
  const safe = { ...order };
  delete safe.checkout_token;
  if (safe.breb_key) safe.breb_key = `${String(safe.breb_key).slice(0, 3)}***${String(safe.breb_key).slice(-2)}`;
  return safe;
}

module.exports = router;
module.exports.sanitize = sanitize;
