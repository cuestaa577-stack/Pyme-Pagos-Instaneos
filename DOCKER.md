# RemesaYa en Docker

Guía para correr RemesaYa en un contenedor: en tu portátil, en un VPS, en un
servidor propio o en cualquier nube que acepte imágenes Docker. Es la misma
aplicación que en Render, pero con **tu propio disco**, **tu propio dominio** y
**sin que nadie te duerma el servicio**.

---

## 1. Qué incluye la imagen

| Pieza | Detalle |
|---|---|
| Base | `node:22-bookworm-slim` (Debian 12, Node 22 LTS) |
| Build | Multi-stage: las herramientas de compilación (`python3`, `make`, `g++`) se usan solo en la etapa `deps` y **no** llegan a la imagen final |
| `better-sqlite3` | Se compila dentro de la imagen para la arquitectura correcta (x86_64 o ARM64) |
| Usuario | `node` (UID 1000), **sin privilegios de root** |
| PID 1 | `tini`, que reenvía `SIGTERM` a Node para que se ejecute el `wal_checkpoint(TRUNCATE)` y no se pierda ni una transacción |
| Datos | `VOLUME ["/data"]` con `DATA_DIR=/data` — fuera de la capa de la imagen |
| Healthcheck | `curl -fsS http://127.0.0.1:3000/api/health` cada 30 s (verifica también la base) |
| Tamaño aproximado | ~180–220 MB |

El arranque del contenedor ejecuta, igual que en Render:

```
node server/scripts/preflight.js && exec node server/index.js
```

Es decir: primero repara/restaura la base si hace falta, después levanta Express.
Si la base estuviera corrupta, restaura el respaldo cifrado más reciente; si no
hubiera respaldos válidos, aparta la base dañada y crea una nueva. **El
contenedor nunca se queda en bucle de reinicio por culpa de la base.**

---

## 2. Construir la imagen

Desde la carpeta `app/` (donde está el `Dockerfile`):

```bash
docker build -t remesaya:latest .
```

Si estás en un Mac con chip Apple Silicon y vas a desplegar en un servidor
x86_64, compila para esa plataforma:

```bash
docker build --platform linux/amd64 -t remesaya:latest .
```

> La primera construcción tarda unos minutos porque compila `better-sqlite3`.
> Las siguientes son casi instantáneas gracias a la caché de capas.

---

## 3. Variables de entorno

La imagen **no** lleva secretos dentro. Se los pasas al arrancar. Lo mínimo
imprescindible:

```bash
# Obligatorias en producción
NODE_ENV=production
PORT=3000
DATA_DIR=/data
DB_FILE=remesaya.db

# Seguridad (genera cada una con: openssl rand -hex 32)
SESSION_SECRET=<64 hex>
DATA_ENCRYPTION_KEY=<64 hex>
BACKUP_ENCRYPTION_KEY=<64 hex>
DOC_PEPPER=<64 hex>

# Administrador inicial
ADMIN_EMAIL=cuestaa577@gmail.com
ADMIN_PASSWORD=Angelo18@
ADMIN_NAME=Administrador

# URL pública (para enlaces y cookies)
APP_URL=https://tu-dominio.com
TRUST_PROXY=true
```

Tienes la lista completa y comentada en **`VARIABLES-RENDER.md`** (sirve igual
para Docker) y una plantilla en **`.env.example`**.

### Opción A — con `--env-file` (recomendado)

```bash
cp .env.example .env
# edita .env con tus valores reales
docker run -d \
  --name remesaya \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -e DATA_DIR=/data \
  -v remesaya-data:/data \
  remesaya:latest
```

### Opción B — variables sueltas

```bash
docker run -d --name remesaya --restart unless-stopped -p 3000:3000 \
  -e NODE_ENV=production -e PORT=3000 -e DATA_DIR=/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e DATA_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e BACKUP_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  -e DOC_PEPPER="$(openssl rand -hex 32)" \
  -e ADMIN_EMAIL="cuestaa577@gmail.com" \
  -e ADMIN_PASSWORD="Angelo18@" \
  -e APP_URL="http://localhost:3000" \
  -v remesaya-data:/data \
  remesaya:latest
```

