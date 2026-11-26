# Variables de entorno para Render — copiar y pegar

Render permite pegar un bloque completo: **Environment → Add from .env** → pega el contenido de abajo → **Save Changes**.

Reemplaza solo lo que dice `CAMBIA…`. Todo lo demás déjalo igual.

```dotenv
# ---------- Núcleo ----------
NODE_ENV=production
PORT=10000
APP_URL=https://CAMBIA-TU-SERVICIO.onrender.com
PUBLIC_BASE_URL=https://CAMBIA-TU-SERVICIO.onrender.com
TRUST_PROXY=true

# ---------- Base de datos persistente (NO tocar) ----------
DATA_DIR=/var/data
DB_FILE=remesaya.db

# ---------- Secretos (genera cada uno con: openssl rand -hex 32) ----------
SESSION_SECRET=CAMBIA_64_HEX
DATA_ENCRYPTION_KEY=CAMBIA_64_HEX
BACKUP_ENCRYPTION_KEY=CAMBIA_64_HEX_DISTINTA
DOC_PEPPER=CAMBIA_64_HEX

# ---------- Administrador ----------
ADMIN_EMAIL=cuestaa577@gmail.com
ADMIN_PASSWORD="Angelo18@"

# ---------- Respaldos cifrados ----------
BACKUP_INTERVAL_HOURS=6
BACKUP_KEEP=20

# ---------- Disponibilidad ----------
KEEPALIVE_MINUTES=10

# ---------- Modo de operación ----------

# ---------- dLocal Go (tarjetas) ----------
DLOCALGO_API_URL=https://api.dlocalgo.com
DLOCALGO_API_KEY=CAMBIA
DLOCALGO_API_SECRET=CAMBIA
DLOCALGO_WEBHOOK_SECRET=CAMBIA
SMARTFIELDS_API_KEY=CAMBIA
SMARTFIELDS_SDK_URL=https://checkout.dlocalgo.com/js/dlocalgo-smartfields-bundled.js

# ---------- BRE-B (Colombia) ----------
BREB_MODE=live
BREB_API_URL=CAMBIA
BREB_API_KEY=CAMBIA
BREB_PARTICIPANT_ID=CAMBIA
BREB_MERCHANT_KEY=@remesaya
BREB_CURRENCY=COP

# ---------- PSE (Colombia) ----------
PSE_MODE=live
PSE_API_URL=CAMBIA
PSE_API_KEY=CAMBIA
PSE_MERCHANT_ID=CAMBIA

# ---------- Venezuela (Pago Móvil / transferencia / efectivo) ----------
VE_MODE=live
VE_API_URL=CAMBIA
VE_API_KEY=CAMBIA
VE_MERCHANT_NAME=RemesaYa
VE_MERCHANT_DOCUMENT=CAMBIA
VE_MERCHANT_PHONE=CAMBIA
VE_MERCHANT_BANK=CAMBIA
VE_MERCHANT_ACCOUNT=CAMBIA
```

---

## Las 6 que son obligatorias sí o sí

Si solo puedes poner seis, pon estas. Sin ellas la app no arranca bien o pierde datos:

| Variable | Por qué |
|---|---|
| `DATA_DIR=/var/data` | Apunta al disco persistente. Sin esto, cada deploy borra la base. |
| `SESSION_SECRET` | Firma las cookies de sesión. Si cambia, todos pierden la sesión. |
| `DATA_ENCRYPTION_KEY` | Cifra cédulas y cuentas bancarias en la base. Si cambia, esos datos quedan ilegibles. |
| `BACKUP_ENCRYPTION_KEY` | Cifra los respaldos. **Si la pierdes, los respaldos son irrecuperables.** |
| `DOC_PEPPER` | Hash de documentos para búsquedas. Si cambia, no se encuentran clientes existentes. |
| `ADMIN_PASSWORD` | Clave del panel. Si tiene `#`, va entre comillas dobles. |

---

## Cómo generar los secretos

```bash
openssl rand -hex 32
```

Ejecútalo cuatro veces y pega cada resultado en su variable. **Guarda `BACKUP_ENCRYPTION_KEY` en un gestor de contraseñas**: es la única llave que abre los respaldos.

---

## Errores típicos

| Síntoma | Causa |
|---|---|
| La base se vacía en cada deploy | Falta `DATA_DIR` o el disco no está montado en `/var/data` |
| "Invalid username or token" al entrar al panel | `ADMIN_PASSWORD` con `#` sin comillas, o el admin ya existía con otra clave |
| Todos los usuarios pierden la sesión al desplegar | `SESSION_SECRET` cambió (usa `generateValue` o fíjalo) |
| Los datos de clientes salen vacíos | `DATA_ENCRYPTION_KEY` cambió |
| `[backup] falló el respaldo: BACKUP_ENCRYPTION_KEY no está definida` | Falta la variable (en producción es obligatoria) |
| La app "se cae" cada 15 min | Plan Free de Render: se duerme. Sube a Starter y activa `KEEPALIVE_MINUTES` |
