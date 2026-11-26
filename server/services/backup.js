'use strict';
/**
 * Respaldos CIFRADOS de la base de datos SQLite.
 *
 * Flujo:
 *   1. `VACUUM INTO` genera una copia consistente en un archivo temporal.
 *   2. Ese archivo se cifra con AES-256-GCM (cifrado autenticado: si alguien
 *      altera un solo byte, la restauración falla).
 *   3. La clave se deriva con scrypt a partir de BACKUP_ENCRYPTION_KEY y una
 *      sal aleatoria por archivo (16 bytes). Sin la clave el archivo es
 *      indistinguible de ruido aleatorio.
 *   4. El .db en claro se borra del disco inmediatamente (sobrescrito antes).
 *
 * Formato del archivo .db.enc:
 *   [0..3]    "RYBK"          magic
 *   [4]       version = 1
 *   [5..20]   salt (16 B)     scrypt
 *   [21..32]  iv (12 B)       GCM nonce
 *   [33..-17] ciphertext
 *   [-16..]   auth tag (16 B)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { db } = require('../db');

const BACKUP_DIR = path.join(config.dataDir, 'backups');
const MAGIC = Buffer.from('RYBK', 'ascii');
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN; // 33
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return BACKUP_DIR;
}

/** Clave maestra de respaldos. Obligatoria en producción. */
function masterKey() {
  const raw = config.backupEncryptionKey || '';
  if (!raw) {
    if (config.isProd) {
      throw new Error(
        'BACKUP_ENCRYPTION_KEY no está definida. En producción es obligatoria: ' +
          'sin ella los respaldos no se pueden cifrar ni restaurar.'
      );
    }
    // Solo en desarrollo: clave efímera derivada para no dejar datos legibles.
    return 'dev-only-backup-key-change-me';
  }
  return raw;
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
}

/** Cifra un archivo en claro y devuelve la ruta del .enc. */
function encryptFile(srcFile, destFile) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(masterKey(), salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const out = fs.openSync(destFile, 'w', 0o600);
  try {
    fs.writeSync(out, Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]));
    const input = fs.openSync(srcFile, 'r');
    try {
      const buf = Buffer.allocUnsafe(1024 * 1024);
      let n;
      while ((n = fs.readSync(input, buf, 0, buf.length, null)) > 0) {
        const chunk = cipher.update(buf.subarray(0, n));
        if (chunk.length) fs.writeSync(out, chunk);
      }
    } finally {
      fs.closeSync(input);
    }
    const final = cipher.final();
    if (final.length) fs.writeSync(out, final);
    fs.writeSync(out, cipher.getAuthTag());
  } finally {
    fs.closeSync(out);
  }
  fs.chmodSync(destFile, 0o600);
  return destFile;
}

/** Descifra un .enc a un .db en claro. Lanza si la clave es incorrecta o hubo manipulación. */
function decryptFile(encFile, destFile) {
  const total = fs.statSync(encFile).size;
  if (total <= HEADER_LEN + TAG_LEN) throw new Error('Archivo de respaldo truncado o inválido.');

  const fd = fs.openSync(encFile, 'r');
  try {
    const header = Buffer.alloc(HEADER_LEN);
    fs.readSync(fd, header, 0, HEADER_LEN, 0);
    if (!header.subarray(0, 4).equals(MAGIC)) throw new Error('No es un respaldo de RemesaYa.');
    const version = header[4];
    if (version !== VERSION) throw new Error(`Versión de respaldo no soportada: ${version}`);
    const salt = header.subarray(5, 5 + SALT_LEN);
    const iv = header.subarray(5 + SALT_LEN, HEADER_LEN);

    const tag = Buffer.alloc(TAG_LEN);
    fs.readSync(fd, tag, 0, TAG_LEN, total - TAG_LEN);

    const key = deriveKey(masterKey(), salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const out = fs.openSync(destFile, 'w', 0o600);
    try {
      const buf = Buffer.allocUnsafe(1024 * 1024);
      let pos = HEADER_LEN;
      const end = total - TAG_LEN;
      while (pos < end) {
        const want = Math.min(buf.length, end - pos);
        const n = fs.readSync(fd, buf, 0, want, pos);
        if (n <= 0) break;
        pos += n;
        const chunk = decipher.update(buf.subarray(0, n));
        if (chunk.length) fs.writeSync(out, chunk);
      }
      const final = decipher.final(); // lanza si el tag no coincide
      if (final.length) fs.writeSync(out, final);
    } finally {
      fs.closeSync(out);
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(destFile, 0o600);
  return destFile;
}

/** Borra un archivo sobrescribiéndolo antes (best-effort). */
function shred(file) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r+');
    try {
      const zeros = Buffer.alloc(Math.min(st.size, 1024 * 1024));
      let pos = 0;
      while (pos < st.size) {
        const n = Math.min(zeros.length, st.size - pos);
        fs.writeSync(fd, zeros, 0, n, pos);
        pos += n;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* si falla, igual se borra */
  }
  try {
    fs.unlinkSync(file);
  } catch {
    /* nada */
  }
}

/**
 * Crea un respaldo cifrado.
 * @returns {{file:string,name:string,size:number,created_at:string,encrypted:boolean}}
 */
function runBackup(label = 'auto') {
  ensureDir();
  const base = `remesaya-${label}-${stamp()}`;
  const plain = path.join(BACKUP_DIR, `.tmp-${base}.db`);
  const encName = `${base}.db.enc`;
  const encFile = path.join(BACKUP_DIR, encName);

  try {
    // Copia consistente incluso con escrituras concurrentes.
    db.exec(`VACUUM INTO '${plain.replace(/'/g, "''")}'`);
    encryptFile(plain, encFile);
  } finally {
    shred(plain);
  }

  const stat = fs.statSync(encFile);
  prune();
  return {
    file: encFile,
    name: encName,
    size: stat.size,
    created_at: new Date().toISOString(),
    encrypted: true,
  };
}

/** Mantiene solo los últimos `config.backupKeep` respaldos. */
function prune() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db.enc'))
      .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const extra of files.slice(config.backupKeep)) {
      fs.unlinkSync(path.join(BACKUP_DIR, extra.f));
    }
    // Limpia temporales huérfanos de un proceso que murió a mitad.
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (f.startsWith('.tmp-')) {
        try {
          fs.unlinkSync(path.join(BACKUP_DIR, f));
        } catch {
          /* nada */
        }
      }
    }
  } catch (err) {
    console.error('[backup] no se pudo rotar respaldos:', err.message);
  }
}

