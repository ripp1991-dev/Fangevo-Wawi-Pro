-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "channel_id" UUID;

-- CreateTable
CREATE TABLE "job_queue" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID,
    "user_id" UUID,
    "ref_id" UUID NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "file_name" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "config" JSONB,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "ok_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "dry_run" JSONB,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job_records" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "import_job_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_templates" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "permissions" TEXT[],
    "created_by" UUID NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_index" (
    "hash" TEXT NOT NULL,
    "key_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,

    CONSTRAINT "api_key_index_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "sales_channels" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets_enc" TEXT,
    "warehouse_id" UUID NOT NULL,
    "api_key_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "sales_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_logs" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_listings" (
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "price_net" DECIMAL(19,4),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_listings_pkey" PRIMARY KEY ("channel_id","article_id")
);

-- CreateTable
CREATE TABLE "external_refs" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "internal_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_queue_available_at_idx" ON "job_queue"("available_at");

-- CreateIndex
CREATE INDEX "import_jobs_company_id_created_at_idx" ON "import_jobs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "import_job_records_job_id_idx" ON "import_job_records"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_templates_company_id_entity_name_key" ON "import_templates"("company_id", "entity", "name");

-- CreateIndex
CREATE INDEX "api_keys_company_id_idx" ON "api_keys"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_index_key_id_key" ON "api_key_index"("key_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_channels_company_id_name_key" ON "sales_channels"("company_id", "name");

-- CreateIndex
CREATE INDEX "channel_logs_channel_id_created_at_idx" ON "channel_logs"("channel_id", "created_at");

-- CreateIndex
CREATE INDEX "external_refs_internal_id_idx" ON "external_refs"("internal_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_refs_channel_id_entity_type_external_id_key" ON "external_refs"("channel_id", "entity_type", "external_id");

-- ════════════════════════════════════════════════════════════════════
-- Firmentrennung
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'import_jobs','import_job_records','import_templates','api_keys','sales_channels','channel_logs',
    'channel_listings','external_refs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING (account_id = app_current_account() AND company_id = app_current_company()) WITH CHECK (account_id = app_current_account() AND company_id = app_current_company())',
      t);
  END LOOP;
END $$;
-- job_queue und api_key_index sind bewusst global: sie enthalten nur IDs bzw. Hashes, keine Fachdaten.

ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_status_valid
  CHECK (status IN ('uploaded','validated','queued','running','done','failed','rolled_back'));
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_entity_valid
  CHECK (entity IN ('articles','customers','suppliers','stock','prices','categories'));
ALTER TABLE sales_channels ADD CONSTRAINT sales_channels_type_valid CHECK (type IN ('api'));
ALTER TABLE channel_logs ADD CONSTRAINT channel_logs_level_valid CHECK (level IN ('info','warning','error'));
CREATE INDEX sales_orders_channel_idx ON sales_orders (company_id, channel_id) WHERE channel_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON job_queue, import_jobs, import_job_records, import_templates, api_keys,
      api_key_index, sales_channels, channel_listings, external_refs TO fangevo_app;
    GRANT SELECT, INSERT ON channel_logs TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
