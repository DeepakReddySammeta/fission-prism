# syntax=docker/dockerfile:1

# ---------- build stage ----------
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# VITE_API_URL is baked into the bundle at build time (import.meta.env).
# It must be an address the END USER'S BROWSER can reach — for local
# docker-compose that is the published backend port on the host, i.e.
# http://localhost:8787, NOT http://backend:8787 (which only resolves
# inside the compose network).
ARG VITE_API_URL=http://localhost:8787
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM nginx:1.27-alpine AS runtime

# SPA routing: every unmatched path falls back to index.html.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
