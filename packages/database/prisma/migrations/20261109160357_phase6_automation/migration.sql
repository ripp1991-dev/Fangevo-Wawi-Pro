-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "company_id" UUID;

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret_enc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "disabled_reason" TEXT,
    "last_status" INTEGER,
    "last_delivery_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "event_id" UUID,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_status" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_rules" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "trigger_type" TEXT NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "run_as" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "workflow_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "event_type" TEXT NOT NULL,
    "event_id" UUID,
    "entity_id" TEXT,
    "context" JSONB,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_schedule" (
    "rule_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_schedule_pkey" PRIMARY KEY ("rule_id")
);

-- CreateIndex
CREATE INDEX "webhooks_company_id_idx" ON "webhooks"("company_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_webhook_id_event_id_key" ON "webhook_deliveries"("webhook_id", "event_id");

-- CreateIndex
CREATE INDEX "workflow_rules_company_id_trigger_type_idx" ON "workflow_rules"("company_id", "trigger_type");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_rule_id_version_key" ON "workflow_versions"("rule_id", "version");

-- CreateIndex
CREATE INDEX "workflow_runs_rule_id_created_at_idx" ON "workflow_runs"("rule_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_rule_id_event_id_entity_id_key" ON "workflow_runs"("rule_id", "event_id", "entity_id");

-- CreateIndex
CREATE INDEX "workflow_schedule_next_run_at_idx" ON "workflow_schedule"("next_run_at");

-- ════════════════════════════════════════════════════════════════════
-- Firmentrennung
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['webhooks','webhook_deliveries','workflow_rules','workflow_versions','workflow_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING (account_id = app_current_account() AND company_id = app_current_company()) WITH CHECK (account_id = app_current_account() AND company_id = app_current_company())',
      t);
  END LOOP;
END $$;
-- workflow_schedule ist bewusst global (nur IDs und Fälligkeit).

-- Fassungen einer Regel sind unveränderlich (Nachvollziehbarkeit)
CREATE TRIGGER workflow_versions_immutable BEFORE UPDATE OR DELETE ON workflow_versions FOR EACH ROW EXECUTE FUNCTION app_reject_modification();

ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_valid CHECK (status IN ('pending','delivered','failed'));
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_status_valid CHECK (status IN ('queued','success','skipped','failed','test'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON webhooks, webhook_deliveries, workflow_rules, workflow_runs, workflow_schedule TO fangevo_app;
    GRANT SELECT, INSERT ON workflow_versions TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
