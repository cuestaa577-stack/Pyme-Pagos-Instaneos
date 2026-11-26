'use strict';
/**
 * Restablece la contraseña del administrador definido en .env.
 * Uso: node server/scripts/reset-admin.js
 */
const bcrypt = require('bcryptjs');
const config = require('../config');
const { db } = require('../db');

const hash = bcrypt.hashSync(config.admin.password, 12);
const existing = db.prepare('SELECT id FROM admins WHERE email = ?').get(config.admin.email);
if (existing) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  console.log(`Contraseña actualizada para ${config.admin.email}`);
} else {
  db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)').run(
    config.admin.email,
    hash,
    'Administrador'
  );
  console.log(`Administrador creado: ${config.admin.email}`);
}
