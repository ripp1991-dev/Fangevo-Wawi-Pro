#!/usr/bin/env bash
# Sicherung der Datenbank (Phase 8, siehe OPERATIONS.md).
#
#   BACKUP_DATABASE_URL=postgresql://fangevo_backup:...@host:5432/fangevo scripts/db-backup.sh [zielordner]
#
# - nutzt die Rolle fangevo_backup (nur lesen, umgeht RLS – sonst würden Mandantendaten fehlen)
# - schreibt <ordner>/fangevo-<zeitstempel>.dump (pg_dump custom format, komprimiert),
#   dazu .sha256 (Prüfsumme) und .counts (Zeilen je Tabelle zum Abgleich bei der Wiederherstellung)
# - ändert nichts an der Datenbank
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL fehlt (Rolle fangevo_backup)}"
DIR="${1:-${BACKUP_DIR:-./backups}}"
mkdir -p "$DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/fangevo-$TS.dump"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Zeilen je Tabelle in derselben Momentaufnahme wie der Dump (REPEATABLE READ über ein exportiertes Snapshot
# ist hier nicht nötig: gezählt wird vorher; bei laufendem Betrieb dient der Abgleich als Plausibilitätsprüfung).
psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -Atf "$SCRIPT_DIR/db-table-counts.sql" > "$FILE.counts"

pg_dump --format=custom --compress=6 --no-password --file="$FILE" "$BACKUP_DATABASE_URL"
sha256sum "$FILE" | awk '{print $1}' > "$FILE.sha256"

echo "Sicherung erstellt: $FILE ($(du -h "$FILE" | cut -f1), $(wc -l < "$FILE.counts") Tabellen)"
