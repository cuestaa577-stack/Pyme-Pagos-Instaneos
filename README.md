# RemesaYa — Plataforma de pagos y remesas (100% propia)

Plataforma web de pagos y remesas para venezolanos en el extranjero **y dentro de
Venezuela**. Permite cobrar con tarjeta, PSE, BRE-B, efectivo o Pago Móvil, y
entregar al beneficiario de forma **instantánea** por BRE-B, Pago Móvil o
transferencia bancaria, validando siempre la **cédula de identidad venezolana**.

El propietario es el administrador único: el panel `/admin` concentra métricas,
órdenes, saldos, retiros, pagos a beneficiarios, ajustes, auditoría y webhooks.

---

## 1. Funcionalidades

### Cobros (entrada de dinero)
| Vía | Moneda | Descripción |
| --- | --- | --- |
| Tarjeta (hosted) | USD | Checkout alojado del proveedor (dLocal Go). |
| Tarjeta transparente | USD | SmartFields: el formulario vive en tu propia web. |
| PSE | COP | Débito bancario colombiano (16 bancos). |
| BRE-B | COP | Transferencia instantánea con llave (cédula/teléfono/correo). |
| Efectivo | USD | Pago en corresponsales. |
| **Pago Móvil VE** | **VES** | Cobro desde Venezuela al teléfono/banco del comercio. |
| **Transferencia VE** | **VES** | Cobro a cuenta bancaria venezolana. |
| **Efectivo VE** | **VES** | Cobro en efectivo en Venezuela. |

### Entregas / retiros (salida de dinero)
- **BRE-B** (Colombia) instantáneo.
- **Pago Móvil Venezuela** (VES) instantáneo.
- **Transferencia bancaria Venezuela** (VES).
- **Efectivo Venezuela** (VES).
- **Retiro del comercio** a su propia cuenta (COP o VES) con seguimiento.

### Flujos soportados
- **Internacional → Venezuela**: pagas en USD/COP, el beneficiario recibe VES.
- **Venezuela → Venezuela**: pagas en VES (Pago Móvil/transferencia/efectivo),
  el beneficiario recibe VES. Ideal para remesas y pagos internos.

---

## 2. Arquitectura

```
public/                 Frontend estático (landing, wizard, checkout, admin)
  index.html            Landing + calculadora + formulario
  app.js                Lógica del wizard, checkout y seguimiento
  admin.html/admin.js   Panel de administración
  styles.css            Diseño (dark, responsive, print-friendly)

server/
  index.js              Bootstrap Express 5, helmet, rate-limit, rutas
  config.js             Configuración central desde .env
  db.js                 SQLite (better-sqlite3, WAL) + migraciones
  auth.js               Sesiones firmadas + CSRF para el admin
  lib/
    cedula.js           Validación de cédula venezolana V/E/J/G/P
    crypto.js           AES-256-GCM + HMAC para datos sensibles
    money.js            Aritmética en unidades menores (enteros)
    validate.js         Esquemas zod de entrada
  providers/
    dlocalgo.js         dLocal Go (pagos, refunds, payouts, settlements)
    breb.js             BRE-B Colombia (contrato real + simulador)
    pse.js              PSE Colombia (contrato real + simulador)
    vepay.js            Venezuela VES (Pago Móvil/transferencia/efectivo)
  services/
    ledger.js           Partida doble (débitos = créditos por moneda)
    pricing.js          Comisiones, tasas y conversión
    orders.js           Órdenes, beneficiarios, settlement, auto-entrega
    payouts.js          Pagos a beneficiarios
    withdrawals.js      Retiros del comercio
  routes/
    public.js           API pública (config, quote, orders, validate-document)
    admin.js            API del panel (login, stats, órdenes, saldos, etc.)
    webhooks.js         Webhooks firmados e idempotentes
  scripts/reset-admin.js  Utilidad para restablecer credenciales

test/e2e.js             Pruebas end-to-end (32 verificaciones)
```

### Contabilidad (partida doble)
Cada operación genera asientos que **cuadran a cero por moneda**:

- `provider_clearing` — fondos en poder del proveedor.
- `merchant_available` — saldo disponible del comercio.
- `merchant_pending` — saldo en proceso.
- `fee_income` — comisiones acumuladas.
- `payouts_out` — pagos a beneficiarios.
- `withdrawals_out` — retiros del comercio.
- `customer_float` — saldo de clientes.

En órdenes con conversión (ej. cobro USD → pago VES) se registra la posición FX
en `provider_clearing`, de modo que cada divisa sigue cuadrando.

---

## 3. Seguridad

- **Cédula y datos bancarios cifrados** en reposo con AES-256-GCM.
- **Búsqueda determinista** por HMAC-SHA256 (`DOC_PEPPER`) sin exponer el dato.
- **Enmascarado** de últimos 4 dígitos en respuestas.
- **Sesiones del admin** con cookie firmada (`HttpOnly`, `SameSite=Lax`) y
  **CSRF** obligatorio (`x-csrf-token`) en toda escritura.
- **Rate limiting** en login y endpoints sensibles.
- **Helmet** con CSP y cabeceras seguras.
- **Webhooks** verificados con HMAC-SHA256 e **idempotentes** por id de evento.
- Secretos **solo en el backend** (`.env` nunca se sirve al navegador).

> ⚠️ **Nunca subas el archivo `.env` real a GitHub.** El repositorio incluye
> `.env.example` con valores de ejemplo. Las claves reales viven solo en el
> servidor.

---

## 4. Puesta en marcha

```bash
# 1. Dependencias
npm install

# 2. Configuración
cp .env.example .env
# edita .env con tus claves reales

# 3. Servidor
npm start          # http://localhost:3000
npm run dev        # con recarga automática

# 4. Pruebas end-to-end (con el servidor corriendo)
npm test
```

