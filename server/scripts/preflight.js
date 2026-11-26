'use strict';
/**
 * Preflight: se ejecuta ANTES de arrancar el servidor (npm start).
 *
 * Si Render reinicia el contenedor en mal momento (OOM, kill -9, disco lleno),
 * la base puede quedar con un WAL inconsistente o corrupta. Este script:
 *
 *   1. Limpia bloqueos huérfanos de un proceso que ya murió.
 *   2. Verifica la integridad de la base (PRAGMA integrity_check).
 *   3. Si está corrupta, restaura automáticamente el respaldo cifrado más
 *      reciente que pase la verificación.
 *   4. Si no hay respaldo válido, aparta la base dañada (no la borra) y deja
 *      que la app cree una nueva, para que el servicio NUNCA quede caído.
 *
 * Nunca aborta el arranque: en el peor caso arranca con base nueva y lo deja
 * registrado. Es preferible un servicio vivo a un servicio caído.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const DB_PATH = path.join(config.dataDir, config.dbFile);
const LOCK_PATH = `${DB_PATH}.lock`;
const BACKUP_DIR = path.join(config.dataDir, 'backups');

function say(msg) {
  console.log(`[preflight] ${msg}`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 1. Bloqueos huérfanos. */
function cleanStaleLock() {
  if (!fs.existsSync(LOCK_PATH)) return;
  const pid = Number(fs.readFileSync(LOCK_PATH, 'utf8').trim());
  if (pid && pid !== process.pid && pidAlive(pid)) {
    say(`otro proceso (${pid}) tiene la base abierta; se respeta el bloqueo`);
    return;
  }
  try {
    fs.unlinkSync(LOCK_PATH);
    say('bloqueo huérfano eliminado');
  } catch {
    /* nada */
  }
}

function integrityOf(file) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    return { ok: true, skipped: true };
  }
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const result = db.pragma('integrity_check', { simple: true });
    return { ok: result === 'ok', result };
  } catch (err) {
    return { ok: false, result: err.message };
  } finally {
    try {
      if (db) db.close();
    } catch {
      /* nada */
    }
  }
}

/** 3. Restaura el respaldo cifrado más reciente que verifique bien. */
function restoreNewestValid() {
  const backup = require('../services/backup');
  let files = [];
  try {
    files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db.enc'))
      .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch {
    return false;
  }
  if (!files.length) {
    say('no hay respaldos cifrados disponibles');
    return false;
  }

  for (const { f } of files) {
    const src = path.join(BACKUP_DIR, f);
    const tmp = path.join(config.dataDir, `.preflight-${Date.now()}.db`);
    try {
      backup.decryptFile(src, tmp);
      const check = integrityOf(tmp);
      if (!check.ok) {
        say(`respaldo ${f} descifra pero está dañado (${check.result}); probando el anterior`);
        continue;
      }
      // Aparta la base dañada en vez de destruirla (evidencia + rescate manual).
      if (fs.existsSync(DB_PATH)) {
        const quarantine = `${DB_PATH}.corrupt-${Date.now()}`;
        fs.renameSync(DB_PATH, quarantine);
        say(`base dañada apartada en ${path.basename(quarantine)}`);
      }
      for (const suffix of ['-wal', '-shm']) {
        try {
          fs.unlinkSync(DB_PATH + suffix);
        } catch {
          /* no existía */
        }
      }
      fs.renameSync(tmp, DB_PATH);
      fs.chmodSync(DB_PATH, 0o600);
      say(`✔ base restaurada desde ${f}`);
      return true;
    } catch (err) {
      say(`no se pudo usar ${f}: ${err.message}`);
    } finally {
      if (fs.existsSync(tmp)) {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* nada */
        }
      }
    }
  }
  return false;
}

function run() {
  say('verificando estado de la base…');
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (err) {
    say(`no se pudo preparar ${config.dataDir}: ${err.message}`);
    return;
  }

  cleanStaleLock();

  if (!fs.existsSync(DB_PATH)) {
    say('no existe base todavía; se creará una nueva al arrancar');
    return;
  }

  const check = integrityOf(DB_PATH);
  if (check.ok) {
    say(`base íntegra (${path.basename(DB_PATH)})`);
    return;
  }

  say(`base con problemas: ${check.result}`);
  if (restoreNewestValid()) return;

  // Último recurso: apartar y arrancar limpio. Nunca dejar el servicio caído.
  try {
    const quarantine = `${DB_PATH}.corrupt-${Date.now()}`;
    fs.renameSync(DB_PATH, quarantine);
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(DB_PATH + suffix);
      } catch {
        /* nada */
      }
    }
    say(`sin respaldos válidos: base apartada en ${path.basename(quarantine)}; se creará una nueva`);
  } catch (err) {
    say(`no se pudo apartar la base dañada: ${err.message}`);
  }
}

try {
  run();
} catch (err) {
  // El preflight jamás debe impedir el arranque.
  say(`error inesperado: ${err.message}`);
}
process.exit(0);
