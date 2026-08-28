# syntax=docker/dockerfile:1

# ---------- build stage ----------
# Debian-based (not alpine): better-sqlite3 is a native module and its
# prebuilt binaries / node-gyp fallback are far more reliable against glibc.
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Toolchain for better-sqlite3's node-gyp fallback when no prebuilt binary
# matches. Harmless if the prebuilt is used — this stage is thrown away.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install deps first so this layer is cached until the lockfile changes.
# NODE_ENV is deliberately NOT set to production here — the build needs the
# devDependencies (typescript / tsc).
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript -> dist/, then drop devDependencies from node_modules.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=/data/data.db

WORKDIR /app

# Only the compiled output + production node_modules come across.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# /data is where the SQLite file lives; a volume gets mounted here.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787
CMD ["node", "dist/server.js"]
