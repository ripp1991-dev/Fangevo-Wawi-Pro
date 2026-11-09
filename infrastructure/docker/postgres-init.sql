-- Nur für lokale Entwicklung. Produktion: Rollen und Passwörter über Secret-Management.
CREATE ROLE fangevo_owner LOGIN PASSWORD 'fangevo_owner_dev' CREATEDB;
CREATE ROLE fangevo_app LOGIN PASSWORD 'fangevo_app_dev' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE fangevo_dev OWNER fangevo_owner;
CREATE DATABASE fangevo_test OWNER fangevo_owner;