### Variables de entorno principales
| Variable | Descripción |
| --- | --- |
| `PORT` | Puerto HTTP (3000 por defecto). |
| `PUBLIC_BASE_URL` | URL pública para webhooks y retornos. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credenciales del propietario. |
| `SESSION_SECRET` | Firma de cookies de sesión. |
| `DATA_ENCRYPTION_KEY` | Clave AES-256 (64 hex). |
| `DOC_PEPPER` | Pepper HMAC para cédulas. |
| `DLOCAL_API_KEY` / `DLOCAL_SECRET_KEY` | Credenciales dLocal Go. |
| `SMARTFIELDS_API_KEY` | Tarjeta transparente. |
| `DEMO_FALLBACK` | `true` = modo demo si las claves fallan. |
| `BREB_MODE` / `BREB_API_URL` / `BREB_API_KEY` | BRE-B Colombia. |
| `PSE_MODE` / `PSE_API_URL` / `PSE_API_KEY` | PSE Colombia. |
| `VE_MODE` / `VE_API_URL` / `VE_API_KEY` | Venezuela VES. |
| `VE_MERCHANT_*` | Datos del comercio para Pago Móvil/transferencia. |
| `FEE_PERCENT` / `FEE_FIXED_CENTS` | Comisión. |
| `VES_RATE` / `COP_RATE` | Tasas de conversión. |

Cada proveedor (`BRE-B`, `PSE`, `VE`) funciona en tres modos:
`live` (contrato real), `simulator` (pruebas) y `auto` (usa live si hay claves,
si no simulador).

---

## 5. Modo demostración

Las credenciales de dLocal Go entregadas inicialmente responden
`403 Invalid Credentials`. Con `DEMO_FALLBACK=true` la plataforma **sigue
operando en modo demostración**: crea órdenes, aprueba pagos y ejecuta entregas
instantáneas simuladas, de modo que todo el flujo es verificable de punta a punta.

Para pasar a **producción real** basta con colocar claves válidas en `.env`; no
se requiere cambiar código. El modo demo se desactiva con `DEMO_FALLBACK=false`.

---

## 6. Lista de verificación para salir a producción

1. **dLocal Go**: claves válidas + webhook apuntando a
   `https://TU_DOMINIO/api/webhooks/dlocalgo`.
2. **BRE-B**: convenio de participante y llaves reales; configurar
   `BREB_MODE=live` y `BREB_API_URL`.
3. **PSE**: convenio con agregador, `PSE_MODE=live` y credenciales.
4. **Venezuela (Pago Móvil/transferencia)**: proveedor de recaudo/pago VES,
   `VE_MODE=live`, `VE_API_URL`, `VE_API_KEY` y datos del comercio
   (`VE_MERCHANT_*`).
5. **KYC**: integrar proveedor de verificación de identidad si se opera a escala.
6. **Tasas**: conectar fuente automática de tasa VES/COP (hoy configurable).
7. **HTTPS** obligatorio y `PUBLIC_BASE_URL` con el dominio final.
8. **Respaldo** periódico de `data/remesaya.db` y rotación de secretos.
9. **Monitoreo** de webhooks y alertas de payouts fallidos.

---

## 7. API (resumen)

Público:
- `GET /api/health`
- `GET /api/config` — métodos, rieles, bancos VE, tasas.
- `POST /api/quote` — cotización con comisión y conversión.
- `POST /api/orders` — crea orden y devuelve `checkout_url`.
- `GET /api/orders/:id` — seguimiento.
- `POST /api/orders/:id/demo-approve` — aprueba en modo demo.
- `POST /api/validate-document` — valida cédula venezolana.

Admin (sesión + CSRF):
- `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`
- `GET /api/admin/stats`, `/orders`, `/balance`, `/ledger`, `/withdrawals`,
  `/payouts`, `/beneficiaries`, `/settings`, `/audit`, `/webhooks`, `/rates`
- `POST /api/admin/orders/:id/refund`
- `POST /api/admin/withdrawals`, `/payouts`, `/payouts/dlocal`, `/fees/sweep`
- `PUT /api/admin/settings`

Webhooks:
- `POST /api/webhooks/dlocalgo`
- `POST /api/webhooks/breb`
- `POST /api/webhooks/pse`
- `POST /api/webhooks/vepay`

---

## 8. Acceso del administrador

- URL: `/admin`
- Correo y contraseña definidos en `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`).
- Para restablecer: `node server/scripts/reset-admin.js`.

---

## 9. Pruebas

`npm test` ejecuta 32 verificaciones: salud/config, cotización internacional,
orden con tarjeta, orden desde Venezuela, administración, retiro VES y seguridad
(CSRF + cédula inválida).

```
Resultado: 32 ok, 0 fallos
```

---

## 10. Documentación

| Documento | Para qué sirve |
|---|---|
| [`DEPLOY-RENDER.md`](DEPLOY-RENDER.md) | Desplegar en Render paso a paso, variables, respaldos cifrados, resistencia a reinicios y solución al error `EACCES /var/data` |
| [`VARIABLES-RENDER.md`](VARIABLES-RENDER.md) | Bloque `.env` listo para copiar y pegar, las 6 variables imprescindibles y tabla de errores |
| [`DOCKER.md`](DOCKER.md) | Correr la app en Docker / Docker Compose, volumen persistente, HTTPS con Caddy, respaldos dentro del contenedor |
| [`APK.md`](APK.md) | Instalar como app (PWA) en Android, iPhone y escritorio; generar el APK con Bubblewrap, PWABuilder o Capacitor |
| [`render.yaml`](render.yaml) | Blueprint de Render (servicio + disco + variables) |

---

© RemesaYa — plataforma de propiedad del titular del repositorio.
