-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "bank_name" TEXT,
ADD COLUMN     "bic" TEXT,
ADD COLUMN     "document_footer" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "logo_data_url" TEXT,
ADD COLUMN     "managing_director" TEXT,
ADD COLUMN     "register_court" TEXT,
ADD COLUMN     "register_number" TEXT,
ADD COLUMN     "tax_number" TEXT;

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "customer_id" UUID NOT NULL,
    "customer_snapshot" JSONB NOT NULL,
    "price_display" TEXT NOT NULL DEFAULT 'gross',
    "warehouse_id" UUID NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "external_number" TEXT,
    "payment_method" TEXT,
    "shipping_method" TEXT,
    "shipping_net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "shipping_tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 19,
    "total_net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "shipped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "article_id" UUID,
    "article_number" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Stück',
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_price_net" DECIMAL(19,4) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "line_net" DECIMAL(19,4) NOT NULL,
    "line_tax" DECIMAL(19,4) NOT NULL,
    "line_gross" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "order_id" UUID,
    "purchase_order_id" UUID,
    "related_id" UUID,
    "recipient" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "tax_summary" JSONB NOT NULL,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "issue_date" DATE NOT NULL,
    "service_date" DATE,
    "due_date" DATE,
    "notes" TEXT,
    "payment_status" TEXT,
    "finalized_at" TIMESTAMP(3),
    "finalized_by" UUID,
    "pdf_sha256" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_files" (
    "document_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "content" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_files_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "expected_date" DATE,
    "ordered_at" TIMESTAMP(3),
    "total_net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "article_id" UUID NOT NULL,
    "article_number" TEXT NOT NULL,
    "supplier_sku" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "received_quantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "unit_price_net" DECIMAL(19,4) NOT NULL,
    "line_net" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_orders_company_id_status_idx" ON "sales_orders"("company_id", "status");

-- CreateIndex
CREATE INDEX "sales_orders_company_id_customer_id_idx" ON "sales_orders"("company_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_company_id_number_key" ON "sales_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "sales_order_lines_order_id_idx" ON "sales_order_lines"("order_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_idx" ON "order_status_history"("order_id");

-- CreateIndex
CREATE INDEX "stock_reservations_company_id_article_id_warehouse_id_idx" ON "stock_reservations"("company_id", "article_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_reservations_order_id_idx" ON "stock_reservations"("order_id");

-- CreateIndex
CREATE INDEX "documents_company_id_type_issue_date_idx" ON "documents"("company_id", "type", "issue_date");

-- CreateIndex
CREATE INDEX "documents_order_id_idx" ON "documents"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_company_id_type_number_key" ON "documents"("company_id", "type", "number");

-- CreateIndex
CREATE INDEX "payments_document_id_idx" ON "payments"("document_id");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_status_idx" ON "purchase_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_number_key" ON "purchase_orders"("company_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipts_purchase_order_id_idx" ON "goods_receipts"("purchase_order_id");

-- ════════════════════════════════════════════════════════════════════
-- Firmentrennung (wie Phase 3a)
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales_orders','sales_order_lines','order_status_history','stock_reservations','documents','document_files',
    'payments','purchase_orders','purchase_order_lines','goods_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING (account_id = app_current_account() AND company_id = app_current_company()) WITH CHECK (account_id = app_current_account() AND company_id = app_current_company())',
      t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- Unveränderlichkeit (GoBD)
-- ════════════════════════════════════════════════════════════════════
CREATE TRIGGER order_status_history_immutable BEFORE UPDATE OR DELETE ON order_status_history FOR EACH ROW EXECUTE FUNCTION app_reject_modification();
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION app_reject_modification();
CREATE TRIGGER document_files_immutable BEFORE UPDATE OR DELETE ON document_files FOR EACH ROW EXECUTE FUNCTION app_reject_modification();
CREATE TRIGGER goods_receipts_immutable BEFORE UPDATE OR DELETE ON goods_receipts FOR EACH ROW EXECUTE FUNCTION app_reject_modification();

-- Festgeschriebene Belege: Inhalt unveränderlich, nur Zahlungsstatus und Versandzeitpunkt dürfen sich ändern.
CREATE FUNCTION app_protect_finalized_document() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'finalized' THEN
      RAISE EXCEPTION 'Festgeschriebene Belege können nicht gelöscht werden' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'finalized' AND (
       NEW.type IS DISTINCT FROM OLD.type OR NEW.number IS DISTINCT FROM OLD.number OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.recipient IS DISTINCT FROM OLD.recipient OR NEW.lines IS DISTINCT FROM OLD.lines OR NEW.tax_summary IS DISTINCT FROM OLD.tax_summary
    OR NEW.total_net IS DISTINCT FROM OLD.total_net OR NEW.total_tax IS DISTINCT FROM OLD.total_tax OR NEW.total_gross IS DISTINCT FROM OLD.total_gross
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.service_date IS DISTINCT FROM OLD.service_date OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.related_id IS DISTINCT FROM OLD.related_id OR NEW.notes IS DISTINCT FROM OLD.notes
  ) THEN
    RAISE EXCEPTION 'Festgeschriebener Beleg % ist unveränderlich', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_protect_finalized BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION app_protect_finalized_document();

-- ════════════════════════════════════════════════════════════════════
-- Plausibilitätsregeln
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_valid CHECK (status IN ('new','unchecked','in_progress','awaiting_payment','awaiting_stock','picking','packing','ready_to_ship','shipped','completed','cancelled'));
ALTER TABLE sales_order_lines ADD CONSTRAINT sales_order_lines_quantity_positive CHECK (quantity > 0);
ALTER TABLE documents ADD CONSTRAINT documents_type_valid CHECK (type IN ('offer','order_confirmation','delivery_note','invoice','credit_note','cancellation','purchase_order'));
ALTER TABLE documents ADD CONSTRAINT documents_status_valid CHECK (status IN ('draft','finalized'));
ALTER TABLE documents ADD CONSTRAINT documents_finalized_has_number CHECK (status = 'draft' OR (number IS NOT NULL AND finalized_at IS NOT NULL));
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_valid CHECK (status IN ('draft','ordered','partially_received','received','cancelled'));
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_quantities CHECK (quantity > 0 AND received_quantity >= 0);
ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_positive CHECK (quantity > 0);

-- ════════════════════════════════════════════════════════════════════
-- Rechte der Laufzeit-Rolle
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON sales_orders, sales_order_lines, stock_reservations, documents, purchase_orders, purchase_order_lines TO fangevo_app;
    GRANT SELECT, INSERT ON order_status_history, document_files, payments, goods_receipts TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
