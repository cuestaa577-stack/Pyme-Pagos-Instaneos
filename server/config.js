'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * Resuelve la carpeta de datos SIN poder tumbar la app.
 *
 * En Render la ruta del disco cambia según cómo lo montes. Si DATA_DIR apunta a
 * una ruta que no existe o donde no tenemos permiso (típico: /var/data cuando
 * el disco quedó en otra ruta), antes la app moría con EACCES y el servicio
 * entraba en bucle de reinicios. Ahora probamos candidatos en orden y usamos el
 * primero que sea escribible; el último recurso siempre funciona porque está
 * dentro del proyecto.
 */
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * ¿La carpeta cae dentro del código del proyecto?
 * En Render (y en cualquier PaaS) el código se reemplaza en cada deploy y el
 * sistema de archivos es efímero: si la base vive ahí, se borra en cada
 * reinicio. Escribir sí se puede, así que la app no falla… pero pierde datos.
 * Por eso lo detectamos y avisamos en voz alta.
 */
function isInsideRepo(dir) {
  const rel = path.relative(REPO_ROOT, path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveDataDir() {
  const raw = process.env.DATA_DIR;
  const candidates = [];
  if (raw) {
    // Una ruta relativa (p. ej. "app/data") se resuelve contra el cwd, que en
    // Render es la raíz del repo: termina siendo código efímero.
    if (!path.isAbsolute(raw)) {
      console.warn(
        `[config] DATA_DIR="${raw}" es una ruta RELATIVA; se resuelve a ` +
          `${path.resolve(raw)}. En Render usa una ruta ABSOLUTA igual al ` +
          'Mount Path del disco (p. ej. /var/data).'
      );
    }
    candidates.push(path.resolve(raw));
  }
  // Rutas típicas de un disco persistente en Render.
  candidates.push('/var/data');
  candidates.push(path.join(REPO_ROOT, 'data'));
  candidates.push(path.join(process.cwd(), 'data'));
  candidates.push(path.join(require('os').tmpdir(), 'remesaya-data'));

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Comprobamos escritura real, no solo que exista.
      const probe = path.join(dir, `.write-test-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      if (raw && path.resolve(raw) !== dir) {
        console.warn(
          `[config] DATA_DIR=${raw} no es escribible; usando ${dir}. ` +
            'Revisa que el disco persistente esté montado en esa ruta.'
        );
      }
      if (isInsideRepo(dir)) {
        console.warn(
          `[config] ATENCIÓN: la base quedará en ${dir}, DENTRO del código. ` +
            'En Render el sistema de archivos es efímero: se borra en cada ' +
            'deploy o reinicio. Monta un disco y apunta DATA_DIR a su Mount ' +
            'Path absoluto (normalmente /var/data).'
        );
      }
      return dir;
    } catch {
      /* siguiente candidato */
    }
  }
  // Si ni siquiera el temporal funciona, devolvemos la ruta pedida y que falle
  // explícitamente más adelante con un mensaje claro.
  return path.resolve(raw || path.join(REPO_ROOT, 'data'));
}

const config = {
  appName: process.env.APP_NAME || 'RemesaYa',
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // Carpeta donde vive la base SQLite. Se resuelve a la primera ruta escribible
  // (ver resolveDataDir) para que un disco mal montado no tumbe el servicio.
  dataDir: resolveDataDir(),
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
