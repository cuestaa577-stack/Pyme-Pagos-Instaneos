'use strict';
/**
 * Guardián de disponibilidad.
 *
 * Objetivo: que un reinicio de Render (deploy, OOM, crash, suspensión) no
 * tumbe la app ni pierda datos.
 *
 * Capas:
 *   1. CONTENCIÓN  — los errores no capturados se registran y el proceso sigue
 *                    sirviendo en vez de morir (mejor degradado que caído).
 *   2. PERSISTENCIA — al apagar (SIGTERM/SIGINT) se hace checkpoint del WAL y se
 *                    cierra la base: cero transacciones perdidas.
 *   3. AUTO-CURACIÓN — si la base llega corrupta, se restaura el último respaldo
 *                    cifrado válido automáticamente (ver scripts/preflight.js).
 *   4. KEEP-ALIVE   — auto-ping periódico para que el contenedor no se enfríe.
 *   5. ESTADO       — /api/health expone si estamos degradados.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('../config');

const state = {
  startedAt: new Date().toISOString(),
  degraded: false,
  incidents: [],
  lastCheckpointAt: null,
  lastKeepAliveAt: null,
  recoveries: 0,
};

const LOG_FILE = path.join(config.dataDir, 'guardian.log');

function log(level, message, extra) {
  const line = `[${new Date().toISOString()}] ${level} ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`;
  console.log(`[guardian] ${message}`);
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`);
    // Rotación simple: si pasa de 2 MB, se reinicia.
    const st = fs.statSync(LOG_FILE);
    if (st.size > 2 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch {
    /* el log nunca debe tumbar la app */
  }
}

function recordIncident(kind, err) {
  const entry = {
    kind,
    message: err && err.message ? err.message : String(err),
    stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join('\n') : undefined,
    at: new Date().toISOString(),
  };
  state.incidents.unshift(entry);
  if (state.incidents.length > 50) state.incidents.pop();
  log('ERROR', `${kind}: ${entry.message}`);
}

/**
 * Contención de fallos: en vez de process.exit(1) (que en Render provoca un
 * reinicio y una caída visible), registramos y seguimos. Si el error es
 * realmente fatal, el health check lo reportará y Render reiniciará limpio.
 */
function install() {
  process.on('uncaughtException', (err) => {
    recordIncident('uncaughtException', err);
    state.degraded = true;
    // No salimos: la siguiente petición puede seguir funcionando.
  });

  process.on('unhandledRejection', (reason) => {
    recordIncident('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
    state.degraded = true;
  });

  process.on('warning', (w) => {
    if (w.name === 'MaxListenersExceededWarning') log('WARN', w.message);
  });

  log('INFO', 'guardián activo');
}

/**
 * Checkpoint + cierre limpio de la base. Se llama en SIGTERM/SIGINT, que es
 * exactamente lo que Render envía al reiniciar o redesplegar.
 */
function shutdownDatabase(db) {
  if (!db) return;
  try {
    // Vuelca el WAL al archivo principal: nada queda pendiente.
    const r = db.pragma('wal_checkpoint(TRUNCATE)');
    state.lastCheckpointAt = new Date().toISOString();
    log('INFO', 'checkpoint WAL completado', { result: r });
  } catch (err) {
    recordIncident('checkpoint', err);
  }
  try {
    db.close();
    log('INFO', 'base de datos cerrada limpiamente');
  } catch (err) {
    recordIncident('db.close', err);
  }
}

/** Auto-ping para mantener el contenedor caliente. */
function keepAlive() {
  const minutes = Number(process.env.KEEPALIVE_MINUTES || 0);
  if (!minutes || minutes <= 0) return null;
  const url = `http://127.0.0.1:${config.port}/api/ping`;
  const timer = setInterval(() => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      res.resume();
      state.lastKeepAliveAt = new Date().toISOString();
    });
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
  }, minutes * 60 * 1000);
  if (timer.unref) timer.unref();
  log('INFO', `keep-alive cada ${minutes} min`);
  return timer;
}

function snapshot() {
  return {
    started_at: state.startedAt,
    uptime_seconds: Math.round(process.uptime()),
    degraded: state.degraded,
    recoveries: state.recoveries,
    last_checkpoint_at: state.lastCheckpointAt,
    last_keep_alive_at: state.lastKeepAliveAt,
    incidents: state.incidents.slice(0, 5),
  };
}

module.exports = { install, shutdownDatabase, keepAlive, snapshot, state, log, recordIncident };
