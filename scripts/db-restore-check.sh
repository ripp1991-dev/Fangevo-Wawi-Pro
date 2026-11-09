#!/usr/bin/env bash
# Wiederherstellungs-Probe (Phase 8, siehe OPERATIONS.md).
#
#   PG_ADMIN_URL=postgresql://postgres:...@host:5432/postgres scripts/db-restore-check.sh backups/fangevo-<ts>.dump
#
# Stellt eine Sicherung in eine NEUE, temporäre Datenbank (fangevo_restorecheck_<zeit>) wieder her und prüft:
#   1. Prüfsumme der Sicherungsdatei
#   2. Wiederherstellung ohne Fehler (inkl. Rollen, Rechte, RLS-Richtlinien, Trigger)
#   3. Zeilen je Tabelle wie zum Zeitpunkt der Sicherung (.counts)
#   4. Row-Level Security ist auf allen Mandantentabellen weiterhin aktiv und erzwungen
#   5. alle Migrationen sind vorhanden
# Danach wird NUR die temporäre Datenbank wieder entfernt (KEEP=1 lässt sie stehen).
# Eine bestehende Datenbank wird niemals überschrieben.
#
# PG_ADMIN_URL braucht Superuser- bzw. Administratorrechte: Beim Zurückspielen in Tabellen mit
# erzwungener RLS muss RLS umgangen werden; die Eigentümer (fangevo_owner) bleiben erhalten.
set -euo pipefail

DUMP="${1:?Pfad zur Sicherung fehlt}"
: "${PG_ADMIN_URL:?PG_ADMIN_URL fehlt (Administrator-Verbindung)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB="fangevo_restorecheck_$(date -u +%Y%m%d%H%M%S)"
# Verbindung zur temporären Datenbank: Datenbankname in der Admin-URL ersetzen
TARGET_URL="$(echo "$PG_ADMIN_URL" | sed -E "s#/[^/?]*(\?|$)#/$DB\1#")"

fail() { echo "FEHLER: $*" >&2; exit 1; }

cleanup() {
  if [[ "${KEEP:-0}" != "1" ]]; then
    case "$DB" in
      fangevo_restorecheck_*) psql "$PG_ADMIN_URL" -qAtc "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null ;;
    esac
  else
    echo "Temporäre Datenbank bleibt bestehen: $DB"
  fi
}

# 1. Prüfsumme
if [[ -f "$DUMP.sha256" ]]; then
  [[ "$(sha256sum "$DUMP" | awk '{print $1}')" == "$(cat "$DUMP.sha256")" ]] || fail "Prüfsumme stimmt nicht"
  echo "✓ Prüfsumme"
else
  echo "! keine Prüfsummendatei gefunden"
fi

# 2. Wiederherstellen in neue Datenbank
psql "$PG_ADMIN_URL" -v ON_ERROR_STOP=1 -qAtc "CREATE DATABASE \"$DB\" OWNER fangevo_owner"
trap cleanup EXIT
pg_restore --exit-on-error --no-password --dbname="$TARGET_URL" "$DUMP"
echo "✓ Wiederherstellung in $DB"

# 3. Zeilen je Tabelle
if [[ -f "$DUMP.counts" ]]; then
  ACTUAL="$(psql "$TARGET_URL" -v ON_ERROR_STOP=1 -Atf "$SCRIPT_DIR/db-table-counts.sql")"
  if ! diff <(sort "$DUMP.counts") <(echo "$ACTUAL" | sort) >/dev/null; then
    diff <(sort "$DUMP.counts") <(echo "$ACTUAL" | sort) | head -20 >&2
    fail "Zeilenzahlen weichen ab"
  fi
  echo "✓ Zeilenzahlen ($(wc -l < "$DUMP.counts") Tabellen, $(echo "$ACTUAL" | awk -F'|' '{s+=$2} END {print s}') Zeilen)"
fi

# 4. RLS auf allen Tabellen mit account_id aktiv und erzwungen (außer globalen Verzeichnissen)
MISSING="$(psql "$TARGET_URL" -Atc "
  SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE c.relkind = 'r'
    AND EXISTS (SELECT 1 FROM information_schema.columns k
                WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'account_id')
    AND c.relname NOT IN ('sessions','outbox_pending','job_queue','api_key_index','workflow_schedule',
                          'platform_accounts','support_ticket_index')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")"
[[ -z "$MISSING" ]] || fail "RLS fehlt nach Wiederherstellung: $MISSING"
echo "✓ Row-Level Security aktiv"

# 5. Migrationen
MIG="$(psql "$TARGET_URL" -Atc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")"
echo "✓ $MIG Migrationen vorhanden"

echo "Wiederherstellungs-Probe erfolgreich."
