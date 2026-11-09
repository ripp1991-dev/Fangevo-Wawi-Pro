-- Nur für lokale Entwicklung. Produktion: Rollen und Passwörter über Secret-Management.
CREATE ROLE fangevo_owner LOGIN PASSWORD 'fangevo_owner_dev' CREATEDB;
CREATE ROLE fangevo_app LOGIN PASSWORD 'fangevo_app_dev' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE fangevo_dev OWNER fangevo_owner;
CREATE DATABASE fangevo_test OWNER fangevo_owner;
-- Backup-Rolle (Phase 8): nur lesen, umgeht RLS, damit pg_dump alle Mandanten sichern kann.
-- Kann nichts ändern; Zugangsdaten nur für den Backup-Job.
CREATE ROLE fangevo_backup LOGIN PASSWORD 'fangevo_backup_dev' NOSUPERUSER BYPASSRLS;
GRANT pg_read_all_data TO fangevo_backup;
