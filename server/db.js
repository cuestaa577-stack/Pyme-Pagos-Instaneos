'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new Database(path.join(config.dataDir, 'remesaya.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Administrador',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  doc_type TEXT NOT NULL,
  doc_number_enc TEXT NOT NULL,
  doc_number_hash TEXT NOT NULL,
  doc_last4 TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'VE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(doc_type, doc_number_hash)
);

CREATE TABLE IF NOT EXISTS beneficiaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_number_enc TEXT NOT NULL,
  doc_number_hash TEXT NOT NULL,
  doc_last4 TEXT NOT NULL,
  country TEXT NOT NULL,
  rail TEXT NOT NULL,                -- breb | pago_movil | bank
  bank_name TEXT,
  bank_code TEXT,
  account_type TEXT,
  account_number_enc TEXT,
  account_last4 TEXT,
  breb_key TEXT,
  phone TEXT,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_customer ON beneficiaries(customer_id);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  beneficiary_id INTEGER REFERENCES beneficiaries(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'collection',   -- collection | payout | withdrawal | refund
  method TEXT NOT NULL,                      -- card | pse | breb | cash | balance
  status TEXT NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  net_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  country TEXT NOT NULL,
  description TEXT,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  checkout_token TEXT,
  checkout_url TEXT,
  destination_currency TEXT,
  destination_amount_cents INTEGER,
  fx_rate REAL,
  idempotency_key TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  beneficiary_id INTEGER REFERENCES beneficiaries(id) ON DELETE SET NULL,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  country TEXT NOT NULL,
  flow_type TEXT NOT NULL DEFAULT 'B2C',
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL,
  provider_ref TEXT,
  idempotency_key TEXT,
  description TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  rail TEXT NOT NULL DEFAULT 'breb',
  destination_key TEXT NOT NULL,
  destination_name TEXT,
  bank_name TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  provider TEXT NOT NULL,
  provider_ref TEXT,
  tracking_code TEXT,
  idempotency_key TEXT,
  error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  withdrawal_id INTEGER REFERENCES withdrawals(id) ON DELETE SET NULL,
  payout_id INTEGER REFERENCES payouts(id) ON DELETE SET NULL,
  account TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account, currency);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  event_id TEXT,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received',
  payload TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_unique ON webhook_events(source, event_id) WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  ip TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS idempotency (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, key)
);
`);

const DEFAULT_SETTINGS = {
  fees_percent: String(config.fees.percent),
  fee_fixed_cents: String(config.fees.fixedCents),
  min_order_cents: String(config.fees.minOrderCents),
  max_order_cents: String(config.fees.maxOrderCents),
  withdrawal_fee_percent: '1.0',
  payout_fee_percent: '1.5',
  breb_merchant_key: config.breb.merchantKey,
  ves_rate: '120.00',       // VES por 1 USD (configurable)
  cop_rate: '4000.00',      // COP por 1 USD (configurable)
  support_email: 'soporte@remesaya.app',
  support_whatsapp: '+58 412 000 0000',
  maintenance_mode: '0',
  min_withdrawal_cents: '500',
  auto_disburse: '1',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
const seedSettings = db.transaction(() => {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);
});
seedSettings();

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(config.admin.email);
  if (!existing) {
    const hash = bcrypt.hashSync(config.admin.password, 12);
    db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)').run(
      config.admin.email,
      hash,
      'Administrador'
    );
  }
}
seedAdmin();

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, String(value));
}

function audit({ actor, action, entity, entityId, ip, metadata }) {
  db.prepare(
    'INSERT INTO audit_log (actor, action, entity, entity_id, ip, metadata) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(actor, action, entity || null, entityId ? String(entityId) : null, ip || null, JSON.stringify(metadata || {}));
}

module.exports = { db, getSetting, getSettings, setSetting, audit, DEFAULT_SETTINGS };
