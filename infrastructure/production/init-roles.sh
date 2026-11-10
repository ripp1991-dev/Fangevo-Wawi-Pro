#!/bin/sh
# Legt beim ersten Start des Datenbank-Containers die Rollen und die Datenbank an.
# Passwörter kommen aus der Umgebung (.env.production), nie aus dem Code.
set -eu
: "${FANGEVO_OWNER_PASSWORD:?}" "${FANGEVO_APP_PASSWORD:?}" "${FANGEVO_BACKUP_PASSWORD:?}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE fangevo_owner LOGIN PASSWORD '${FANGEVO_OWNER_PASSWORD}' CREATEDB;
CREATE ROLE fangevo_app LOGIN PASSWORD '${FANGEVO_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE fangevo_backup LOGIN PASSWORD '${FANGEVO_BACKUP_PASSWORD}' NOSUPERUSER BYPASSRLS;
GRANT pg_read_all_data TO fangevo_backup;
CREATE DATABASE fangevo OWNER fangevo_owner;
SQL
