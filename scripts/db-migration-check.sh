#!/usr/bin/env bash
# Migrations-Probe (Phase 8, siehe OPERATIONS.md).
#
#   MIGRATE_ADMIN_URL=postgresql://fangevo_owner:...@localhost:5432/postgres scripts/db-migration-check.sh
#
# 1. legt eine NEUE, leere Datenbank fangevo_migrationcheck_<zeit> an (Rolle braucht CREATEDB)
# 2. spielt alle Migrationen von Anfang an ein (wie bei einer Neuinstallation)
# 3. prüft, dass das Ergebnis exakt dem Prisma-Schema entspricht (keine Abweichung / kein „Drift“)
# 4. prüft, dass ein zweites Einspielen nichts mehr tut (idempotent)
# Entfernt danach NUR die temporäre Datenbank. Bestehende Datenbanken werden nicht verändert.
set -euo pipefail

: "${MIGRATE_ADMIN_URL:?MIGRATE_ADMIN_URL fehlt (Rolle mit CREATEDB, z. B. fangevo_owner)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="fangevo_migrationcheck_$(date -u +%Y%m%d%H%M%S)"
URL="$(echo "$MIGRATE_ADMIN_URL" | sed -E "s#/[^/?]*(\?|$)#/$DB\1#")"
SCHEMA="$ROOT/packages/database/prisma/schema.prisma"

psql "$MIGRATE_ADMIN_URL" -v ON_ERROR_STOP=1 -qAtc "CREATE DATABASE \"$DB\""
cleanup() {
  case "$DB" in
    fangevo_migrationcheck_*) psql "$MIGRATE_ADMIN_URL" -qAtc "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null ;;
  esac
}
trap cleanup EXIT

cd "$ROOT/packages/database"
DATABASE_URL="$URL" DATABASE_MIGRATE_URL="$URL" pnpm exec prisma migrate deploy --schema "$SCHEMA" > /tmp/"$DB".log 2>&1 \
  || { cat /tmp/"$DB".log; echo "FEHLER: Migrationen schlagen auf leerer Datenbank fehl" >&2; exit 1; }
echo "✓ $(ls -d prisma/migrations/*/ | wc -l) Migrationen auf leerer Datenbank eingespielt"

if ! DATABASE_URL="$URL" DATABASE_MIGRATE_URL="$URL" pnpm exec prisma migrate diff --from-url "$URL" --to-schema-datamodel "$SCHEMA" --exit-code > /tmp/"$DB".diff 2>&1; then
  cat /tmp/"$DB".diff
  echo "FEHLER: Datenbank nach Migrationen weicht vom Prisma-Schema ab (fehlende Migration?)" >&2
  exit 1
fi
echo "✓ Datenbank entspricht dem Prisma-Schema"

DATABASE_URL="$URL" DATABASE_MIGRATE_URL="$URL" pnpm exec prisma migrate deploy --schema "$SCHEMA" 2>&1 | grep -q "No pending migrations" \
  || { echo "FEHLER: zweites Einspielen hat noch Migrationen gefunden" >&2; exit 1; }
echo "✓ erneutes Einspielen ohne Änderungen"
rm -f /tmp/"$DB".log /tmp/"$DB".diff
echo "Migrations-Probe erfolgreich."
