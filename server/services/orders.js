'use strict';
const crypto = require('crypto');
const { db, getSettings, audit } = require('../db');
const config = require('../config');
const cedula = require('../lib/cedula');
const { encrypt, decrypt, hashDocument, last4 } = require('../lib/crypto');
const { toMajor, toMinor, format } = require('../lib/money');
const pricing = require('./pricing');
const ledger = require('./ledger');
const dlocalgo = require('../providers/dlocalgo');
const pse = require('../providers/pse');
const breb = require('../providers/breb');
const vepay = require('../providers/vepay');

const METHODS = [
  'card',
  'card_transparent',
  'pse',
  'breb',
  'cash',
  've_pago_movil',
  've_transfer',
  've_cash',
];
const VE_METHODS = ['ve_pago_movil', 've_transfer', 've_cash'];
const RAILS = ['breb', 'pago_movil', 'bank', 'pago_movil_ve', 'transfer_ve', 'cash_ve'];

const METHOD_TO_VE_RAIL = {
  ve_pago_movil: 'pago_movil_ve',
  ve_transfer: 'transfer_ve',
  ve_cash: 'cash_ve',
};

function publicId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `RY-${out}`;
}

function orderId() {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function upsertCustomer({ fullName, email, phone, document, country = 'VE' }) {
  const doc = cedula.validate(document);
  if (!doc.valid) throw new Error(doc.error);
  const hash = hashDocument(doc.normalized);
  const existing = db
    .prepare('SELECT * FROM customers WHERE doc_type = ? AND doc_number_hash = ?')
    .get(doc.type, hash);
  if (existing) {
    db.prepare(
      `UPDATE customers SET full_name = ?, email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?`
    ).run(fullName, email || null, phone || null, existing.id);
    return { ...existing, full_name: fullName, doc_normalized: doc.normalized };
  }
  const info = db
    .prepare(
      `INSERT INTO customers (full_name, email, phone, doc_type, doc_number_enc, doc_number_hash, doc_last4, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fullName,
      email || null,
      phone || null,
      doc.type,
      encrypt(doc.normalized),
      hash,
      last4(doc.number),
      country
    );
  return {
    id: Number(info.lastInsertRowid),
    full_name: fullName,
    email,
    phone,
    doc_type: doc.type,
    doc_last4: last4(doc.number),
    doc_normalized: doc.normalized,
    country,
  };
}

function createBeneficiary(customerId, data) {
  const doc = cedula.validate(data.document);
  if (!doc.valid) throw new Error(`Documento del beneficiario: ${doc.error}`);
  if (!RAILS.includes(data.rail)) throw new Error('Vía de pago del beneficiario inválida.');
  if (!data.fullName || data.fullName.trim().length < 3) throw new Error('Nombre del beneficiario inválido.');

  let key = data.brebKey || data.phone || '';
  if (data.rail === 'breb') {
    const k = breb.validateKey(data.keyType || 'cedula', key);
    if (!k.valid) throw new Error(k.error);
    key = k.normalized;
  } else if (data.rail === 'pago_movil') {
    if (!/^\+?\d{10,15}$/.test(String(key).replace(/[^\d+]/g, ''))) {
      throw new Error('Teléfono de Pago Móvil inválido.');
    }
    if (!data.bankCode) throw new Error('Selecciona el banco del beneficiario.');
  } else if (data.rail === 'bank') {
    if (!data.accountNumber || !data.bankCode) throw new Error('Datos bancarios incompletos.');
  } else if (data.rail === 'pago_movil_ve') {
    const phone = vepay.validatePhone(key || data.phone);
    if (!phone.valid) throw new Error(phone.error);
    key = phone.normalized;
    if (!vepay.validateBank(data.bankCode).valid) throw new Error('Selecciona el banco del beneficiario.');
  } else if (data.rail === 'transfer_ve') {
    if (!vepay.validateBank(data.bankCode).valid) throw new Error('Selecciona el banco del beneficiario.');
    if (!data.accountNumber) throw new Error('Ingresa el número de cuenta del beneficiario.');
  } else if (data.rail === 'cash_ve') {
    if (!data.fullName) throw new Error('Nombre del beneficiario requerido.');
  }

  const info = db
    .prepare(
      `INSERT INTO beneficiaries
       (customer_id, full_name, doc_type, doc_number_enc, doc_number_hash, doc_last4, country, rail,
        bank_name, bank_code, account_type, account_number_enc, account_last4, breb_key, phone, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      customerId,
      data.fullName.trim(),
      doc.type,
      encrypt(doc.normalized),
      hashDocument(doc.normalized),
      last4(doc.number),
      data.country,
      data.rail,
      data.bankName || null,
      data.bankCode || null,
      data.accountType || null,
      data.accountNumber ? encrypt(data.accountNumber) : null,
      data.accountNumber ? last4(data.accountNumber) : null,
      key || null,
      data.phone || null,
      data.email || null
    );
  return Number(info.lastInsertRowid);
}

function getBeneficiary(id) {
  const b = db.prepare('SELECT * FROM beneficiaries WHERE id = ?').get(id);
  if (!b) return null;
  return {
    ...b,
    doc_number: decrypt(b.doc_number_enc),
    account_number: decrypt(b.account_number_enc),
  };
}

function isDemoProviderError(err) {
  return err && err.auth && config.demoFallback;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function createOrder(input, { ip } = {}) {
  if (!METHODS.includes(input.method)) throw badRequest('Método de pago inválido.');
  const currency = String(input.currency || 'USD').toUpperCase();
  const payerCountry = String(input.payerCountry || 'CO').toUpperCase();
  const destinationCountry = String(input.country || 'VE').toUpperCase();

  if (['pse', 'breb'].includes(input.method) && currency !== 'COP') {
    throw badRequest('PSE y BRE-B operan en pesos colombianos (COP).');
  }
  if (input.method === 'pse' && payerCountry !== 'CO') {
    throw badRequest('PSE solo está disponible para pagos desde Colombia.');
  }
  const isVeMethod = VE_METHODS.includes(input.method);
  if (isVeMethod) {
    if (currency !== 'VES') throw badRequest('Los pagos desde Venezuela se procesan en bolívares (VES).');
    if (payerCountry !== 'VE') throw badRequest('Este método es para pagadores en Venezuela.');
    if (destinationCountry !== 'VE') throw badRequest('Los pagos desde Venezuela son para destinos en Venezuela.');
  }
  if (currency === 'VES' && !isVeMethod) {
    throw badRequest('Para pagar en bolívares elige Pago Móvil, transferencia o efectivo.');
  }

  const amountCents = Number(input.amountCents);
  let q;
  try {
    q = pricing.quote({ amountCents, currency, country: destinationCountry, method: input.method });
  } catch (err) {
    throw badRequest(err.message);
  }

  const customer = upsertCustomer({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    document: input.document,
    country: 'VE',
  });

  let beneficiaryId;
  try {
    beneficiaryId = createBeneficiary(customer.id, {
    fullName: input.beneficiaryName,
    document: input.beneficiaryDocument,
    country: destinationCountry,
    rail:
      input.rail ||
      (isVeMethod ? METHOD_TO_VE_RAIL[input.method] : destinationCountry === 'VE' ? 'pago_movil' : 'breb'),
    keyType: input.keyType,
    brebKey: input.brebKey,
    phone: input.beneficiaryPhone,
    bankCode: input.bankCode,
    bankName: input.bankName,
    accountNumber: input.accountNumber,
      accountType: input.accountType,
      email: input.beneficiaryEmail,
    });
  } catch (err) {
    throw badRequest(err.message);
  }

  const pid = publicId();
  const oid = orderId();
  const description = (
    input.description || (isVeMethod ? 'Pago / remesa en Venezuela' : 'Remesa / pago internacional')
  ).slice(0, 100);
  const metadata = {
    payer_country: payerCountry,
    payer_document_masked: cedula.mask(input.document),
    beneficiary_document_masked: cedula.mask(input.beneficiaryDocument),
    rail:
      input.rail ||
      (isVeMethod ? METHOD_TO_VE_RAIL[input.method] : destinationCountry === 'VE' ? 'pago_movil' : 'breb'),
    key_type: input.keyType || null,
    breb_key_masked: input.brebKey ? `${String(input.brebKey).slice(0, 3)}***${String(input.brebKey).slice(-3)}` : null,
    demo: false,
    provider_note: null,
  };

  const info = db
    .prepare(
      `INSERT INTO transactions
       (public_id, order_id, customer_id, beneficiary_id, kind, method, status, amount_cents, fee_cents,
        net_cents, currency, country, description, provider, destination_currency, destination_amount_cents,
        fx_rate, metadata)
       VALUES (?, ?, ?, ?, 'collection', ?, 'pending', ?, ?, ?, ?, ?, ?, 'dlocalgo', ?, ?, ?, ?)`
    )
    .run(
      pid,
      oid,
      customer.id,
      beneficiaryId,
      input.method,
      q.total_cents,
      q.fee_cents,
      q.net_cents,
      currency,
      destinationCountry,
      description,
      q.destination_currency,
      q.destination_amount_cents,
      q.fx_rate,
      JSON.stringify(metadata)
    );
  const transactionId = Number(info.lastInsertRowid);

  let provider = 'dlocalgo';
  let providerRef = null;
  let checkoutUrl = null;
  let checkoutToken = null;
  let status = 'pending';

  const successUrl = `${config.publicBaseUrl}/success/${pid}`;
  const notificationUrl = `${config.publicBaseUrl}/api/webhooks/dlocalgo`;
  const payer = {
    name: input.fullName,
    email: input.email || undefined,
    phone: input.phone || undefined,
    document_type: 'CI',
    document: cedula.parse(input.document)?.number || input.document,
  };

  try {
    if (input.method === 'card' || input.method === 'card_transparent' || input.method === 'cash') {
      const payload = {
        amount: toMajor(q.total_cents, currency),
        currency,
        country: payerCountry,
        order_id: oid,
        description,
        success_url: successUrl,
        back_url: config.publicBaseUrl,
        notification_url: notificationUrl,
        payer,
        payment_type: input.method === 'cash' ? 'VOUCHER' : 'CREDIT_CARD,DEBIT_CARD',
      };
      if (input.method === 'card_transparent') payload.allow_transparent = true;
      if (input.method === 'card') payload.allow_3ds = true;
      const payment = await dlocalgo.createPayment(payload);
      providerRef = payment.providerRef;
      checkoutUrl = payment.checkoutUrl;
      checkoutToken = payment.checkoutToken;
      status = payment.status;
    } else if (input.method === 'pse') {
      const session = await pse.createSession({
        amountCents: q.total_cents,
        currency,
        document: cedula.parse(input.document)?.number,
        name: input.fullName,
        email: input.email,
        bankCode: input.bankCode,
        reference: oid,
        description,
      });
      provider = session.provider;
      providerRef = session.providerRef;
      checkoutUrl = session.redirectUrl;
      status = session.status;
    } else if (input.method === 'breb') {
      provider = breb.isLive() ? 'breb' : 'breb_simulator';
      checkoutUrl = `/pay/breb/${pid}`;
      status = 'pending';
    } else if (isVeMethod) {
      const collection = await vepay.createCollection({
        amountCents: q.total_cents,
        currency,
        rail: METHOD_TO_VE_RAIL[input.method],
        reference: oid,
        payerName: input.fullName,
        payerDocument: cedula.parse(input.document)?.number,
        payerPhone: input.phone,
        bankCode: input.payerBank || input.bankCode,
        description,
      });
      provider = collection.provider;
      providerRef = collection.providerRef;
      checkoutUrl = collection.redirectUrl || `/pay/ve/${pid}`;
      status = collection.status || 'pending';
      metadata.payment_code = collection.paymentCode || null;
      metadata.instructions = collection.instructions || null;
    }
  } catch (err) {
    if (isDemoProviderError(err)) {
      provider = 'demo';
      checkoutUrl =
        input.method === 'pse'
          ? `/pay/pse/${pid}`
          : isVeMethod
            ? `/pay/ve/${pid}`
            : `/pay/demo/${pid}`;
      status = 'pending';
      metadata.demo = true;
      metadata.provider_note = 'dLocal Go rechazó las credenciales configuradas; operación en modo demostración.';
    } else {
      db.prepare(
        `UPDATE transactions SET status = 'failed', metadata = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(JSON.stringify({ ...metadata, provider_error: err.message }), transactionId);
      const e = new Error(err.message || 'No se pudo iniciar el pago.');
      e.publicId = pid;
      throw e;
    }
  }

  db.prepare(
    `UPDATE transactions SET provider = ?, provider_ref = ?, checkout_url = ?, checkout_token = ?,
     status = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(provider, providerRef, checkoutUrl, checkoutToken, status, JSON.stringify(metadata), transactionId);

  audit({
    actor: 'customer',
    action: 'order.create',
    entity: 'transaction',
    entityId: pid,
    ip,
    metadata: { method: input.method, amount: q.total_cents, currency, provider },
  });

  return getOrder(pid);
}

function getOrder(publicIdValue) {
  const row = db
    .prepare(
      `SELECT t.*, c.full_name AS customer_name, c.doc_type, c.doc_last4, c.email AS customer_email,
              c.phone AS customer_phone, b.full_name AS beneficiary_name, b.doc_type AS beneficiary_doc_type,
              b.doc_last4 AS beneficiary_doc_last4, b.rail, b.bank_name, b.bank_code, b.breb_key,
              b.phone AS beneficiary_phone
       FROM transactions t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN beneficiaries b ON b.id = t.beneficiary_id
       WHERE t.public_id = ?`
    )
    .get(publicIdValue);
  if (!row) return null;
  return {
    ...row,
    metadata: parseJson(row.metadata),
    amount_formatted: format(row.amount_cents, row.currency),
    fee_formatted: format(row.fee_cents, row.currency),
    net_formatted: format(row.net_cents, row.currency),
    destination_amount_formatted: format(row.destination_amount_cents, row.destination_currency),
  };
}

function getOrderById(id) {
  const row = db.prepare('SELECT public_id FROM transactions WHERE id = ?').get(id);
  return row ? getOrder(row.public_id) : null;
}

async function settlePayment(publicIdValue, { status, providerRef, source = 'system', raw = null } = {}) {
  const order = getOrder(publicIdValue);
  if (!order) throw new Error('Orden no encontrada.');
  const normalized = dlocalgo.normalizeStatus(status);
  if (!normalized) return order;

  if (order.status === normalized && ['approved', 'declined', 'failed', 'cancelled', 'refunded', 'completed'].includes(order.status)) {
    return order;
  }

  const metadata = { ...order.metadata, last_status_source: source, last_status_at: new Date().toISOString() };
  if (raw) metadata.last_provider_payload = raw;

  db.prepare(
    `UPDATE transactions SET status = ?, provider_ref = COALESCE(?, provider_ref), metadata = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).run(normalized, providerRef || null, JSON.stringify(metadata), order.id);

  if (normalized === 'approved') {
    ledger.settleCollection({
      transactionId: order.id,
      grossCents: order.amount_cents,
      feeCents: order.fee_cents,
      netCents: order.net_cents,
      currency: order.currency,
      description: `Cobro ${order.public_id}`,
    });
    audit({
      actor: source,
      action: 'order.approved',
      entity: 'transaction',
      entityId: order.public_id,
      metadata: { provider_ref: providerRef },
    });
    await maybeAutoDisburse(order.id);
  }

  return getOrder(publicIdValue);
}

/**
 * Entrega automática al beneficiario. En modo demostración se completa al
 * instante por BRE-B / Pago Móvil. En producción queda registrada y el
 * administrador la ejecuta contra el riel configurado.
 */
async function maybeAutoDisburse(transactionId) {
  const settings = getSettings();
  if (settings.auto_disburse !== '1') return null;
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  if (!t || t.kind !== 'collection') return null;
  const b = getBeneficiary(t.beneficiary_id);
  if (!b) return null;
  const existing = db.prepare('SELECT * FROM payouts WHERE transaction_id = ?').get(transactionId);
  if (existing) return existing;

  const isDemo =
    t.provider === 'demo' ||
    t.provider === 'breb_simulator' ||
    t.provider === 'pse_simulator' ||
    t.provider === 'vepay_simulator';
  if (!isDemo) return null;

  const isVes = t.destination_currency === 'VES';
  let payoutProvider = 'breb_simulator';
  let payoutRef = `BREB-SIM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  let payoutStatus = 'completed';
  if (isVes) {
    const rail = b.rail === 'transfer_ve' || b.rail === 'cash_ve' ? b.rail : 'pago_movil_ve';
    try {
      const sent = await vepay.sendPayout({
        amountCents: t.destination_amount_cents,
        currency: 'VES',
        rail,
        reference: t.order_id,
        beneficiaryName: b.full_name,
        beneficiaryDocument: b.doc_number,
        phone: b.phone || b.breb_key,
        bankCode: b.bank_code,
        description: `Entrega automática de ${t.public_id}`,
      });
      payoutProvider = sent.provider;
      payoutRef = sent.providerRef;
      payoutStatus = sent.status === 'completed' ? 'completed' : 'processing';
    } catch (err) {
      payoutProvider = 'vepay_simulator';
      payoutStatus = 'failed';
    }
  }

  const pid = `PO-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const info = db
    .prepare(
      `INSERT INTO payouts (public_id, beneficiary_id, transaction_id, amount_cents, currency, country, flow_type,
        purpose, status, provider, provider_ref, description, metadata)
       VALUES (?, ?, ?, ?, ?, ?, 'B2C', 'FAMILY_SUPPORT', ?, ?, ?, ?, ?)`
    )
    .run(
      pid,
      b.id,
      transactionId,
      t.destination_amount_cents,
      t.destination_currency,
      b.country,
      payoutStatus,
      payoutProvider,
      payoutRef,
      `Entrega automática de ${t.public_id}`,
      JSON.stringify({
        instant: true,
        rail: b.rail,
        key_masked: b.breb_key ? `${b.breb_key.slice(0, 3)}***` : null,
      })
    );
  const payoutId = Number(info.lastInsertRowid);

  const payoutCurrency = t.destination_currency || t.currency;
  const payoutCents = t.destination_amount_cents || t.net_cents;
  const description = `Entrega al beneficiario ${t.public_id}`;

  if (payoutCurrency === t.currency) {
    // Misma moneda: el neto del comercio sale directo a pagos.
    ledger.post([
      {
        payout_id: payoutId,
        transaction_id: transactionId,
        account: ledger.ACCOUNTS.MERCHANT_AVAILABLE,
        direction: 'debit',
        amount_cents: t.net_cents,
        currency: t.currency,
        description,
      },
      {
        payout_id: payoutId,
        transaction_id: transactionId,
        account: ledger.ACCOUNTS.PAYOUTS_OUT,
        direction: 'credit',
        amount_cents: t.net_cents,
        currency: t.currency,
        description,
      },
    ]);
  } else {
    // Distinta moneda (ej. cobro USD → pago VES): se convierte el neto del
    // comercio en la moneda de origen y se entrega en la moneda destino,
    // dejando la posición FX en la cuenta de compensación del proveedor.
    ledger.post([
      {
        payout_id: payoutId,
        transaction_id: transactionId,
        account: ledger.ACCOUNTS.MERCHANT_AVAILABLE,
        direction: 'debit',
        amount_cents: t.net_cents,
        currency: t.currency,
        description: `${description} (conversión)`,
      },
      {
        payout_id: payoutId,
        transaction_id: transactionId,
        account: ledger.ACCOUNTS.PROVIDER_CLEARING,
        direction: 'credit',
        amount_cents: t.net_cents,
        currency: t.currency,
        description: `${description} (conversión)`,
      },
      {
        payout_id: payoutId,
        transaction_id: transactionId,
        account: ledger.ACCOUNTS.PROVIDER_CLEARING,
        direction: 'debit',
        amount_cents: payoutCents,
        currency: payoutCurrency,
        description,
      },
      {
        payout_id: payoutId,
        transaction_id: transactionId,
        account: ledger.ACCOUNTS.PAYOUTS_OUT,
        direction: 'credit',
        amount_cents: payoutCents,
        currency: payoutCurrency,
        description,
      },
    ]);
  }

  if (payoutStatus === 'completed') {
    db.prepare(
      `UPDATE transactions SET status = 'completed', updated_at = datetime('now') WHERE id = ?`
    ).run(transactionId);
  }
  return db.prepare('SELECT * FROM payouts WHERE id = ?').get(payoutId);
}

async function refundOrder(publicIdValue, { amountCents, actor = 'admin', ip } = {}) {
  const order = getOrder(publicIdValue);
  if (!order) throw new Error('Orden no encontrada.');
  if (!['approved', 'completed', 'partially_refunded'].includes(order.status)) {
    throw new Error('Solo se pueden reembolsar órdenes aprobadas.');
  }
  const refundCents = amountCents ? Number(amountCents) : order.amount_cents;
  if (refundCents <= 0 || refundCents > order.amount_cents) throw new Error('Monto de reembolso inválido.');

  let providerRef = null;
  let providerStatus = 'approved';
  if (order.provider === 'dlocalgo' && order.provider_ref) {
    const refund = await dlocalgo.createRefund({
      paymentId: order.provider_ref,
      amount: toMajor(refundCents, order.currency),
      notificationUrl: `${config.publicBaseUrl}/api/webhooks/dlocalgo`,
    });
    providerRef = refund.providerRef;
    providerStatus = refund.status;
  }

  const pid = `RF-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  db.prepare(
    `INSERT INTO transactions (public_id, order_id, customer_id, beneficiary_id, kind, method, status,
      amount_cents, fee_cents, net_cents, currency, country, description, provider, provider_ref, metadata)
     VALUES (?, ?, ?, ?, 'refund', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    pid,
    `${order.order_id}-RF-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    order.customer_id,
    order.beneficiary_id,
    order.method,
    providerStatus === 'approved' ? 'approved' : providerStatus,
    refundCents,
    refundCents,
    order.currency,
    order.country,
    `Reembolso de ${order.public_id}`,
    order.provider,
    providerRef,
    JSON.stringify({ original_order: order.public_id, refund: true })
  );

  ledger.refundCollection({
    transactionId: order.id,
    amountCents: refundCents,
    currency: order.currency,
    description: `Reembolso ${pid}`,
  });

  db.prepare(
    `UPDATE transactions SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(refundCents >= order.amount_cents ? 'refunded' : 'partially_refunded', order.id);

  audit({
    actor,
    action: 'order.refund',
    entity: 'transaction',
    entityId: order.public_id,
    ip,
    metadata: { refund_id: pid, amount: refundCents, provider_ref: providerRef },
  });

  return { refundId: pid, status: providerStatus, amountCents: refundCents };
}

function listOrders({ status, query, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('t.status = ?');
    params.push(status);
  }
  if (query) {
    clauses.push('(t.public_id LIKE ? OR t.order_id LIKE ? OR c.full_name LIKE ? OR c.doc_last4 LIKE ?)');
    const q = `%${query}%`;
    params.push(q, q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT t.*, c.full_name AS customer_name, c.doc_last4, b.full_name AS beneficiary_name
       FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN beneficiaries b ON b.id = t.beneficiary_id
       ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id ${where}`
    )
    .get(...params).n;
  return {
    total,
    items: rows.map((r) => ({
      ...r,
      metadata: parseJson(r.metadata),
      amount_formatted: format(r.amount_cents, r.currency),
    })),
  };
}

module.exports = {
  METHODS,
  VE_METHODS,
  RAILS,
  METHOD_TO_VE_RAIL,
  createOrder,
  getOrder,
  getOrderById,
  settlePayment,
  refundOrder,
  listOrders,
  getBeneficiary,
  upsertCustomer,
  parseJson,
};
