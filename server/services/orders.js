'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
const catalog = require('../lib/countries');

const METHODS = catalog.METHOD_IDS;
const VE_METHODS = ['ve_pago_movil', 've_transfer', 've_cash'];
const RAILS = catalog.RAILS;

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

/**
 * Valida el documento según el país de la operación: cédula venezolana para
 * Venezuela y documento genérico (RUT, DNI, CURP, pasaporte...) para el resto.
 */
function validateDocument(document, country = 'VE') {
  if (String(country).toUpperCase() === 'VE') return cedula.validate(document);
  const raw = String(document || '').trim();
  if (raw.length < 5 || !/^[A-Za-z0-9.\-\s]+$/.test(raw)) {
    return { valid: false, error: 'Documento de identidad inválido.' };
  }
  return { valid: true, type: 'DOC', normalized: raw.toUpperCase(), number: raw };
}

/**
 * Número "limpio" del documento para enviarlo al proveedor. En Venezuela se
 * usa la cédula sin tipo ni separadores; fuera de Venezuela se respeta el
 * documento local (RUT, DNI, CUIT...) tal como lo escribió el cliente.
 */
function documentNumber(document, country = 'VE') {
  if (String(country).toUpperCase() === 'VE') return cedula.parse(document)?.number || String(document || '');
  return String(document || '').trim().toUpperCase();
}

function maskDocument(document, country = 'VE') {
  if (String(country).toUpperCase() === 'VE') return cedula.mask(document);
  const raw = String(document || '').replace(/\s+/g, '');
  return raw.length >= 3 ? `DOC-***${raw.slice(-3)}` : 'DOC-***';
}

