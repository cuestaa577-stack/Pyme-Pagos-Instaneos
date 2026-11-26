# Desplegar RemesaYa en Render (guía paso a paso)

Esta guía explica cómo subir la plataforma a **Render** y qué variables de entorno necesita. La app es un servidor Node.js (Express 5) con SQLite, así que **necesita un disco persistente** para no perder la base de datos en cada despliegue.

---

## 1. Antes de empezar: qué es y qué no es "real"

- **La aplicación es real y funciona.** Es un servidor Node.js completo con base de datos, doble partida contable, cifrado AES-256-GCM de documentos y cuentas, sesiones firmadas, CSRF, rate limiting y webhooks firmados.
- **Los pagos reales dependen de tus credenciales.** La plataforma **no tiene modo demostración**: cada vía opera en vivo si tiene credenciales o, si no, como **cobro manual con comprobante** (el cliente transfiere a tu cuenta, sube el comprobante y tú lo apruebas). Para cobrar automáticamente hay que conectar las pasarelas:
  - **dLocal Go** → tarjetas (Visa/Mastercard/Amex) y SmartFields.
  - **BRE-B** y **PSE** → cobros locales en Colombia.
  - **Proveedor vepay** → Pago Móvil, transferencia y efectivo en Venezuela.
- Mientras no haya llaves de producción, la app cobra por **transferencia manual verificada**: dinero real, sin simulaciones.

---

## 2. Crear el servicio en Render

1. Entra a <https://dashboard.render.com> → **New +** → **Web Service**.
2. Conecta tu repositorio de GitHub (`cuestaa577-stack/Pyme-Pagos-Instaneos`).
3. Configuración:
   - **Name:** `remesaya` (o el que quieras).
   - **Region:** la más cercana a tus usuarios (ej. `Ohio` o `Frankfurt`).
   - **Branch:** `main`.
   - **Root Directory:** `app` ← **importante**, el proyecto está en la subcarpeta `app`.
   - **Runtime:** `Node`.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Starter` o superior (el plan Free duerme y no permite discos persistentes).
4. **Disco persistente** (obligatorio para no perder datos):
   - **Add Disk** → **Name:** `remesaya-data`
   - **Mount Path:** `/var/data`  ← ruta absoluta fuera del código, así el deploy nunca la borra
   - **Size:** 1 GB es suficiente para empezar.
   - Luego define `DATA_DIR=/var/data` (ver 3.1). La base queda en `/var/data/remesaya.db` y los respaldos cifrados en `/var/data/backups/`.

> ⚠️ Si montas el disco en `/opt/render/project/src/app/data` también funciona (es el valor por defecto de `DATA_DIR`), pero `/var/data` es más seguro: Render reemplaza el directorio del proyecto en cada deploy y un disco montado dentro del código puede quedar enmascarado por el nuevo checkout.
5. **Health Check Path:** `/api/health`

---

## 3. Variables de entorno (Environment → Add Environment Variable)

### 3.1 Obligatorias

| Variable | Valor / cómo generarla |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` (Render lo inyecta solo, pero puedes fijarlo) |
| `APP_URL` | `https://TU-SERVICIO.onrender.com` |
| `PUBLIC_BASE_URL` | `https://TU-SERVICIO.onrender.com` (sin `/` final; se usa en webhooks y retornos) |
| `SESSION_SECRET` | Cadena aleatoria larga. Genera con `openssl rand -hex 32` |
| `DATA_ENCRYPTION_KEY` | **Exactamente 64 caracteres hex** (32 bytes). `openssl rand -hex 32` |
| `DOC_PEPPER` | Otro secreto aleatorio largo. `openssl rand -hex 32` |
| `ADMIN_EMAIL` | `cuestaa577@gmail.com` |
| `ADMIN_PASSWORD` | Tu clave de administrador. **Si contiene `#`, ponla entre comillas dobles.** |
| `TRUST_PROXY` | `true` (Render está detrás de proxy) |
| `DATA_DIR` | `/var/data` ← carpeta del disco persistente donde vive la base y los respaldos |
| `DB_FILE` | `remesaya.db` (opcional, nombre del archivo SQLite) |
| `BACKUP_ENCRYPTION_KEY` | **Obligatoria.** 32 bytes en hex (`openssl rand -hex 32`). Cifra los respaldos con AES-256-GCM. **Guárdala fuera de Render**: sin ella ningún respaldo se puede restaurar |
| `BACKUP_INTERVAL_HOURS` | `6` (respaldo cifrado cada 6 h; `0` lo desactiva) |
| `BACKUP_KEEP` | `20` (cuántos respaldos cifrados se conservan antes de rotar) |

