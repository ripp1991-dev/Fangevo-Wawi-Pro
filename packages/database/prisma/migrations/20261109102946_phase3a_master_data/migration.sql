-- CreateTable
CREATE TABLE "company_settings" (
    "company_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "padding" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("company_id","key")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_groups" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_display" TEXT NOT NULL DEFAULT 'gross',
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'standard',
    "parent_id" UUID,
    "variant_attributes" JSONB,
    "name" TEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "gtin" TEXT,
    "manufacturer_id" UUID,
    "brand" TEXT,
    "category_id" UUID,
    "unit" TEXT NOT NULL DEFAULT 'Stück',
    "tax_rate_id" UUID NOT NULL,
    "purchase_price_net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "sale_price_net" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "weight_kg" DECIMAL(12,4),
    "min_stock" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "stock_tracked" BOOLEAN NOT NULL DEFAULT true,
    "track_batches" BOOLEAN NOT NULL DEFAULT false,
    "track_serials" BOOLEAN NOT NULL DEFAULT false,
    "track_best_before" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_prices" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "customer_group_id" UUID,
    "min_quantity" DECIMAL(19,4) NOT NULL DEFAULT 1,
    "price_net" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "article_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_components" (
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "set_article_id" UUID NOT NULL,
    "component_article_id" UUID NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "set_components_pkey" PRIMARY KEY ("set_article_id","component_article_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'private',
    "company_name" TEXT,
    "salutation" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "vat_id" TEXT,
    "customer_group_id" UUID,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 14,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blocked_reason" TEXT,
    "notes" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "name2" TEXT,
    "street" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'DE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "vat_id" TEXT,
    "customer_number" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "default_delivery_days" INTEGER,
    "notes" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_articles" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "supplier_sku" TEXT,
    "purchase_price_net" DECIMAL(19,4) NOT NULL,
    "delivery_days" INTEGER,
    "min_order_quantity" DECIMAL(19,4) NOT NULL DEFAULT 1,
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "street" TEXT,
    "postal_code" TEXT,
    "city" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'DE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "balance_after" DECIMAL(19,4) NOT NULL,
    "batch" TEXT,
    "serial_number" TEXT,
    "best_before" DATE,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "transfer_id" UUID,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "quantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_rates_company_id_idx" ON "tax_rates"("company_id");

-- CreateIndex
CREATE INDEX "categories_company_id_parent_id_idx" ON "categories"("company_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_company_id_name_key" ON "manufacturers"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_groups_company_id_name_key" ON "customer_groups"("company_id", "name");

-- CreateIndex
CREATE INDEX "articles_company_id_name_idx" ON "articles"("company_id", "name");

-- CreateIndex
CREATE INDEX "articles_company_id_gtin_idx" ON "articles"("company_id", "gtin");

-- CreateIndex
CREATE INDEX "articles_company_id_parent_id_idx" ON "articles"("company_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "articles_company_id_number_key" ON "articles"("company_id", "number");

-- CreateIndex
CREATE INDEX "article_prices_article_id_idx" ON "article_prices"("article_id");

-- CreateIndex
CREATE INDEX "customers_company_id_last_name_idx" ON "customers"("company_id", "last_name");

-- CreateIndex
CREATE INDEX "customers_company_id_company_name_idx" ON "customers"("company_id", "company_name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_number_key" ON "customers"("company_id", "number");

-- CreateIndex
CREATE INDEX "addresses_owner_type_owner_id_idx" ON "addresses"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "contacts_owner_type_owner_id_idx" ON "contacts"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "suppliers_company_id_name_idx" ON "suppliers"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_number_key" ON "suppliers"("company_id", "number");

-- CreateIndex
CREATE INDEX "supplier_articles_article_id_idx" ON "supplier_articles"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_articles_supplier_id_article_id_key" ON "supplier_articles"("supplier_id", "article_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_company_id_code_key" ON "warehouses"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_warehouse_id_code_key" ON "storage_locations"("warehouse_id", "code");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_article_id_created_at_idx" ON "stock_movements"("company_id", "article_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_levels_company_id_article_id_idx" ON "stock_levels"("company_id", "article_id");

-- ════════════════════════════════════════════════════════════════════
-- Firmentrennung: zusätzlich zum Account muss die aktive Firma passen.
-- Die API setzt app.company_id aus dem geprüften Header X-Company-Id.
-- ════════════════════════════════════════════════════════════════════
CREATE FUNCTION app_current_company() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_settings','tax_rates','number_sequences','categories','manufacturers','customer_groups',
    'articles','article_prices','set_components','customers','addresses','contacts','suppliers',
    'supplier_articles','warehouses','storage_locations','stock_movements','stock_levels'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING (account_id = app_current_account() AND company_id = app_current_company()) WITH CHECK (account_id = app_current_account() AND company_id = app_current_company())',
      t);
  END LOOP;
END $$;

-- Bestandsjournal ist unveränderlich (Korrekturen nur durch neue Buchungen)
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app_reject_modification();

-- Bestand: genau eine Zeile je Artikel/Lager/Lagerplatz (Lagerplatz leer = Lager ohne Platz)
CREATE UNIQUE INDEX stock_levels_slot ON stock_levels (company_id, article_id, warehouse_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Plausibilitätsregeln direkt in der Datenbank
ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_rate_range CHECK (rate >= 0 AND rate <= 100);
ALTER TABLE articles ADD CONSTRAINT articles_kind_valid CHECK (kind IN ('standard','parent','variant','set'));
ALTER TABLE articles ADD CONSTRAINT articles_prices_non_negative CHECK (purchase_price_net >= 0 AND sale_price_net >= 0 AND min_stock >= 0);
ALTER TABLE customers ADD CONSTRAINT customers_type_valid CHECK (type IN ('private','business'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_valid CHECK (type IN ('receipt','issue','transfer_out','transfer_in','correction'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_quantity_nonzero CHECK (quantity <> 0);
ALTER TABLE customer_groups ADD CONSTRAINT customer_groups_display_valid CHECK (price_display IN ('gross','net'));

-- Suche in Artikeln/Kunden/Lieferanten (tippfehlertolerant)
CREATE INDEX articles_name_trgm ON articles USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX customers_search_trgm ON customers USING GIN (lower(coalesce(company_name, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);

-- ════════════════════════════════════════════════════════════════════
-- Rechte der Laufzeit-Rolle
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      company_settings, tax_rates, number_sequences, categories, manufacturers, customer_groups,
      articles, article_prices, set_components, customers, addresses, contacts, suppliers,
      supplier_articles, warehouses, storage_locations, stock_levels
      TO fangevo_app;
    GRANT SELECT, INSERT ON stock_movements TO fangevo_app;
    GRANT EXECUTE ON FUNCTION app_current_company() TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
