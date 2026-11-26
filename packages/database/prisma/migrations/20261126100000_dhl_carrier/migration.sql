-- DHL als Versanddienstleister (ADR-016).
-- Nicht-destruktiv: eine neue Tabelle und eine erweiterte Prüfregel; bestehende Daten bleiben unverändert.

-- Neue Versandart „dhl“ zulassen (bisher manual, own_label)
ALTER TABLE shipments DROP CONSTRAINT shipments_carrier_valid;
ALTER TABLE shipments ADD CONSTRAINT shipments_carrier_valid CHECK (carrier IN ('manual', 'own_label', 'dhl'));

-- Zugang einer Firma zu einem Versanddienstleister. Einstellungen in config,
-- Zugangsdaten (z. B. Passwort des DHL-Geschäftskundenportals) nur verschlüsselt (AES-256-GCM).
CREATE TABLE "carrier_accounts" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "carrier" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets_enc" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carrier_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "carrier_accounts_company_id_carrier_key" ON "carrier_accounts"("company_id", "carrier");
ALTER TABLE carrier_accounts ADD CONSTRAINT carrier_accounts_carrier_valid CHECK (carrier IN ('dhl'));

-- ════════════════════════════════════════════════════════════════════
-- Mandanten- und Firmentrennung (ADR-013)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE carrier_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON carrier_accounts
  USING (account_id = app_current_account() AND company_id = app_current_company())
  WITH CHECK (account_id = app_current_account() AND company_id = app_current_company());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE ON carrier_accounts TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