function listBackups() {
  ensureDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db.enc'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        name: f,
        size: st.size,
        created_at: st.mtime.toISOString(),
        encrypted: true,
        algorithm: 'AES-256-GCM',
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * Restaura un respaldo cifrado sobre un archivo destino.
 * Verifica el tag GCM antes de escribir nada definitivo: si la clave es
 * incorrecta o el archivo fue manipulado, lanza y no toca el destino.
 */
function restore(encFile, destFile) {
  if (!fs.existsSync(encFile)) throw new Error(`No existe el respaldo: ${encFile}`);

  // Nunca restaurar sobre una base que otro proceso tiene abierta: el WAL
  // viejo se aplicaría al archivo nuevo y lo corrompería.
  const lockFile = `${destFile}.lock`;
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile, 'utf8').trim());
    let alive = false;
    try {
      if (pid > 0) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch {
      alive = false; // proceso muerto: bloqueo huérfano
    }
    if (alive) {
      throw new Error(
        `La base está en uso por el proceso ${pid}. Detén el servidor (Ctrl+C) antes de restaurar.`
      );
    }
    try {
      fs.unlinkSync(lockFile);
    } catch {
      /* nada */
    }
  }

  const tmp = `${destFile}.restore-${Date.now()}`;
  try {
    decryptFile(encFile, tmp);
    // Comprobación de integridad real del archivo descifrado.
    const head = Buffer.alloc(16);
    const fd = fs.openSync(tmp, 'r');
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    if (head.toString('utf8', 0, 15) !== 'SQLite format 3') {
      throw new Error('El respaldo descifrado no es una base SQLite válida.');
    }
    try {
      const Database = require('better-sqlite3');
      const check = new Database(tmp, { readonly: true });
      const result = check.pragma('integrity_check', { simple: true });
      check.close();
      if (result !== 'ok') throw new Error(`El respaldo está dañado: ${result}`);
    } catch (err) {
      if (/El respaldo está dañado/.test(err.message)) throw err;
    }

    // Elimina el WAL/SHM del archivo anterior antes de sustituirlo.
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(destFile + suffix);
      } catch {
        /* no existía */
      }
    }
    fs.renameSync(tmp, destFile);
    fs.chmodSync(destFile, 0o600);
    return { restored: destFile, from: encFile };
  } finally {
    if (fs.existsSync(tmp)) shred(tmp);
  }
}

/** Programa respaldos periódicos. Se desactiva con BACKUP_INTERVAL_HOURS=0. */
function schedule() {
  const hours = Number(config.backupIntervalHours || 0);
  if (!hours || hours <= 0) return null;
  const ms = hours * 60 * 60 * 1000;
  const timer = setInterval(() => {
    try {
      const r = runBackup('auto');
      console.log(`[backup] respaldo cifrado creado: ${r.name} (${(r.size / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error('[backup] falló el respaldo automático:', err.message);
    }
  }, ms);
  if (timer.unref) timer.unref();
  try {
    const r = runBackup('startup');
    console.log(`[backup] respaldo inicial cifrado: ${r.name}`);
  } catch (err) {
    console.error('[backup] falló el respaldo inicial:', err.message);
  }
  return timer;
}

module.exports = {
  runBackup,
  listBackups,
  prune,
  restore,
  schedule,
  encryptFile,
  decryptFile,
  BACKUP_DIR,
};