> ⚠️ **Guarda las cuatro claves** (`SESSION_SECRET`, `DATA_ENCRYPTION_KEY`,
> `BACKUP_ENCRYPTION_KEY`, `DOC_PEPPER`) en un gestor de secretos. Si pierdes
> `DATA_ENCRYPTION_KEY`, los datos cifrados existentes **no se pueden
> descifrar**. Si pierdes `BACKUP_ENCRYPTION_KEY`, los respaldos `.db.enc`
> **no se pueden restaurar**.

---

## 4. Con Docker Compose (lo más cómodo)

Ya viene un `docker-compose.yml` listo. Solo tienes que crear el `.env`:

```bash
cp .env.example .env
# edita .env
docker compose up -d --build
```

Ver logs en vivo:

```bash
docker compose logs -f
```

Ver el estado y el healthcheck:

```bash
docker compose ps
```

Detener **sin borrar datos**:

```bash
docker compose down          # el volumen remesaya-data se conserva
```

Detener **borrando todo** (¡solo en pruebas!):

```bash
docker compose down -v       # ⚠️ elimina el volumen y con él la base
```

Actualizar a una versión nueva del código:

```bash
git pull
docker compose up -d --build
```

Compose recrea el contenedor pero **reutiliza el mismo volumen**, así que la base
y los respaldos siguen ahí.

---

## 5. Dónde viven los datos y por qué no se pierden

Todo lo persistente está en el volumen `/data`:

```
/data/
├── remesaya.db              # base SQLite (WAL)
├── remesaya.db-wal          # write-ahead log
├── remesaya.db-shm          # memoria compartida
├── remesaya.db.lock         # PID del proceso que tiene la base abierta
├── guardian.log             # registro de incidentes y checkpoints
└── backups/
    ├── remesaya-2026-11-26T18-00-00.db.enc
    ├── remesaya-startup-2026-11-26T18-35-12.db.enc
    └── ...
```

Los respaldos son **AES-256-GCM** con derivación de clave **scrypt
(N=2^15, r=8, p=1)**, cabecera mágica `RYBK` + versión, sal de 16 bytes, IV de
12 bytes y etiqueta de autenticación de 16 bytes. El archivo `.db` en claro se
sobrescribe con ceros y se borra después de cifrar. Un solo byte alterado hace
que la restauración falle con *"Unsupported state or unable to authenticate
data"*: es imposible restaurar un respaldo manipulado.

Con `restart: unless-stopped` (o `--restart unless-stopped`) el contenedor se
levanta solo tras un reinicio del host, un `docker restart`, un OOM kill o un
corte de luz.

### Copiar el volumen a otro servidor

```bash
# 1) En el servidor viejo: empaquetar el volumen
docker run --rm -v remesaya-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/remesaya-volume.tgz -C /data .

# 2) Copiar el archivo al servidor nuevo
scp remesaya-volume.tgz usuario@servidor-nuevo:/tmp/

# 3) En el servidor nuevo: crear el volumen y restaurar
docker volume create remesaya-data
docker run --rm -v remesaya-data:/data -v /tmp:/backup alpine \
  tar xzf /backup/remesaya-volume.tgz -C /data
```

---

## 6. Respaldos y restauración dentro del contenedor

El CLI de respaldos está incluido en la imagen:

```bash
# crear un respaldo cifrado ahora
docker exec remesaya node server/scripts/backup.js

# listar los respaldos existentes
docker exec remesaya node server/scripts/backup.js --list

# restaurar uno concreto (detén el contenedor antes)
docker stop remesaya
docker run --rm -v remesaya-data:/data --env-file .env remesaya:latest \
  node server/scripts/backup.js --restore remesaya-2026-11-26T18-00-00.db.enc
docker start remesaya
```

También puedes descargar el respaldo desde el panel de administración
(**Ajustes → Respaldos cifrados → Descargar respaldo cifrado**), que entrega el
`.db.enc` con la cabecera `X-Backup-Encryption: AES-256-GCM`.

Los respaldos automáticos corren cada `BACKUP_INTERVAL_HOURS` (6 por defecto) y
se conservan los últimos `BACKUP_KEEP` (20 por defecto).

---

## 7. Comprobar que está sano

```bash
curl -s http://localhost:3000/api/health | python3 -m json.tool
```