> ⚠️ **Regla de oro:** cualquier valor con `#`, espacios o caracteres especiales debe ir **entre comillas dobles** en el panel de Render. Si no, dotenv corta el valor en el `#` (por eso una clave como `NuevaClave123#2026` termina siendo `NuevaClave123`).

### 3.2 dLocal Go (tarjetas)

| Variable | Dónde se obtiene |
|---|---|
| `DLOCALGO_API_URL` | `https://api.dlocalgo.com` (producción) o `https://api-sbx.dlocalgo.com` (sandbox) |
| `DLOCALGO_API_KEY` | Panel de dLocal Go → Developers → API Keys |
| `DLOCALGO_API_SECRET` | Igual que arriba (secreto, solo servidor) |
| `DLOCALGO_WEBHOOK_SECRET` | Panel de dLocal Go → Webhooks |
| `SMARTFIELDS_API_KEY` | Llave **pública** de SmartFields (se usa en el navegador) |
| `SMARTFIELDS_SDK_URL` | `https://checkout.dlocalgo.com/js/dlocalgo-smartfields-bundled.js` (producción) |

Webhook a configurar en dLocal Go: `https://TU-SERVICIO.onrender.com/api/webhooks/dlocalgo`

### 3.3 BRE-B (Colombia, transferencias instantáneas)

| Variable | Valor |
|---|---|
| `BREB_MODE` | `live` (producción), `simulator` o `auto` |
| `BREB_API_URL` | URL de tu proveedor BRE-B |
| `BREB_API_KEY` | Llave del proveedor |
| `BREB_PARTICIPANT_ID` | ID de participante asignado |
| `BREB_MERCHANT_KEY` | Tu llave BRE-B (ej. `@remesaya`) |
| `BREB_CURRENCY` | `COP` |

Webhook: `https://TU-SERVICIO.onrender.com/api/webhooks/breb`

### 3.4 PSE (Colombia, débito bancario)

| Variable | Valor |
|---|---|
| `PSE_MODE` | `live`, `simulator` o `auto` |
| `PSE_API_URL` | URL del agregador PSE |
| `PSE_API_KEY` | Llave del agregador |
| `PSE_MERCHANT_ID` | ID de comercio PSE |

Webhook: `https://TU-SERVICIO.onrender.com/api/webhooks/pse`

### 3.5 Venezuela (Pago Móvil / transferencia / efectivo en VES)

| Variable | Valor |
|---|---|
| `VE_MODE` | `live`, `simulator` o `auto` |
| `VE_API_URL` | URL del agregador venezolano |
| `VE_API_KEY` | Llave del agregador |
| `VE_MERCHANT_NAME` | Nombre del titular (ej. `RemesaYa`) |
| `VE_MERCHANT_DOCUMENT` | RIF o cédula (ej. `J-123456789`) |
| `VE_MERCHANT_PHONE` | Teléfono de Pago Móvil (ej. `04141234567`) |
| `VE_MERCHANT_BANK` | Código de banco (ej. `0134` Banesco) |
| `VE_MERCHANT_ACCOUNT` | Número de cuenta de 20 dígitos |
| `VE_TIMEOUT_MS` | `15000` |

