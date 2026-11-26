'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const guardian = require('./services/guardian');
const { cleanupSessions } = require('./auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhooks');

// Contención de fallos: registrar en vez de morir.
guardian.install();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
app.use(morgan(config.isProd ? 'combined' : 'dev'));

// Cuerpo JSON con captura del texto crudo para verificar firmas de webhooks.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.' },
});
app.use('/api', globalLimiter);

app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Fallback para rutas del frontend (SPA).
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// Manejador de errores central.
app.use((err, req, res, next) => {
  let status = err.status && err.status >= 400 ? err.status : 500;
  let message = err.message || 'Error interno del servidor.';

  // Errores de parseo/cuerpo: mensajes en español, nunca el texto crudo del parser.
  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Los datos enviados no son válidos. Revisa el formulario e inténtalo de nuevo.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'El archivo o los datos son demasiado grandes.';
  } else if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    status = 415;
    message = 'Formato de contenido no soportado.';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'El archivo supera el tamaño máximo permitido.';
  } else if (status >= 500) {
    console.error('[error]', err);
    // Los servicios lanzan mensajes pensados para el usuario ("Saldo insuficiente",
    // "Beneficiario no encontrado"…). Solo ocultamos detalles técnicos.
    if (/SQLITE|SqliteError|Cannot read propert|is not a function|undefined is not/i.test(message)) {
      message = 'Ocurrió un error inesperado. Inténtalo de nuevo en unos segundos.';
    }
  }

  if (res.headersSent) return next(err);
  res.status(status).json({
    error: message,
    ...(err.details ? { details: err.details } : {}),
    ...(err.publicId ? { public_id: err.publicId } : {}),
  });
});

// Respaldos automáticos de la base (disco persistente).
try {
  require('./services/backup').schedule();
} catch (err) {
  console.error('[backup] no se pudo programar:', err.message);
}

// Archivo de bloqueo con PID: permite que `backup --restore` detecte que la
// base está en uso y se niegue a sobrescribirla (evita corromper el WAL).
const fs = require('fs');
const LOCK_FILE = path.join(config.dataDir, `${config.dbFile}.lock`);
try {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(LOCK_FILE, String(process.pid), { mode: 0o600 });
} catch (err) {
  console.error('[lock] no se pudo crear el archivo de bloqueo:', err.message);
}
function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE) && fs.readFileSync(LOCK_FILE, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    /* nada */
  }
}
process.on('exit', releaseLock);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  ${config.appName} escuchando en http://localhost:${config.port}`);
  console.log(`  Entorno: ${config.env} | Modo: real (sin simulaci\u00f3n)`);
  console.log(
    `  BRE-B: ${require('./providers/breb').mode()} | PSE: ${require('./providers/pse').mode()} | VE: ${require('./providers/vepay').mode()}`
  );
  console.log(`  Base de datos: ${path.join(config.dataDir, config.dbFile)}\n`);
});

cleanupSessions();
const cleanupTimer = setInterval(cleanupSessions, 30 * 60 * 1000);
cleanupTimer.unref();

// Mantiene el contenedor caliente (KEEPALIVE_MINUTES > 0).
try {
  guardian.keepAlive();
} catch (err) {
  console.error('[guardian] keep-alive no disponible:', err.message);
}

function shutdown(signal) {
  console.log(`\n${signal} recibido, cerrando servidor...`);
  // Render envía SIGTERM al reiniciar: volcamos el WAL para no perder nada.
  try {
    guardian.shutdownDatabase(require('./db').db);
  } catch (err) {
    console.error('[guardian] no se pudo cerrar la base:', err.message);
  }
  releaseLock();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