Respuesta esperada:

```json
{
  "ok": true,
  "app": "RemesaYa",
  "env": "production",
  "db": "ok",
  "uptime_seconds": 412,
  "degraded": false,
  "recoveries": 0
}
```

Si `ok` es `false` o el código HTTP es `503`, el healthcheck de Docker marca el
contenedor como `unhealthy` y puedes ver el motivo en:

```bash
docker inspect --format '{{json .State.Health}}' remesaya | python3 -m json.tool
docker logs --tail 100 remesaya
```

---

## 8. HTTPS en producción (recomendado)

La imagen sirve HTTP en el puerto 3000. Para HTTPS usa un proxy delante. La
forma más rápida es **Caddy**, que gestiona los certificados solo:

```yaml
# docker-compose.prod.yml
services:
  remesaya:
    image: remesaya:latest
    restart: unless-stopped
    env_file: [.env]
    environment:
      DATA_DIR: /data
      TRUST_PROXY: "true"
      APP_URL: https://remesaya.tudominio.com
    volumes:
      - remesaya-data:/data
    expose: ["3000"]

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [remesaya]

volumes:
  remesaya-data:
  caddy-data:
  caddy-config:
```

`Caddyfile`:

```
remesaya.tudominio.com {
    reverse_proxy remesaya:3000
}
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

Recuerda poner `APP_URL=https://remesaya.tudominio.com` y `TRUST_PROXY=true`
para que el rate limiting vea la IP real del cliente.

---

## 9. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `EACCES: permission denied, mkdir '/data'` | Montaste un directorio del host sin permisos para UID 1000 | `sudo chown -R 1000:1000 /ruta/host` o usa un volumen con nombre (`-v remesaya-data:/data`) |
| `unhealthy` desde el primer minuto | La base no abre o el preflight falló | `docker logs remesaya`; revisa que `BACKUP_ENCRYPTION_KEY` sea la misma con la que se cifraron los respaldos |
| El contenedor reinicia en bucle | `ADMIN_PASSWORD` demasiado corta o falta una clave obligatoria | Revisa los logs; el mensaje dice exactamente qué variable falta |
| `Unsupported state or unable to authenticate data` al restaurar | `BACKUP_ENCRYPTION_KEY` distinta o archivo manipulado | Usa la clave original; si no la tienes, el respaldo es irrecuperable (por diseño) |
| Datos "desaparecen" tras `docker compose down` | Usaste `down -v` | Ese flag borra el volumen. Usa `down` a secas |
| `better-sqlite3` falla al cargar | Compilaste para otra arquitectura | Reconstruye con `--platform linux/amd64` (o `linux/arm64`) |

---

## 10. Diferencias con Render

| | Render | Docker |
|---|---|---|
| Disco persistente | Disco de Render montado en `/var/data` (de pago) | Volumen `/data` (gratis, tuyo) |
| Servicio siempre activo | Solo con plan Starter o superior | Sí, `restart: unless-stopped` |
| HTTPS | Automático | Con Caddy/Nginx/Traefik delante |
| Escalado | Vertical/horizontal desde el panel | Tú decides (varios contenedores + volumen compartido no es trivial con SQLite) |
| Coste | Por plan | Solo el servidor |

> **Nota sobre SQLite y varios contenedores:** SQLite con WAL funciona
> perfectamente con **un** proceso escribiendo. Si algún día necesitas varias
> réplicas, hay que migrar a PostgreSQL. Para una PyME con un solo servidor,
> SQLite es más rápido, más simple y más barato.

---

## 11. Resumen de comandos

```bash
# construir
docker build -t remesaya:latest .

# arrancar (volumen con nombre, sobrevive reinicios)
docker run -d --name remesaya --restart unless-stopped -p 3000:3000 \
  --env-file .env -e DATA_DIR=/data -v remesaya-data:/data remesaya:latest

# o con compose
docker compose up -d --build

# ver logs / estado
docker logs -f remesaya
docker compose ps

# respaldos
docker exec remesaya node server/scripts/backup.js
docker exec remesaya node server/scripts/backup.js --list

# salud
curl -s http://localhost:3000/api/health

# actualizar
git pull && docker compose up -d --build

# detener conservando datos
docker compose down
```