Webhook: `https://TU-SERVICIO.onrender.com/api/webhooks/vepay`

### 3.6 Reglas de negocio (opcionales)

| Variable | Por defecto | Significado |
|---|---|---|
| `FEE_PERCENT` | `3.5` | Comisión porcentual |
| `FEE_FIXED_CENTS` | `50` | Comisión fija en centavos de USD (0,50 USD) |
| `MIN_ORDER_CENTS` | `500` | Orden mínima (5,00 USD) |
| `MAX_ORDER_CENTS` | `500000` | Orden máxima (5.000,00 USD) |
| `DEFAULT_CURRENCY` | `USD` | Moneda base |

Las **tasas de cambio** (VES, COP, CLP, PEN, ARS, MXN, DOP, BRL, EUR) y el **teléfono/horario de soporte** se cambian desde el panel de administración → **Ajustes**, no por variables de entorno.

---

## 4. Primer arranque y acceso de administrador

Al iniciar, el servidor crea la base de datos y siembra el administrador **solo si el correo no existe**. Esto significa que **cambiar `ADMIN_PASSWORD` en Render no actualiza una clave ya creada**.

Para fijar o restablecer la clave del administrador, abre la **Shell** del servicio en Render y ejecuta:

```bash
node server/scripts/reset-admin.js
```

El script lee `ADMIN_EMAIL` y `ADMIN_PASSWORD` del entorno y actualiza (o crea) ese usuario. Después podrás entrar en `https://TU-SERVICIO.onrender.com/admin.html` con:

- **Correo:** `cuestaa577@gmail.com`
- **Clave:** la que tengas en `ADMIN_PASSWORD`

La pantalla de login ya incluye **"Recordarme"** y el **ojo para mostrar/ocultar la contraseña**.

### ¿Por qué "no funcionaba" `Angelo18@`?

Tres causas típicas, en orden de frecuencia:

1. **La base de datos ya tenía un administrador con otra clave.** `seedAdmin()` no sobreescribe. Solución: `node server/scripts/reset-admin.js`.
2. **La clave tenía `#` y no estaba entre comillas.** dotenv truncaba el valor. Solución: `ADMIN_PASSWORD="Angelo18@"` con comillas.
3. **Estabas mirando una base distinta** (local vs. Render, o un disco que se recreó). Verifica que el disco persistente esté montado en `app/data`.

---

## 5. Verificación posterior al despliegue

```bash
curl https://TU-SERVICIO.onrender.com/api/health
# {"ok":true,"app":"RemesaYa","env":"production", ...}

curl https://TU-SERVICIO.onrender.com/api/config
# debe listar countries (11), catalog.methods (40), rates, support, directions
```

Checklist rápido:

- [ ] La home carga con hero, calculadora y las tarjetas de los 11 países.
- [ ] `/recibir` permite elegir Chile y muestra "Recibes CLP …".
- [ ] `/enviar` permite elegir Venezuela y muestra "Envías Bs …".
- [ ] `/admin.html` muestra el ojo de la contraseña y "Recordarme".
- [ ] El login del administrador entra al panel.
- [ ] En **Ajustes** puedes editar tasas, teléfono y habilitar/deshabilitar envío y recepción.

---

## 6. Respaldos cifrados (la base nunca se pierde ni se filtra)

La base SQLite vive en el disco persistente (`DATA_DIR`), así que un deploy **no la borra**. Encima de eso hay tres capas de protección:

**1. Respaldo automático cifrado.** Cada `BACKUP_INTERVAL_HOURS` (y al arrancar) se ejecuta `VACUUM INTO` —una copia consistente aunque haya escrituras en curso— y el resultado se cifra inmediatamente:

