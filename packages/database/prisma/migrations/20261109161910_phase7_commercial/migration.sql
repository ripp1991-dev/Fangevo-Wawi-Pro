-- CreateTable
CREATE TABLE "subscriptions" (
    "account_id" UUID NOT NULL,
    "plan" TEXT NOT NULL,
    "interval" TEXT NOT NULL DEFAULT 'month',
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_plan" TEXT,
    "payment_method" TEXT NOT NULL DEFAULT 'invoice',
    "billing_name" TEXT,
    "billing_street" TEXT,
    "billing_postal_code" TEXT,
    "billing_city" TEXT,
    "billing_country" CHAR(2) NOT NULL DEFAULT 'DE',
    "billing_vat_id" TEXT,
    "billing_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "subscription_addons" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trial_ends_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),

    CONSTRAINT "subscription_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "total_net" DECIMAL(19,4) NOT NULL,
    "total_tax" DECIMAL(19,4) NOT NULL,
    "total_gross" DECIMAL(19,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "pdf" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_accounts" (
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_email" TEXT,
    "plan" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'waiting_support',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_user_id" UUID,
    "author_name" TEXT NOT NULL,
    "from_support" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_index" (
    "ticket_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_ticket_index_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_addons_account_id_module_key" ON "subscription_addons"("account_id", "module");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_number_key" ON "platform_invoices"("number");

-- CreateIndex
CREATE INDEX "platform_invoices_account_id_issued_at_idx" ON "platform_invoices"("account_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_account_id_number_key" ON "support_tickets"("account_id", "number");

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "support_ticket_index_status_updated_at_idx" ON "support_ticket_index"("status", "updated_at");

-- ════════════════════════════════════════════════════════════════════
-- Mandantentrennung (Account-Ebene)
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions','subscription_addons','platform_invoices','support_tickets','support_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account())',
      t);
  END LOOP;
END $$;
-- platform_accounts, platform_counters und support_ticket_index sind bewusst global
-- (Verzeichnis/Zähler/Postfach-Index ohne Fachdaten der Kunden).

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_valid CHECK (status IN ('trialing','active','past_due','canceled'));
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_interval_valid CHECK (interval IN ('month','year'));
ALTER TABLE subscription_addons ADD CONSTRAINT subscription_addons_status_valid CHECK (status IN ('trial','active','canceled'));
ALTER TABLE platform_invoices ADD CONSTRAINT platform_invoices_status_valid CHECK (status IN ('open','paid','void'));
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_valid CHECK (status IN ('open','waiting_support','waiting_customer','closed'));

-- Rechnungen von FangEvo: Inhalt unveränderlich, nur Status/Zahlungsdatum änderbar, nicht löschbar
CREATE FUNCTION app_protect_platform_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Rechnungen können nicht gelöscht werden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.lines IS DISTINCT FROM OLD.lines OR NEW.total_gross IS DISTINCT FROM OLD.total_gross
     OR NEW.total_net IS DISTINCT FROM OLD.total_net OR NEW.pdf IS DISTINCT FROM OLD.pdf OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'Rechnung % ist unveränderlich', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_invoices_protect BEFORE UPDATE OR DELETE ON platform_invoices FOR EACH ROW EXECUTE FUNCTION app_protect_platform_invoice();

-- Verzeichnis mit bestehenden Accounts füllen (Eigentümer liest dazu kurz ohne FORCE-RLS)
ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE entitlements NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships NO FORCE ROW LEVEL SECURITY;
INSERT INTO platform_accounts (account_id, name, owner_email, plan, status, created_at, updated_at)
SELECT a.id, a.name,
       (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.account_id = a.id AND m.is_owner LIMIT 1),
       COALESCE(e.plan, 'starter'), COALESCE(e.status::text, 'TRIAL'), a.created_at, now()
FROM accounts a LEFT JOIN entitlements e ON e.account_id = a.id
ON CONFLICT DO NOTHING;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE entitlements FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions, subscription_addons, support_tickets, platform_accounts,
      platform_counters, support_ticket_index TO fangevo_app;
    GRANT SELECT, INSERT, UPDATE ON platform_invoices TO fangevo_app;
    GRANT SELECT, INSERT ON support_messages TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
