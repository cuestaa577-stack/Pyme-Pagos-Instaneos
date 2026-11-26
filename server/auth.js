'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const config = require('./config');
const { sign, timingSafeEqual } = require('./lib/crypto');

const COOKIE = 'ry_session';
const SESSION_HOURS = 12;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: '/',
  };
}

function login({ email, password, ip, userAgent }) {
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(String(email || '').toLowerCase());
  if (!admin || !bcrypt.compareSync(String(password || ''), admin.password_hash)) {
    return null;
  }
  const id = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, admin_id, csrf_token, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, admin.id, csrf, ip || null, userAgent || null, expires);
  db.prepare(`UPDATE admins SET last_login_at = datetime('now') WHERE id = ?`).run(admin.id);
  return {
    cookie: `${id}.${sign(id)}`,
    csrf,
    admin: { id: admin.id, email: admin.email, name: admin.name },
    expires,
  };
}

function parseCookieHeader(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
  return out;
}

function getSession(req) {
  const cookies = parseCookieHeader(req.headers.cookie);
  const raw = cookies[COOKIE];
  if (!raw) return null;
  const [id, signature] = raw.split('.');
  if (!id || !signature) return null;
  if (!timingSafeEqual(signature, sign(id))) return null;
  const row = db
    .prepare(
      `SELECT s.*, a.email, a.name FROM sessions s JOIN admins a ON a.id = s.admin_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .get(id);
  if (!row) return null;
  return { session: row, admin: { id: row.admin_id, email: row.email, name: row.name } };
}

function requireAdmin(req, res, next) {
  const ctx = getSession(req);
  if (!ctx) return res.status(401).json({ error: 'Sesión no válida o expirada.' });
  req.admin = ctx.admin;
  req.session = ctx.session;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const token = req.headers['x-csrf-token'];
    if (!token || !timingSafeEqual(token, ctx.session.csrf_token)) {
      return res.status(403).json({ error: 'Token CSRF inválido.' });
    }
  }
  return next();
}

function logout(req) {
  const ctx = getSession(req);
  if (ctx) db.prepare('DELETE FROM sessions WHERE id = ?').run(ctx.session.id);
}

function cleanupSessions() {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
}

module.exports = { COOKIE, cookieOptions, login, logout, getSession, requireAdmin, cleanupSessions, parseCookieHeader };
