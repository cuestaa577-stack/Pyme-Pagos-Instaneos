'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { cleanupSessions } = require('./auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const webhookRoutes = require('./routes/webhooks');

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
  const status = err.status && err.status >= 400 ? err.status : 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: err.message || 'Error interno del servidor.',
    ...(err.details ? { details: err.details } : {}),
    ...(err.publicId ? { public_id: err.publicId } : {}),
  });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  ${config.appName} escuchando en http://localhost:${config.port}`);
  console.log(`  Entorno: ${config.env} | Demo fallback: ${config.demoFallback}`);
  console.log(`  BRE-B: ${require('./providers/breb').mode()} | PSE: ${require('./providers/pse').mode()}\n`);
});

cleanupSessions();
const cleanupTimer = setInterval(cleanupSessions, 30 * 60 * 1000);
cleanupTimer.unref();

function shutdown(signal) {
  console.log(`\n${signal} recibido, cerrando servidor...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
