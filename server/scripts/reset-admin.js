'use strict';
/**
 * Compatibilidad: restablece la contraseña del administrador definido en el
 * entorno (ADMIN_EMAIL / ADMIN_PASSWORD).
 *
 * Se mantiene por si alguien ya tenía este comando en un script o en la
 * documentación. Internamente delega en admin.js, que es la única fuente de
 * verdad, para que ambos hagan exactamente lo mismo.
 *
 * Uso: node server/scripts/reset-admin.js
 * Equivale a:
 *   node server/scripts/admin.js --reset --email $ADMIN_EMAIL --password $ADMIN_PASSWORD
 */
const path = require('path');
const { spawnSync } = require('child_process');

const config = require('../config');

if (!process.env.ADMIN_PASSWORD) {
  console.error(
    'ADMIN_PASSWORD no está definida. Define esa variable o usa directamente:\n' +
      '  node server/scripts/admin.js --reset --email TU_CORREO --password TU_CLAVE'
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    path.join(__dirname, 'admin.js'),
    '--reset',
    '--email',
    config.admin.email,
    '--password',
    config.admin.password,
  ],
  { stdio: 'inherit' }
);

process.exit(result.status === null ? 1 : result.status);
