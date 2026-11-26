-- Shopify als Verkaufskanal (ADR-015).
-- Nicht-destruktiv: zwei neue Tabellen und eine erweiterte Prüfregel; bestehende Daten bleiben unverändert.

-- Neue Kanal-Art „shopify“ zulassen (bisher nur „api“)
ALTER TABLE sales_channels DROP CONSTRAINT sales_channels_type_valid;
ALTER TABLE sales_channels ADD CONSTRAINT sales_channels_type_valid CHECK (type IN ('api', 'shopify'));

-- Verknüpfung Artikel ↔ Shopify-Variante je Kanal (über SKU = Artikelnummer bzw. EAN/Barcode)
-- inkl. zuletzt übertragenem Bestand.
CREATE TABLE "channel_article_links" (
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "external_product_id" TEXT NOT NULL,
    "external_variant_id" TEXT NOT NULL,
    "external_inventory_item_id" TEXT,
    "external_sku" TEXT,
    "external_title" TEXT,
    "matched_by" TEXT NOT NULL,
    "stock_tracked" BOOLEAN NOT NULL DEFAULT true,
    "last_stock_sent" DECIMAL(19,4),
    "last_stock_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_article_links_pkey" PRIMARY KEY ("channel_id", "article_id")
);
CREATE UNIQUE INDEX "channel_article_links_channel_id_external_variant_id_key" ON "channel_article_links"("channel_id", "external_variant_id");
CREATE INDEX "channel_article_links_article_id_idx" ON "channel_article_links"("article_id");

-- Fälligkeit des automatischen Abgleichs je Kanal (global wie workflow_schedule: nur IDs und Zeitpunkt)
CREATE TABLE "channel_sync_schedule" (
    "channel_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_sync_schedule_pkey" PRIMARY KEY ("channel_id")
);
CREATE INDEX "channel_sync_schedule_next_run_at_idx" ON "channel_sync_schedule"("next_run_at");

-- ════════════════════════════════════════════════════════════════════
-- Mandanten- und Firmentrennung (ADR-013)
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE channel_article_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_article_links FORCE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON channel_article_links
  USING (account_id = app_current_account() AND company_id = app_current_company())
  WITH CHECK (account_id = app_current_account() AND company_id = app_current_company());

-- channel_sync_schedule ist bewusst global (nur IDs und Fälligkeit), wie workflow_schedule.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON channel_article_links, channel_sync_schedule TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
