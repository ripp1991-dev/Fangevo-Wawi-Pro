-- Touch-Packtisch: freigegebene Geräte und PIN-Anmeldung für Packer.
-- Nicht-destruktiv: neue Tabellen und optionale Spalten; bestehende Daten bleiben unverändert.

-- Freigegebene Lagerrechner (je Firma und Packplatz). Im Geräte-Cookie steht ein Zufallstoken,
-- hier nur dessen SHA-256-Hash. Widerruf jederzeit möglich.
CREATE TABLE "packing_devices" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "packing_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "packing_devices_token_hash_key" ON "packing_devices"("token_hash");
CREATE INDEX "packing_devices_company_id_idx" ON "packing_devices"("company_id");

-- PIN je Person und Account (Argon2id-Hash), mit Sperre nach Fehlversuchen.
CREATE TABLE "packer_pins" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packer_pins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "packer_pins_account_id_user_id_key" ON "packer_pins"("account_id", "user_id");

-- PIN-Sitzungen gelten nur für den Packtisch einer Firma (über das Gerät).
ALTER TABLE "sessions" ADD COLUMN "scope" TEXT;
ALTER TABLE "sessions" ADD COLUMN "scope_company_id" UUID;
ALTER TABLE "sessions" ADD COLUMN "device_id" UUID;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_scope_valid" CHECK (scope IS NULL OR scope IN ('packing'));
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_scope_company" CHECK (scope IS NULL OR scope_company_id IS NOT NULL);

-- ════════════════════════════════════════════════════════════════════
-- Mandanten- und Firmentrennung (ADR-013)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE packing_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON packing_devices
  USING (account_id = app_current_account() AND company_id = app_current_company())
  WITH CHECK (account_id = app_current_account() AND company_id = app_current_company());

ALTER TABLE packer_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE packer_pins FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON packer_pins
  USING (account_id = app_current_account())
  WITH CHECK (account_id = app_current_account());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON packing_devices TO fangevo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON packer_pins TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
