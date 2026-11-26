'use strict';
/**
 * CLI de respaldos cifrados.
 *
 *   node server/scripts/backup.js                 crea un respaldo cifrado
 *   node server/scripts/backup.js --list          lista los respaldos
 *   node server/scripts/backup.js --restore FILE  restaura (verifica la clave)
 *
 * La clave sale de BACKUP_ENCRYPTION_KEY (o DATA_ENCRYPTION_KEY).
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const backup = require('../services/backup');

const args = process.argv.slice(2);

function human(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

if (args.includes('--list') || args.includes('-l')) {
  const items = backup.listBackups();
  console.log(`\nRespaldos cifrados en ${backup.BACKUP_DIR}`);
  console.log(`Cifrado: AES-256-GCM | Rotación: últimos ${config.backupKeep}\n`);
  if (!items.length) {
    console.log('  (todavía no hay respaldos)\n');
  } else {
    for (const b of items) {
      console.log(`  ${b.name}  ${human(b.size).padStart(8)}  ${b.created_at}`);
    }
    console.log('');
  }
  process.exit(0);
}

if (args.includes('--restore')) {
  const file = args[args.indexOf('--restore') + 1];
  if (!file) {
    console.error('Uso: node server/scripts/backup.js --restore <archivo.db.enc>');
    process.exit(1);
  }
  const src = path.isAbsolute(file)
    ? file
    : fs.existsSync(file)
      ? path.resolve(file)
      : path.join(backup.BACKUP_DIR, file);
  const dest = path.join(config.dataDir, config.dbFile);
  try {
    const r = backup.restore(src, dest);
    console.log('\n✔ Respaldo restaurado y verificado.');
    console.log(`  origen:  ${r.from}`);
    console.log(`  destino: ${r.restored}`);
    console.log('\nReinicia el servidor para que abra la base restaurada.\n');
  } catch (err) {
    console.error(`\n✖ No se pudo restaurar: ${err.message}`);
    console.error('  Verifica que BACKUP_ENCRYPTION_KEY sea la misma con la que se creó.\n');
    process.exit(1);
  }
  process.exit(0);
}

// Por defecto: crear respaldo.
try {
  const r = backup.runBackup('manual');
  console.log('\n✔ Respaldo cifrado creado');
  console.log(`  archivo: ${r.name}`);
  console.log(`  ruta:    ${r.file}`);
  console.log(`  tamaño:  ${human(r.size)}`);
  console.log(`  cifrado: AES-256-GCM (scrypt N=2^15)`);
  console.log(`  base:    ${path.join(config.dataDir, config.dbFile)}`);
  console.log('\nSin BACKUP_ENCRYPTION_KEY este archivo es irrecuperable. Guárdala aparte.\n');
} catch (err) {
  console.error(`\n✖ Falló el respaldo: ${err.message}\n`);
  process.exit(1);
}