| Capa | Detalle |
|---|---|
| Cifrado | **AES-256-GCM** (cifrado autenticado: detecta cualquier alteración) |
| Derivación de clave | **scrypt** con `N=2^15, r=8, p=1` y sal aleatoria de 16 bytes por archivo |
| Nonce | IV aleatorio de 12 bytes por archivo |
| Archivo | `remesaya-<motivo>-<fecha>.db.enc`, permisos `0600` |
| Borrado | El `.db` en claro se sobrescribe con ceros y se elimina al instante |
| Rotación | Se conservan los últimos `BACKUP_KEEP` (20 por defecto) |

El resultado no contiene ni el magic `SQLite format 3` ni texto legible: sin `BACKUP_ENCRYPTION_KEY` es indistinguible de ruido aleatorio. Si alguien cambia un solo byte, la restauración falla con *"unable to authenticate data"*.

**2. Descarga manual desde el panel.** `Admin → Ajustes → Respaldos` lista los archivos y permite descargar uno nuevo ya cifrado (`GET /api/admin/backup`). Guárdalo en tu computadora o en un almacenamiento externo.

**3. Restauración verificada.** El descifrado valida el tag GCM **antes** de tocar la base activa; si la clave es incorrecta, aborta sin dañar nada.

```bash
# crear un respaldo cifrado ahora
node server/scripts/backup.js

# listar
node server/scripts/backup.js --list

# restaurar (valida clave + integridad SQLite)
node server/scripts/backup.js --restore remesaya-manual-20261126-174436.db.enc
```

> ⛔ **Detén el servidor antes de restaurar.** El script lo detecta: escribe un archivo `remesaya.db.lock` con su PID al arrancar y, si sigue vivo, la restauración aborta con *"La base está en uso por el proceso N"*. Esto evita el fallo clásico de aplicar un WAL viejo sobre un archivo nuevo (corrompe la base). En Render: **Suspend Service → Shell → restore → Resume**.

> 🔑 **La clave es el respaldo.** Si pierdes `BACKUP_ENCRYPTION_KEY`, los `.db.enc` son irrecuperables por diseño. Guárdala en un gestor de contraseñas o en un sobre sellado, **nunca** en el mismo repositorio ni en el mismo panel de Render. Para rotarla: descifra con la vieja, vuelve a cifrar con la nueva.

---

## 7. Resistencia a reinicios (que la app nunca se caiga)

Render reinicia el contenedor por deploy, por OOM, por inactividad o por mantenimiento. RemesaYa está preparada para que eso **no** se traduzca en caída ni en pérdida de datos.

**1. Preflight con auto-reparación.** `npm start` ejecuta `server/scripts/preflight.js` antes de levantar Express:

| Situación al arrancar | Qué hace |
|---|---|
| Base íntegra | Arranca normal |
| Bloqueo huérfano de un proceso muerto | Lo elimina |
| Base corrupta | Restaura el respaldo cifrado más reciente que pase verificación |
| Base corrupta y sin respaldos válidos | Aparta la base dañada como `.corrupt-<fecha>` y crea una nueva (servicio vivo, nunca caído) |

**2. Durabilidad de cada transacción.** `PRAGMA synchronous = FULL` + `journal_mode = WAL`: cada commit se sincroniza a disco antes de confirmarse. Probado con `kill -9` (el peor caso, sin cierre limpio): **cero transacciones perdidas**.

**3. Apagado limpio.** Con `exec node server/index.js` en el `startCommand`, la señal `SIGTERM` de Render llega directo a Node. Al recibirla:

```
SIGTERM recibido, cerrando servidor...
[guardian] checkpoint WAL completado
[guardian] base de datos cerrada limpiamente
```

Se hace `wal_checkpoint(TRUNCATE)` y se cierra la base. Render espera hasta `maxShutdownDelaySeconds: 15`.

**4. Contención de fallos.** `server/services/guardian.js` captura `uncaughtException` y `unhandledRejection`, los registra en `<DATA_DIR>/guardian.log` y **sigue sirviendo** en vez de morir. Un error en una petición ya no tumba el proceso completo.

