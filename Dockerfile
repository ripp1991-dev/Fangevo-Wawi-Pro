# Produktions-Images für FangEvo Wawi Pro (Phase 8, siehe OPERATIONS.md)
#
#   docker build --target api     -t fangevo/api .      # API und Worker (gleiches Image, anderer Befehl)
#   docker build --target web     -t fangevo/web .      # Web-Oberfläche (nginx, leitet /api an die API weiter)
#   docker build --target migrate -t fangevo/migrate .  # Datenbank-Migrationen (einmalig je Update)

FROM node:22.21.1-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ── Bauen ──
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate \
 && pnpm --filter @fangevo/api build \
 && pnpm --filter @fangevo/web build
# Nur Laufzeit-Abhängigkeiten der API in /out (Workspace-Pakete sind ins Bundle eingebaut)
RUN pnpm --filter @fangevo/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && SRC=$(ls -d node_modules/.pnpm/@prisma+client@*/node_modules/.prisma) \
 && DST=$(ls -d /out/node_modules/.pnpm/@prisma+client@*/node_modules) \
 && cp -r "$SRC" "$DST/"

# ── Migrationen (enthält die Prisma-Kommandozeile) ──
FROM build AS migrate
WORKDIR /app/packages/database
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ── API / Worker ──
# Distroless: nur Node.js, glibc, OpenSSL 3 und Zertifikate – keine Shell, kein Paketmanager, läuft ohne Root.
FROM gcr.io/distroless/nodejs22-debian12@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /out /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3   CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Worker: gleiches Image mit Befehl ["dist/worker.js"]
CMD ["dist/main.js"]

# ── Web ──
FROM nginx:1.27.5-alpine AS web
COPY infrastructure/production/nginx.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/production/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
