'use strict';
require('dotenv').config();

const path = require('path');

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
  appName: process.env.APP_NAME || 'RemesaYa',
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Carpeta donde vive la base SQLite. En Render debe apuntar al disco persistente:
  // DATA_DIR=/opt/render/project/src/app/data  (o /var/data si montas ahí el disco)
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  // Permite usar otro nombre de archivo (útil para respaldos o multi-entorno).
  dbFile: process.env.DB_FILE || 'remesaya.db',
  // Respaldo automático: cada N horas se copia la base a <dataDir>/backups.
  backupIntervalHours: Number(process.env.BACKUP_INTERVAL_HOURS || 6),
  backupKeep: Number(process.env.BACKUP_KEEP || 20),
  // Clave maestra para cifrar los respaldos (AES-256-GCM + scrypt).
  // Si no se define, se usa DATA_ENCRYPTION_KEY. En producción es obligatoria.
  backupEncryptionKey: process.env.BACKUP_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY || '',

  dlocalgo: {
    apiUrl: (process.env.DLOCALGO_API_URL || 'https://api-sbx.dlocalgo.com').replace(/\/$/, ''),
    apiKey: process.env.DLOCALGO_API_KEY || '',
    apiSecret: process.env.DLOCALGO_API_SECRET || '',
    webhookSecret: process.env.DLOCALGO_WEBHOOK_SECRET || '',
    timeoutMs: Number(process.env.DLOCALGO_TIMEOUT_MS || 20000),
  },

  smartfields: {
    apiKey: process.env.SMARTFIELDS_API_KEY || '',
    sdkUrl: process.env.SMARTFIELDS_SDK_URL || 'https://checkout-sbx.dlocalgo.com/js/dlocalgo-smartfields-bundled.js',
  },

  admin: {
    email: (process.env.ADMIN_EMAIL || 'admin@remesaya.app').toLowerCase(),
    password: process.env.ADMIN_PASSWORD || 'cambia-esta-clave-ahora',
  },

  sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
  encryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
  docPepper: process.env.DOC_PEPPER || 'dev-only-pepper',

  breb: {
    mode: (process.env.BREB_MODE || 'auto').toLowerCase(),
    apiUrl: (process.env.BREB_API_URL || '').replace(/\/$/, ''),
    apiKey: process.env.BREB_API_KEY || '',
    participantId: process.env.BREB_PARTICIPANT_ID || '',
    merchantKey: process.env.BREB_MERCHANT_KEY || '@remesaya',
    currency: process.env.BREB_CURRENCY || 'COP',
    timeoutMs: Number(process.env.BREB_TIMEOUT_MS || 15000),
  },

  pse: {
    mode: (process.env.PSE_MODE || 'auto').toLowerCase(),
    apiUrl: (process.env.PSE_API_URL || '').replace(/\/$/, ''),
    apiKey: process.env.PSE_API_KEY || '',
    merchantId: process.env.PSE_MERCHANT_ID || '',
  },

  // Cobros y pagos en Venezuela (Pago Móvil, transferencia, efectivo) en VES.
  vepay: {
    mode: (process.env.VE_MODE || 'auto').toLowerCase(),
    apiUrl: (process.env.VE_API_URL || '').replace(/\/$/, ''),
    apiKey: process.env.VE_API_KEY || '',
    merchantName: process.env.VE_MERCHANT_NAME || 'RemesaYa',
    merchantDocument: process.env.VE_MERCHANT_DOCUMENT || '',
    merchantPhone: process.env.VE_MERCHANT_PHONE || '',
    merchantBank: process.env.VE_MERCHANT_BANK || '',
    merchantAccount: process.env.VE_MERCHANT_ACCOUNT || '',
    timeoutMs: Number(process.env.VE_TIMEOUT_MS || 15000),
  },

  fees: {
    percent: Number(process.env.FEE_PERCENT || 3.5),
    fixedCents: Number(process.env.FEE_FIXED_CENTS || 50),
    minOrderCents: Number(process.env.MIN_ORDER_CENTS || 500),
    maxOrderCents: Number(process.env.MAX_ORDER_CENTS || 500000),
  },

  defaultCurrency: process.env.DEFAULT_CURRENCY || 'USD',
  demoFallback: bool(process.env.DEMO_FALLBACK, true),
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  trustProxy: bool(process.env.TRUST_PROXY, true),
};

module.exports = config;