**5. Health check real.** `GET /api/health` no solo dice "vivo": hace `SELECT 1` contra la base y responde **503** si algo está mal, para que Render reinicie limpio en vez de dejar un servicio zombie.

```json
{ "ok": true, "db": "ok", "uptime_seconds": 412, "degraded": false, "recoveries": 0 }
```

**6. Keep-alive.** `KEEPALIVE_MINUTES=10` hace un auto-ping a `/api/ping` cada 10 minutos.

> ⚠️ **El plan Free de Render se duerme a los 15 min de inactividad.** Eso no es un bug de la app: es la política del plan. Para que esté siempre activa necesitas **Starter o superior**. Si te quedas en Free, configura un monitor externo gratuito (UptimeRobot o cron-job.org) apuntando a `https://TU-SERVICIO.onrender.com/api/ping` cada 5 minutos; eso la mantiene despierta la mayor parte del día.

---

## 8. Notas de seguridad

- **Nunca** subas `.env` al repositorio. Ya está en `.gitignore`.
- Rota cualquier token o llave que hayas pegado en un chat público (por ejemplo, un token `ghp_…` de GitHub): revócalo en <https://github.com/settings/tokens>.
- Usa HTTPS (Render lo da gratis) y mantén `TRUST_PROXY=true` para que el rate limiting vea la IP real.
- Los documentos y cuentas se guardan cifrados; si pierdes `DATA_ENCRYPTION_KEY`, los datos existentes **no se pueden descifrar**. Guárdala en un gestor de secretos.

---

## 9. Si el deploy falla con `EACCES: permission denied, mkdir '/var/data'`

Ese error significa una sola cosa: **el disco persistente no está montado en
`/var/data`**, o está montado ahí pero sin permisos de escritura. El proceso de
Render corre como usuario sin privilegios y no puede crear la carpeta.

```
[preflight] no se pudo preparar /var/data: EACCES: permission denied, mkdir '/var/data'
Error: EACCES: permission denied, mkdir '/var/data'
    at Object.mkdirSync (node:fs:1410:26)
    at /opt/render/project/src/server/db.js:8:4
Exited with status 1
```

### Qué hace ahora la app (auto-reparación)

A partir de esta versión, `server/config.js` **prueba varios candidatos** antes de
rendirse y escribe de verdad un archivo de prueba en cada uno:

1. `DATA_DIR` (si lo definiste)
2. `/var/data`
3. `<repo>/data`
4. `<cwd>/data`
5. `<tmp>/remesaya-data`

El primero en el que consigue escribir gana, y deja un aviso en el log:

```
[config] DATA_DIR=/var/data no es escribible; usando /opt/render/project/src/data.
```

Además `server/db.js` ya no revienta: si no puede abrir la base, cae a una base
en memoria y **el servicio queda vivo** en vez de entrar en bucle de reinicio.
Y `server/scripts/preflight.js` convierte el fallo de `mkdir` en un aviso.

> Esto evita la caída, pero **no sustituye al disco persistente**. Una base en
> memoria se borra en cada reinicio. Hay que arreglar el montaje.

### Cómo arreglarlo de verdad

1. Ve a **Render → tu servicio → Disks**.
2. Comprueba el **Mount Path**. Debe ser exactamente `/var/data`.
   Si tu disco está montado en otra ruta (por ejemplo
   `/opt/render/project/src/app/data`), usa esa ruta.
3. Ve a **Environment** y define:

   ```
   DATA_DIR=/var/data
   ```

   (o la ruta real de tu disco).
4. Guarda y haz **Manual Deploy → Clear build cache & deploy**.

Si el disco está en `/var/data` pero sigue dando `EACCES`, es que el disco se
creó antes de cambiar el usuario del servicio. La solución es **borrar el disco y
volver a crearlo** (perderás lo que hubiera dentro; descarga antes un respaldo
desde el panel de administración si aún puedes entrar).

