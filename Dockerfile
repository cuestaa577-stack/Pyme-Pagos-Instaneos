# syntax=docker/dockerfile:1
###############################################################################
# RemesaYa — imagen de producción
#
# Características:
#  - Multi-stage: las herramientas de compilación no llegan a la imagen final.
#  - better-sqlite3 se compila para la plataforma correcta.
#  - Usuario sin privilegios (no root).
#  - tini como PID 1: reenvía SIGTERM para que el checkpoint del WAL se ejecute
#    y no se pierda ni una transacción al reiniciar el contenedor.
#  - Healthcheck contra /api/health (que además verifica la base).
###############################################################################

# ---------- Etapa 1: dependencias ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Herramientas para compilar módulos nativos (better-sqlite3).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ---------- Etapa 2: imagen final ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DB_FILE=remesaya.db \
    TZ=UTC

# tini = PID 1 correcto (señales + zombies). curl para el healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && chown -R node:node /data /app

# Código y dependencias ya compiladas.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public

# La carpeta de datos es un volumen: sobrevive a `docker restart`, `docker
# compose down/up` y a recrear el contenedor con la misma imagen.
VOLUME ["/data"]

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

# tini reenvía SIGTERM a node → guardian hace wal_checkpoint(TRUNCATE).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node server/scripts/preflight.js && exec node server/index.js"]
