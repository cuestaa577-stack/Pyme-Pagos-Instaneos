'use strict';
/**
 * Gestión del administrador desde la línea de comandos.
 *
 * Sirve para diagnosticar y arreglar el caso "puse mi correo y no me deja
 * entrar" sin tener que borrar la base ni tocar variables de entorno.
 *
 * Uso:
 *   node server/scripts/admin.js --list
 *   node server/scripts/admin.js --reset --email cuestaa577@gmail.com --password Angelo18@
 *   node server/scripts/admin.js --add   --email otro@dominio.com  --password OtraClave1@
 *   node server/scripts/admin.js --delete --email viejo@dominio.com
 *   node server/scripts/admin.js --test  --email cuestaa577@gmail.com --password Angelo18@
 *
 * En Render: Shell -> node server/scripts/admin.js --list
 */
const bcrypt = require('bcryptjs');
const path = require('path');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = require('../config');
  // OJO: NO hacemos require('../db') a propósito. Ese módulo ejecuta seedAdmin()
  // y volvería a imponer ADMIN_PASSWORD del entorno, deshaciendo un --reset.
  // Aquí abrimos la base directamente.
  const Database = require('better-sqlite3');
  const dbPath = path.join(config.dataDir, config.dbFile);
  let db;
  try {
    db = new Database(dbPath);
  } catch (err) {
    console.error(`No se pudo abrir la base ${dbPath}: ${err.message}`);
    process.exit(1);
  }
  db.pragma('busy_timeout = 5000');

  const list = () => {
    const rows = db
      .prepare('SELECT id, email, name, created_at, last_login_at FROM admins ORDER BY id')
      .all();
    if (!rows.length) {
      console.log('No hay ningun administrador en la base.');
      return;
    }
    console.log(`Administradores en ${path.join(config.dataDir, config.dbFile)}:`);
    for (const r of rows) {
      console.log(
        `  #${r.id}  ${r.email}  (${r.name})  creado: ${r.created_at}  ultimo acceso: ${r.last_login_at || 'nunca'}`
      );
    }
    console.log(`\nADMIN_EMAIL actual: ${config.admin.email}`);
  };

  if (args.list || (!args.reset && !args.add && !args.delete && !args.test)) {
    list();
    return;
  }

  const email = String(args.email || config.admin.email).toLowerCase().trim();
  const password = args.password ? String(args.password) : null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`Correo invalido: ${email}`);
    process.exit(1);
  }

  if (args.test) {
    if (!password) {
      console.error('Falta --password para probar.');
      process.exit(1);
    }
    const row = db.prepare('SELECT password_hash FROM admins WHERE email = ?').get(email);
    if (!row) {
      console.error(`No existe un administrador con el correo ${email}.`);
      process.exit(1);
    }
    const ok = bcrypt.compareSync(password, row.password_hash);
    console.log(ok ? `OK: la contrasena coincide para ${email}.` : `FALLA: la contrasena NO coincide para ${email}.`);
    process.exit(ok ? 0 : 1);
  }

  if (args.delete) {
    const info = db.prepare('DELETE FROM admins WHERE email = ?').run(email);
    console.log(info.changes ? `Administrador ${email} eliminado.` : `No existia ${email}.`);
    return;
  }

  if (!password) {
    console.error('Falta --password.');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('La contrasena debe tener al menos 6 caracteres.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(email);

  if (existing) {
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    console.log(`Contrasena de ${email} actualizada.`);
  } else {
    db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)').run(
      email,
      hash,
      'Administrador'
    );
    console.log(`Administrador ${email} creado.`);
  }

  console.log(`Verifica con: node server/scripts/admin.js --test --email ${email} --password ******`);
  list();
}

main();
