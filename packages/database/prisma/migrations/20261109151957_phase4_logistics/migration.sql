-- AlterTable
ALTER TABLE "stock_levels" ADD COLUMN     "batch" TEXT,
ADD COLUMN     "best_before" DATE,
ADD COLUMN     "serial_number" TEXT;

-- CreateTable
CREATE TABLE "article_barcodes" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pick_lists" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "warehouse_id" UUID NOT NULL,
    "assigned_to" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "pick_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pick_list_lines" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pick_list_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "order_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "article_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_id" UUID,
    "batch" TEXT,
    "quantity" DECIMAL(19,4) NOT NULL,
    "picked_quantity" DECIMAL(19,4) NOT NULL DEFAULT 0,

    CONSTRAINT "pick_list_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_stations" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "default_carrier" TEXT NOT NULL DEFAULT 'manual',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packing_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "station_id" UUID,
    "carrier" TEXT NOT NULL,
    "tracking_number" TEXT,
    "parcels" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "label_pdf" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT,
    "notes" TEXT,
    "warehouse_id" UUID NOT NULL,
    "received_at" TIMESTAMP(3),
    "credit_note_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_lines" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "article_id" UUID,
    "article_number" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "condition" TEXT,
    "location_id" UUID,
    "batch" TEXT,
    "serial_number" TEXT,

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_barcodes_article_id_idx" ON "article_barcodes"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_barcodes_company_id_code_key" ON "article_barcodes"("company_id", "code");

-- CreateIndex
CREATE INDEX "pick_lists_company_id_status_idx" ON "pick_lists"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pick_lists_company_id_number_key" ON "pick_lists"("company_id", "number");

-- CreateIndex
CREATE INDEX "pick_list_lines_pick_list_id_idx" ON "pick_list_lines"("pick_list_id");

-- CreateIndex
CREATE INDEX "pick_list_lines_order_id_idx" ON "pick_list_lines"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "packing_stations_company_id_name_key" ON "packing_stations"("company_id", "name");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_company_id_number_key" ON "shipments"("company_id", "number");

-- CreateIndex
CREATE INDEX "returns_company_id_status_idx" ON "returns"("company_id", "status");

-- CreateIndex
CREATE INDEX "returns_order_id_idx" ON "returns"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "returns_company_id_number_key" ON "returns"("company_id", "number");

-- CreateIndex
CREATE INDEX "return_lines_return_id_idx" ON "return_lines"("return_id");

-- ════════════════════════════════════════════════════════════════════
-- Bestand je Charge/Seriennummer: eindeutige Zeile je Artikel/Lager/Platz/Charge/SN
-- (Index wird nur ersetzt, Daten bleiben unverändert)
-- ════════════════════════════════════════════════════════════════════
DROP INDEX stock_levels_slot;
CREATE UNIQUE INDEX stock_levels_slot ON stock_levels (
  company_id, article_id, warehouse_id,
  COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(batch, ''), COALESCE(serial_number, '')
);
ALTER TABLE stock_levels ADD CONSTRAINT stock_levels_serial_single CHECK (serial_number IS NULL OR quantity <= 1);

-- Rücknahme (Retoure) als eigene Buchungsart
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_valid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_valid
  CHECK (type IN ('receipt','issue','transfer_out','transfer_in','correction','return'));

-- ════════════════════════════════════════════════════════════════════
-- Firmentrennung
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'article_barcodes','pick_lists','pick_list_lines','packing_stations','shipments','returns','return_lines'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING (account_id = app_current_account() AND company_id = app_current_company()) WITH CHECK (account_id = app_current_account() AND company_id = app_current_company())',
      t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- Plausibilitätsregeln
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE pick_lists ADD CONSTRAINT pick_lists_status_valid CHECK (status IN ('open','in_progress','done','cancelled'));
ALTER TABLE pick_list_lines ADD CONSTRAINT pick_list_lines_quantities CHECK (quantity > 0 AND picked_quantity >= 0 AND picked_quantity <= quantity);
ALTER TABLE shipments ADD CONSTRAINT shipments_carrier_valid CHECK (carrier IN ('manual','own_label'));
ALTER TABLE returns ADD CONSTRAINT returns_status_valid CHECK (status IN ('open','received','cancelled'));
ALTER TABLE return_lines ADD CONSTRAINT return_lines_quantity_positive CHECK (quantity > 0);
ALTER TABLE return_lines ADD CONSTRAINT return_lines_condition_valid CHECK (condition IS NULL OR condition IN ('resell','damaged','scrap'));

-- Sendungen sind Nachweise: nicht löschbar
CREATE TRIGGER shipments_no_delete BEFORE DELETE ON shipments FOR EACH ROW EXECUTE FUNCTION app_reject_modification();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON article_barcodes, pick_lists, pick_list_lines, packing_stations, returns, return_lines TO fangevo_app;
    GRANT SELECT, INSERT, UPDATE ON shipments TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
