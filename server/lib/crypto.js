'use strict';
const crypto = require('crypto');
const config = require('../config');

function keyBuffer() {
  const raw = config.encryptionKey;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw || 'dev-key').digest();
}

/** Cifra un dato sensible (cédula, cuenta bancaria) con AES-256-GCM. */
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Hash determinista para búsquedas sin guardar el documento en claro. */
function hashDocument(doc) {
  return crypto
    .createHmac('sha256', config.docPepper)
    .update(String(doc).trim().toUpperCase())
    .digest('hex');
}

function last4(value) {
  const clean = String(value || '').replace(/[^0-9A-Za-z]/g, '');
  return clean.slice(-4);
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sign(payload, secret = config.sessionSecret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

module.exports = { encrypt, decrypt, hashDocument, last4, timingSafeEqual, randomToken, sign };