### Comprobar que quedó bien

```bash
curl -s https://TU-SERVICIO.onrender.com/api/health
```

Debe responder `"db":"ok"`. En los logs del arranque verás:

```
Base de datos: /var/data/remesaya.db
```

Si en su lugar ves `Base de datos: /opt/render/project/src/data/remesaya.db`, el
disco no está montado donde crees: corrige el Mount Path.

---

## 10. Despliegue con Docker (alternativa a Render)

Si prefieres no depender de Render, el repositorio incluye `Dockerfile`,
`docker-compose.yml` y `.dockerignore`. La guía completa está en
**[`DOCKER.md`](DOCKER.md)**; aquí va el resumen:

```bash
cd app
cp .env.example .env      # edita las claves
docker compose up -d --build
```

Eso levanta RemesaYa en `http://localhost:3000` con:

- volumen con nombre `remesaya-data` montado en `/data` (la base **no** se
  pierde al reiniciar ni al recrear el contenedor);
- `restart: unless-stopped` (se levanta sola tras un reinicio del host);
- `stop_grace_period: 20s` para que el checkpoint del WAL termine antes del
  `SIGKILL`;
- healthcheck contra `/api/health` cada 30 s;
- usuario `node` sin privilegios y `tini` como PID 1.

Comandos útiles:

```bash
docker compose logs -f                       # logs en vivo
docker compose ps                            # estado + healthcheck
docker exec remesaya node server/scripts/backup.js --list
docker compose down                          # detener conservando datos
```

Ventaja frente a Render: **no hay plan Free que duerma el servicio** y el disco
es tuyo. Desventaja: tienes que gestionar el servidor y el HTTPS (con Caddy, ver
`DOCKER.md` §8).

---

## 11. Errores de Render al guardar variables: "Duplicate key"

Si al pulsar **Save Changes** en *Environment* ves algo como:

```
Duplicate key 'SMARTFIELDS_API_KEY' is not allowed
Duplicate key 'PSE_API_KEY' is not allowed
```

es porque hay **dos filas con la misma clave**. En tu caso una tenía el valor
`CAMBIA` (un marcador de posición) y la otra el valor real. Render no guarda
nada mientras exista el duplicado.

**Solución:** en la lista de variables, borra la fila que tenga `CAMBIA` (el
icono de papelera a la derecha) y deja solo la que tiene el valor real. Repite
con cada clave duplicada y vuelve a pulsar **Save Changes**.

Aprovecha para revisar que no quede ninguna variable con valor `CAMBIA`,
`TU_VALOR_AQUI`, `xxx` o similar: la app arranca igual, pero el proveedor
correspondiente fallará en modo `live`.

---

## 12. Checklist final antes de dar por bueno el deploy

- [ ] El disco está montado en `/var/data` y `DATA_DIR=/var/data`.
- [ ] No hay variables duplicadas ni valores `CAMBIA`.
- [ ] `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY` y
      `DOC_PEPPER` tienen 64 caracteres hexadecimales cada una y están guardadas
      en un gestor de secretos.
- [ ] `APP_URL` es la URL real del servicio (con `https://`).
- [ ] `TRUST_PROXY=true`.
- [ ] `GET /api/health` devuelve `{"ok":true,"db":"ok"}`.
- [ ] Puedes entrar al panel con el usuario administrador.
- [ ] En **Ajustes → Respaldos cifrados** aparece al menos un `.db.enc` y el
      botón de descarga funciona.
- [ ] Has revocado el token `ghp_…` que se pegó en el chat.

---

## 13. "Puse mi correo y contraseña y no me deja entrar como administrador"

Es el problema más reportado y tiene **tres causas posibles**. Ve por orden.

### Causa 1 — Bloqueo por intentos fallidos (la más común)

El login tiene un límite de **10 intentos fallidos cada 10 minutos** por IP. Al
llegar al límite responde `429` y **rechaza incluso la contraseña correcta**:

```json
{"error":"Demasiados intentos fallidos. Espera 10 minuto(s) o reinicia el servicio."}
```

Antes, además, los intentos **mal formados** (contraseña de 2 letras, correo sin
`@`) también gastaban cuota, así que te podías bloquear sin haber probado nada
real. Eso ya está corregido: ahora se valida primero y un login exitoso no
consume cuota.

**Solución:** espera 10 minutos, o reinicia el servicio (Render → Manual Deploy).
El contador vive en memoria y se borra al reiniciar.

### Causa 2 — El administrador se creó con otro correo

`seedAdmin()` solo crea el administrador **la primera vez**, cuando la base está
vacía. Si la base se creó cuando `ADMIN_EMAIL` no estaba definida, el
administrador quedó como `admin@remesaya.app` con la clave
`cambia-esta-clave-ahora`, y poner tu correo después **no cambiaba nada**.

**Comprobación rápida:** intenta entrar con

```
admin@remesaya.app
cambia-esta-clave-ahora
```

Si entras, ese era el problema. Cámbialo de inmediato.

**Solución definitiva:** en Render → **Shell**:

```bash
# ver qué administradores existen y con qué correo
node server/scripts/admin.js --list

# crear o resetear el tuyo
node server/scripts/admin.js --reset \
  --email cuestaa577@gmail.com \
  --password 'Angelo18@'

# comprobar que la clave quedó bien
node server/scripts/admin.js --test \
  --email cuestaa577@gmail.com \
  --password 'Angelo18@'
```

`--list` te dice exactamente qué correos hay y cuándo fue el último acceso. Ese
es el dato que resuelve el 90 % de estos casos.

### Causa 3 — Las variables nunca se guardaron en Render

Si al pulsar **Save Changes** en *Environment* aparecía
`Duplicate key 'SMARTFIELDS_API_KEY' is not allowed` (ver §11), **Render no
guardó nada**, incluidos `ADMIN_EMAIL` y `ADMIN_PASSWORD`. La app arrancó con los
valores por defecto.

**Solución:** borra las filas duplicadas, guarda, y verifica en la Shell:

```bash
node -e "console.log(process.env.ADMIN_EMAIL, '|', process.env.ADMIN_PASSWORD ? 'clave definida' : 'SIN CLAVE')"
```

Si imprime `undefined | SIN CLAVE`, las variables no están llegando.

### Lo que cambió en el código (commit de esta versión)

`server/db.js` ahora **sincroniza la contraseña**: si `ADMIN_PASSWORD` está
definida en el entorno y no coincide con el hash guardado, la actualiza al
arrancar. Es decir, **cambiar `ADMIN_PASSWORD` en Render y redesplegar siempre
funciona**, aunque la base ya existiera.

```
[db] contraseña del administrador actualizada desde ADMIN_PASSWORD (cuestaa577@gmail.com)
```

Y si hay administradores con otros correos, avisa:

```
[db] ATENCIÓN: además de cuestaa577@gmail.com hay otros administradores: admin@remesaya.app.
```

> **Orden de prioridad:** si defines `ADMIN_PASSWORD` en el entorno, esa clave
> manda y sobrescribe cualquier `--reset` que hayas hecho por Shell en el
> siguiente arranque. Para que un `--reset` sea permanente, borra
> `ADMIN_PASSWORD` del entorno o pon allí la misma clave.

### Resumen de comandos del administrador

```bash
node server/scripts/admin.js --list
node server/scripts/admin.js --reset --email X --password Y
node server/scripts/admin.js --add   --email X --password Y
node server/scripts/admin.js --delete --email X
node server/scripts/admin.js --test  --email X --password Y
```

Todos funcionan también en local (`npm run admin` para listar) y dentro de
Docker:

```bash
docker exec remesaya node server/scripts/admin.js --list
```
