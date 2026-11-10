-- Firmenbezug im globalen Schlüsselindex (Tabelle ist bei Einführung leer; neu in Phase 5)
ALTER TABLE "api_key_index" ADD COLUMN     "company_id" UUID NOT NULL;
