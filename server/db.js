'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');

// La carpeta ya la validó config.resolveDataDir(), pero nunca está de más:
// un fallo aquí antes mataba el proceso con EACCES y Render reiniciaba en bucle.
try {
  fs.mkdirSync(config.dataDir, { recursive: true });
} catch (err) {
  console.error(`[db] no se pudo crear ${config.dataDir}: ${err.message}`);
}

const DB_PATH = path.join(config.dataDir, config.dbFile);
let db;
try {
  db = new Database(DB_PATH);
} catch (err) {
  console.error(`[db] no se pudo abrir ${DB_PATH}: ${err.message}`);
  // Último recurso: base en memoria para que el servicio siga respondiendo
  // (los datos no persistirán, pero la app no se cae y el health check avisa).
  db = new Database(':memory:');
  console.error('[db] ATENCIÓN: usando base en memoria; revisa el disco persistente.');
}
db.pragma('journal_mode = WAL');
// FULL: cada commit se sincroniza a disco antes de confirmar. Cuesta algo de
// rendimiento pero garantiza que un kill -9 o un reinicio de Render no pierda
// una transacción ya confirmada al cliente.
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');
// Si otro proceso tiene la base bloqueada un instante, esperamos en vez de fallar.
db.pragma('busy_timeout = 5000');
db.pragma('wal_autocheckpoint = 1000');

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

-- Comprobantes de pago subidos por el cliente para las vías manuales
-- (transferencia, Pago Móvil, depósito, Zelle). El dinero se mueve de verdad
-- fuera de la app; aquí queda la prueba y el administrador la verifica.
CREATE TABLE IF NOT EXISTS payment_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  file_name TEXT,
  original_name TEXT,
  mime TEXT,
  size_bytes INTEGER,
  reference TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proofs_transaction ON payment_proofs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_proofs_status ON payment_proofs(status);
`);

/**
 * Migraciones ligeras: agrega columnas si no existen (SQLite no soporta
 * ADD COLUMN IF NOT EXISTS).
 */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
// Momento en que los fondos del cobro quedan liquidados por el proveedor.
ensureColumn('transactions', 'available_at', 'TEXT');
// Días de liquidación aplicados al cobro (T+N).
ensureColumn('transactions', 'settlement_days', 'INTEGER');
// Marca de liberación contable (pending → available).
ensureColumn('transactions', 'settled_at', 'TEXT');

const DEFAULT_SETTINGS = {
  fees_percent: String(config.fees.percent),
  fee_fixed_cents: String(config.fees.fixedCents),
  min_order_cents: '0',
  max_order_cents: String(config.fees.maxOrderCents),
  withdrawal_fee_percent: '1.0',
  payout_fee_percent: '1.5',
  breb_merchant_key: config.breb.merchantKey,
  ves_rate: '120.00',       // VES por 1 USD (configurable)
  cop_rate: '4000.00',      // COP por 1 USD (configurable)
  clp_rate: '950.00',       // CLP por 1 USD
  pen_rate: '3.75',         // PEN por 1 USD
  ars_rate: '1000.00',      // ARS por 1 USD
  mxn_rate: '18.50',        // MXN por 1 USD
  dop_rate: '59.00',        // DOP por 1 USD
  brl_rate: '5.40',         // BRL por 1 USD
  eur_rate: '0.92',         // EUR por 1 USD
  support_email: 'soporte@remesaya.app',
  support_whatsapp: '+58 412 000 0000',
  support_phone: '+58 412 000 0000',
  support_hours: 'Lun a Dom · 8:00 a 22:00 (VET)',
  // Interruptores de dirección: enviar y recibir.
  direction_send: '1',
  direction_receive: '1',
  maintenance_mode: '0',
  min_withdrawal_cents: '0',
  auto_disburse: '1',
  // Datos del comercio para cobros por Pago Móvil / transferencia en Venezuela.
  ve_merchant_name: '',
  ve_merchant_document: '',
  ve_merchant_phone: '',
  ve_merchant_bank: '',
  ve_merchant_account: '',
  // Cuentas de recaudo que se muestran al cliente en el pago manual. Son los
  // datos reales del negocio: el cliente transfiere ahí y sube el comprobante.
  collect_ve_pago_movil_holder: '',
  collect_ve_pago_movil_id: '',
  collect_ve_pago_movil_phone: '',
  collect_ve_pago_movil_bank: '',
  collect_ve_transfer_holder: '',
  collect_ve_transfer_id: '',
  collect_ve_transfer_bank: '',
  collect_ve_transfer_account: '',
  collect_intl_holder: '',
  collect_intl_bank: '',
  collect_intl_account: '',
  collect_intl_swift: '',
  collect_intl_zelle: '',
  collect_cash_note: '',
  collect_instructions: '',
  manual_review: '1',
  // Interruptores de vías de pago (1 = activa, 0 = desactivada).
  pay_card: '1',
  pay_pse: '1',
  pay_breb: '1',
  pay_cash: '1',
  pay_ve: '1',
  // Días que el proveedor retiene los fondos antes de liquidarlos (T+N).
  // El beneficiario cobra al instante igual: la entrega se financia con el
  // float de liquidez del comercio y se reembolsa cuando llega la liquidación.
  settlement_days_card: '7',
  settlement_days_pse: '1',
  settlement_days_breb: '0',
  settlement_days_cash: '2',
  settlement_days_ve: '0',
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
const seedSettings = db.transaction(() => {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);
});
seedSettings();

/**
 * Crea el administrador si no existe y, si ADMIN_PASSWORD está definida de
 * forma explícita, sincroniza la contraseña.
 *
 * Antes solo insertaba si el correo no existía. Eso provocaba el fallo más
 * común: la base se creó con el correo por defecto (admin@remesaya.app) o con
 * otra clave, y cambiar ADMIN_EMAIL / ADMIN_PASSWORD en Render después no
 * tenía ningún efecto. Ahora las variables de entorno mandan.
 */
function seedAdmin() {
  const email = config.admin.email;
  const password = config.admin.password;
  const existing = db.prepare('SELECT id, email, password_hash FROM admins WHERE email = ?').get(email);

  if (!existing) {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)').run(
      email,
      hash,
      'Administrador'
    );
    console.log(`[db] administrador creado: ${email}`);
    return;
  }

  // Si la contraseña vino por variable de entorno y no coincide con la
  // guardada, la actualizamos. Así "cambio ADMIN_PASSWORD en Render y
  // redeploy" siempre funciona.
  if (process.env.ADMIN_PASSWORD && !bcrypt.compareSync(password, existing.password_hash)) {
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(password, 12),
      existing.id
    );
    console.log(`[db] contraseña del administrador actualizada desde ADMIN_PASSWORD (${email})`);
  }

  // Aviso si hay otros administradores con correos distintos: es la causa
  // típica de "pongo mi correo y no me deja entrar".
  const others = db
    .prepare('SELECT email FROM admins WHERE email <> ?')
    .all(email)
    .map((r) => r.email);
  if (others.length) {
    console.warn(
      `[db] ATENCIÓN: además de ${email} hay otros administradores: ${others.join(', ')}. ` +
        'Si intentas entrar con uno de ellos, usa SU contraseña (no la de ADMIN_PASSWORD).'
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