function upsertCustomer({ fullName, email, phone, document, country = 'VE' }) {
  const doc = validateDocument(document, country);
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
  const doc = validateDocument(data.document, data.country);
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
  } else if (data.rail === 'wallet') {
    // Billeteras: Nequi, Daviplata, Yape, Plin, Mercado Pago, tPago, Yappy, Bizum, Zelle…
    if (!key || String(key).replace(/[^\dA-Za-z@.+_-]/g, '').length < 4) {
      throw new Error('Ingresa el teléfono, correo o alias de la billetera.');
    }
    if (!data.bankName) throw new Error('Selecciona la billetera de destino.');
  } else if (data.rail === 'cash_pickup') {
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

/**
 * Una vía sin credenciales reales no se simula: se deriva al cobro manual con
 * comprobante (transferencia / Pago Móvil / efectivo verificados por el dueño).
 */
function isNotLiveError(err) {
  return Boolean(err && (err.notLive || (err.auth && !config.dlocalgo.apiKey)));
}

/**
 * Vías que se cobran de verdad fuera de la app (transferencia, Pago Móvil,
 * depósito, Zelle). Si no hay proveedor en vivo, la orden queda en revisión
 * manual: el cliente transfiere a la cuenta del negocio y sube el comprobante.
 */
const MANUAL_METHODS = ['breb', 'pse', 'cash', 've_pago_movil', 've_transfer', 've_cash'];

function isManualProvider(provider) {
  return provider === 'manual';
}

/** Vía de entrega por defecto: la del método si es válida en el destino. */
function defaultRail(method, destinationCountry) {
  const rails = catalog.receiveRails(destinationCountry);
  const preferred = catalog.railFor(method);
  if (rails.includes(preferred)) return preferred;
  return rails[0] || 'bank';
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function createOrder(input, { ip } = {}) {
  if (!METHODS.includes(input.method)) throw badRequest('Método de pago inválido.');
  const payerCountry = String(input.payerCountry || 'CO').toUpperCase();
  const destinationCountry = String(input.country || 'VE').toUpperCase();
  // La moneda la determina el método de cobro (o el país del pagador si el
  // método es genérico: tarjeta / efectivo).
  const currency = catalog.currencyFor(input.method, payerCountry);

  if (!catalog.isValidMethodFor(input.method, payerCountry)) {
    throw badRequest(`El método seleccionado no está disponible para pagos desde ${payerCountry}.`);
  }
  if (!catalog.country(destinationCountry)) {
    throw badRequest('País de destino no soportado.');
  }
  if (input.currency && String(input.currency).toUpperCase() !== currency) {
    throw badRequest(`Este método se cobra en ${currency}.`);
  }
  // Respeta los interruptores de vías de pago configurados por el propietario.
  const settings = getSettings();
  const methodSwitch = {
    card: 'pay_card',
    pse: 'pay_pse',
    breb: 'pay_breb',
    cash: 'pay_cash',
    ve_pago_movil: 'pay_ve',
    ve_transfer: 'pay_ve',
    ve_cash: 'pay_ve',
  }[input.method];
  if (methodSwitch && settings[methodSwitch] === '0') {
    throw badRequest('Esta vía de pago está desactivada temporalmente.');
  }
  // Sin credenciales reales no hay cobro con tarjeta: se pide elegir otra vía.
  if (input.method === 'card' && !dlocalgo.isLive()) {
    throw badRequest(
      'El pago con tarjeta todavía no está habilitado. Elige transferencia, Pago Móvil o efectivo.'
    );
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
    country: payerCountry,
  });

  let beneficiaryId;
  try {
    beneficiaryId = createBeneficiary(customer.id, {
    fullName: input.beneficiaryName,
    document: input.beneficiaryDocument,
    country: destinationCountry,
    rail: input.rail || defaultRail(input.method, destinationCountry),
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
    direction: input.direction === 'receive' ? 'receive' : 'send',
    payer_country: payerCountry,
    payer_document_masked: maskDocument(input.document, payerCountry),
    beneficiary_document_masked: maskDocument(input.beneficiaryDocument, destinationCountry),
    rail: input.rail || defaultRail(input.method, destinationCountry),
    key_type: input.keyType || null,
    breb_key_masked: input.brebKey ? `${String(input.brebKey).slice(0, 3)}***${String(input.brebKey).slice(-3)}` : null,
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
    document_type: payerCountry === 'VE' ? 'CI' : 'OTHER',
    document: documentNumber(input.document, payerCountry),
  };

  try {
    if ((input.method === 'card' || input.method === 'cash') && !dlocalgo.isLive()) {
      // Sin credenciales reales no se simula: el efectivo se cobra con las
      // instrucciones del negocio y comprobante.
      provider = 'manual';
      checkoutUrl = `/pay/manual/${pid}`;
      status = 'pending';
      metadata.manual = true;
      metadata.manual_rail = input.method;
      metadata.provider_note = 'Cobro manual: paga en efectivo y sube el comprobante.';
    } else if (input.method === 'card' || input.method === 'cash') {
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
      if (input.method === 'card') payload.allow_3ds = true;
      const payment = await dlocalgo.createPayment(payload);
      providerRef = payment.providerRef;
      checkoutUrl = payment.checkoutUrl;
      checkoutToken = payment.checkoutToken;
      status = payment.status;
    } else if (input.method === 'pse' && !pse.isLive()) {
      provider = 'manual';
      checkoutUrl = `/pay/manual/${pid}`;
      status = 'pending';
      metadata.manual = true;
      metadata.manual_rail = 'pse';
      metadata.provider_note = 'Cobro manual: transferencia a la cuenta del negocio con comprobante.';
    } else if (input.method === 'pse') {
      const session = await pse.createSession({
        amountCents: q.total_cents,
        currency,
        document: documentNumber(input.document, payerCountry),
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
      if (breb.isLive()) {
        provider = 'breb';
        checkoutUrl = `/pay/breb/${pid}`;
      } else {
        provider = 'manual';
        checkoutUrl = `/pay/manual/${pid}`;
        metadata.manual = true;
        metadata.manual_rail = 'breb';
        metadata.provider_note = 'Cobro manual: el cliente transfiere y sube el comprobante.';
      }
      status = 'pending';
    } else if (isVeMethod && !vepay.isLive()) {
      provider = 'manual';
      checkoutUrl = `/pay/manual/${pid}`;
      status = 'pending';
      metadata.manual = true;
      metadata.manual_rail = METHOD_TO_VE_RAIL[input.method];
      metadata.provider_note = 'Cobro manual: Pago Móvil / transferencia con comprobante.';
    } else if (isVeMethod) {
      const collection = await vepay.createCollection({
        amountCents: q.total_cents,
        currency,
        rail: METHOD_TO_VE_RAIL[input.method],
        reference: oid,
        payerName: input.fullName,
        payerDocument: documentNumber(input.document, payerCountry),
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
    } else {
      // Métodos locales (Webpay, Mercado Pago, Nequi, Yape, SPEI, Zelle…) sin
      // adaptador propio: se cobran por transferencia a la cuenta del negocio y
      // el cliente sube el comprobante. Dinero real, sin simulación.
      provider = 'manual';
      checkoutUrl = `/pay/manual/${pid}`;
      status = 'pending';
      metadata.manual = true;
      metadata.manual_rail = input.method;
      metadata.provider_note = 'Cobro manual: transferencia a la cuenta del negocio con comprobante.';
    }
  } catch (err) {
    if (isNotLiveError(err) && MANUAL_METHODS.includes(input.method)) {
      provider = 'manual';
      checkoutUrl = `/pay/manual/${pid}`;
      status = 'pending';
      metadata.manual = true;
      metadata.manual_rail = METHOD_TO_VE_RAIL[input.method] || input.method;
      metadata.provider_note = 'Cobro manual: el cliente transfiere a la cuenta del negocio y sube el comprobante.';
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
              b.phone AS beneficiary_phone,
              (SELECT p.status FROM payouts p WHERE p.transaction_id = t.id ORDER BY p.id DESC LIMIT 1) AS payout_status,
              (SELECT p.public_id FROM payouts p WHERE p.transaction_id = t.id ORDER BY p.id DESC LIMIT 1) AS payout_public_id
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
 * Entrega automática al beneficiario. Si el riel de destino tiene credenciales
 * reales se envía en el acto; si no, la entrega queda pendiente y el
 * administrador la marca como pagada cuando hace la transferencia.
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

  // Cobro manual: el dinero ya entró a la cuenta del negocio (el administrador
  // verificó el comprobante). La entrega se registra igual, pero si el riel de
  // destino no tiene credenciales reales queda PENDIENTE para que el dueño la
  // ejecute y la marque como pagada desde el panel.
  const isManual = t.provider === 'manual';
  const isVes = t.destination_currency === 'VES';
  const railLive = isVes ? vepay.isLive() : t.destination_currency === 'COP' ? breb.isLive() : false;

  let payoutProvider = isManual || !railLive ? 'manual' : isVes ? 'vepay' : 'breb';
  let payoutRef = null;
  let payoutStatus = railLive && !isManual ? 'processing' : 'pending';

  if (railLive && !isManual) {
    try {
      const sent = isVes
        ? await vepay.sendPayout({
            amountCents: t.destination_amount_cents,
            currency: 'VES',
            rail: b.rail === 'transfer_ve' || b.rail === 'cash_ve' ? b.rail : 'pago_movil_ve',
            reference: t.order_id,
            beneficiaryName: b.full_name,
            beneficiaryDocument: b.doc_number,
            phone: b.phone || b.breb_key,
            bankCode: b.bank_code,
            description: `Entrega automática de ${t.public_id}`,
          })
        : await breb.sendTransfer({
            amountCents: t.destination_amount_cents,
            currency: 'COP',
            keyType: 'cedula',
            keyValue: b.breb_key || b.doc_number,
            beneficiaryName: b.full_name,
            documentType: 'CC',
            documentNumber: b.doc_number,
            reference: t.order_id,
            description: `Entrega automática de ${t.public_id}`,
          });
      payoutProvider = sent.provider;
      payoutRef = sent.providerRef;
      payoutStatus = sent.status === 'completed' ? 'completed' : 'processing';
    } catch (err) {
      // El riel estaba en vivo pero falló: queda pendiente para reintento manual.
      payoutProvider = isVes ? 'vepay' : 'breb';
      payoutStatus = 'pending';
      payoutRef = null;
      console.error('[disburse] fallo al entregar', t.public_id, err.message);
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

  if (payoutStatus !== 'completed') {
    // Todavía no salió dinero: no tocamos el ledger ni damos la orden por
    // completada. Queda registrada la entrega pendiente en el panel.
    return db.prepare('SELECT * FROM payouts WHERE id = ?').get(payoutId);
  }

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
      destination_amount_formatted: r.destination_amount_cents
        ? format(r.destination_amount_cents, r.destination_currency)
        : null,
    })),
  };
}


/* ------------------------------------------------------------------ *
 * Comprobantes de pago (vías manuales)
 * ------------------------------------------------------------------ */

const PROOF_DIR = path.join(config.dataDir, 'proofs');
const PROOF_MIMES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

function ensureProofDir() {
  try {
    fs.mkdirSync(PROOF_DIR, { recursive: true });
  } catch (err) {
    console.error(`[proofs] no se pudo crear ${PROOF_DIR}: ${err.message}`);
  }
}

function listProofs(transactionId) {
  return db
    .prepare('SELECT * FROM payment_proofs WHERE transaction_id = ? ORDER BY id DESC')
    .all(transactionId);
}

function attachProof(publicIdValue, { buffer, mime, originalName, reference, note, ip } = {}) {
  const order = getOrder(publicIdValue);
  if (!order) throw badRequest('Orden no encontrada.');
  if (!['pending', 'processing'].includes(order.status)) {
    throw badRequest(`La orden ya está ${order.status}; no admite más comprobantes.`);
  }
  if (order.provider !== 'manual') {
    throw badRequest('Esta orden se paga por pasarela; no necesitas subir comprobante.');
  }
  const type = String(mime || '').split(';')[0].toLowerCase();
  const ext = PROOF_MIMES[type];
  if (!ext) throw badRequest('Sube una imagen (JPG, PNG, WEBP) o un PDF del comprobante.');
  if (!buffer || !buffer.length) throw badRequest('El archivo del comprobante está vacío.');
  if (buffer.length > 8 * 1024 * 1024) throw badRequest('El comprobante no puede pasar de 8 MB.');

  ensureProofDir();
  const fileName = `${order.public_id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(PROOF_DIR, fileName), buffer);

  const info = db
    .prepare(
      `INSERT INTO payment_proofs (transaction_id, file_name, original_name, mime, size_bytes, reference, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      order.id,
      fileName,
      String(originalName || fileName).slice(0, 180),
      type,
      buffer.length,
      String(reference || '').slice(0, 120) || null,
      String(note || '').slice(0, 500) || null
    );

  const metadata = {
    ...order.metadata,
    proof_status: 'pending',
    proof_reference: reference || null,
    proof_uploaded_at: new Date().toISOString(),
  };
  // Un comprobante nuevo limpia el rechazo anterior.
  delete metadata.rejection_reason;
  delete metadata.rejected_by;
  delete metadata.rejected_at;
  delete metadata.requires_new_proof;
  db.prepare(
    `UPDATE transactions SET metadata = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(metadata), order.id);

  audit({
    actor: 'customer',
    action: 'proof.upload',
    entity: 'transaction',
    entityId: order.public_id,
    ip,
    metadata: { proof_id: Number(info.lastInsertRowid), reference: reference || null, size: buffer.length },
  });

  return {
    proof: db.prepare('SELECT * FROM payment_proofs WHERE id = ?').get(Number(info.lastInsertRowid)),
    order: getOrder(publicIdValue),
  };
}

function proofFile(proofId) {
  const row = db.prepare('SELECT * FROM payment_proofs WHERE id = ?').get(Number(proofId));
  if (!row || !row.file_name) return null;
  const full = path.join(PROOF_DIR, row.file_name);
  if (!fs.existsSync(full)) return null;
  return { ...row, path: full };
}

async function reviewProof(publicIdValue, { action, actor = 'admin', ip, note } = {}) {
  const order = getOrder(publicIdValue);
  if (!order) throw badRequest('Orden no encontrada.');
  if (!['pending', 'processing'].includes(order.status)) {
    throw badRequest(`La orden ya está ${order.status}.`);
  }
  if (!['approve', 'reject'].includes(action)) throw badRequest('Acción inválida.');

  const proof = db
    .prepare("SELECT * FROM payment_proofs WHERE transaction_id = ? AND status = 'pending' ORDER BY id DESC")
    .get(order.id);

  const status = action === 'approve' ? 'approved' : 'rejected';
  if (proof) {
    db.prepare(
      `UPDATE payment_proofs SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?
       WHERE id = ?`
    ).run(status, actor, String(note || '').slice(0, 500) || null, proof.id);
  }

  if (action === 'approve') {
    const updated = await settlePayment(order.public_id, {
      status: 'APPROVED',
      providerRef: `MANUAL-${order.public_id}`,
      source: `admin:${actor}`,
    });
    audit({
      actor,
      action: 'order.manual_approve',
      entity: 'transaction',
      entityId: order.public_id,
      ip,
      metadata: { proof_id: proof ? proof.id : null, note: note || null },
    });
    return updated;
  }

  // Rechazar un comprobante NO cancela la orden: el cliente puede subir otro.
  // Así no se pierde la venta por una foto borrosa o un monto mal escrito.
  const metadata = {
    ...order.metadata,
    proof_status: 'rejected',
    rejection_reason: String(note || 'Comprobante no válido.').slice(0, 300),
    rejected_by: actor,
    rejected_at: new Date().toISOString(),
    requires_new_proof: true,
  };
  db.prepare(
    `UPDATE transactions SET metadata = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(metadata), order.id);
  audit({
    actor,
    action: 'order.manual_reject',
    entity: 'transaction',
    entityId: order.public_id,
    ip,
    metadata: { proof_id: proof ? proof.id : null, note: note || null },
  });
  return getOrder(publicIdValue);
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
  validateDocument,
  documentNumber,
  MANUAL_METHODS,
  isManualProvider,
  attachProof,
  listProofs,
  proofFile,
  reviewProof,
};
