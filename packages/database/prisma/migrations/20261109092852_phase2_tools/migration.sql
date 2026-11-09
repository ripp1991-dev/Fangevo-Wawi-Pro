-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "actor_user_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_pending" (
    "event_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pending_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("account_id","user_id","type")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "table_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "reference_entity" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferences" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "widgets" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_documents" (
    "account_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "company_id" UUID,
    "permission" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_documents_pkey" PRIMARY KEY ("account_id","entity_type","entity_id")
);

-- CreateIndex
CREATE INDEX "outbox_events_account_id_created_at_idx" ON "outbox_events"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_pending_available_at_idx" ON "outbox_pending"("available_at");

-- CreateIndex
CREATE INDEX "notifications_account_id_user_id_created_at_idx" ON "notifications"("account_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_account_id_user_id_dedupe_key_key" ON "notifications"("account_id", "user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "saved_views_account_id_table_key_idx" ON "saved_views"("account_id", "table_key");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_account_id_entity_type_key_key" ON "custom_field_definitions"("account_id", "entity_type", "key");

-- CreateIndex
CREATE INDEX "preferences_account_id_key_idx" ON "preferences"("account_id", "key");

-- CreateIndex
CREATE INDEX "dashboards_account_id_user_id_idx" ON "dashboards"("account_id", "user_id");

-- ════════════════════════════════════════════════════════════════════
-- Mandantentrennung (RLS) für die neuen Tabellen
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outbox_events','saved_views','custom_field_definitions','preferences','dashboards','search_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account())',
      t);
  END LOOP;
END $$;

-- Benachrichtigungen: zusätzlich nur die eigenen. Ohne Benutzerkontext (Worker) alle des Accounts.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications','notification_preferences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (account_id = app_current_account() AND (app_current_user() IS NULL OR user_id = app_current_user())) WITH CHECK (account_id = app_current_account())',
      t);
  END LOOP;
END $$;

-- outbox_pending ist bewusst global: enthält nur IDs, keine Inhalte.

CREATE TRIGGER outbox_events_immutable BEFORE UPDATE OR DELETE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION app_reject_modification();

-- Einstellungen: je Account, Benutzer (oder Account-Standard) und Schlüssel nur ein Eintrag
CREATE UNIQUE INDEX preferences_scope_key ON preferences (account_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- ════════════════════════════════════════════════════════════════════
-- Globale Suche: Volltext (deutsch) + Trigramme (tippfehlertolerant)
-- Hinweis: Diese Ausdrucks-Indizes kennt Prisma nicht. Neue Migrationen immer
-- mit --create-only erzeugen und prüfen, dass sie nicht entfernt werden.
-- ════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX search_documents_fts ON search_documents
  USING GIN (to_tsvector('german', coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' || coalesce(body, '')));
CREATE INDEX search_documents_title_trgm ON search_documents USING GIN (lower(title) gin_trgm_ops);

-- Vorhandene Daten in den Suchindex übernehmen (RLS dafür kurz nur für den Eigentümer gelockert)
ALTER TABLE companies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE search_documents NO FORCE ROW LEVEL SECURITY;

INSERT INTO search_documents (account_id, entity_type, entity_id, company_id, permission, title, subtitle, body, url, archived, updated_at)
SELECT c.account_id, 'company', c.id, c.id, 'companies.read', c.name,
       nullif(concat_ws(' · ', c.legal_name, nullif(concat_ws(' ', c.postal_code, c.city), '')), ''),
       concat_ws(' ', c.vat_id, c.email, c.street), '/admin/companies?id=' || c.id, c.archived_at IS NOT NULL, now()
FROM companies c;

INSERT INTO search_documents (account_id, entity_type, entity_id, permission, title, subtitle, url, archived, updated_at)
SELECT m.account_id, 'member', m.id, 'users.read', u.name, u.email, '/admin/members?id=' || m.id, m.status = 'DISABLED', now()
FROM memberships m JOIN users u ON u.id = m.user_id;

INSERT INTO search_documents (account_id, entity_type, entity_id, permission, title, subtitle, url, updated_at)
SELECT r.account_id, 'role', r.id, 'roles.read', r.name, r.description, '/admin/roles?id=' || r.id, now()
FROM roles r;

ALTER TABLE companies FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE search_documents FORCE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════
-- Rechte der Laufzeit-Rolle
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fangevo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      outbox_pending, notifications, notification_preferences, saved_views,
      custom_field_definitions, preferences, dashboards, search_documents
      TO fangevo_app;
    GRANT SELECT, INSERT ON outbox_events TO fangevo_app;
  ELSE
    RAISE WARNING 'Rolle fangevo_app existiert nicht – Rechte bitte manuell vergeben (siehe DATABASE.md).';
  END IF;
END $$;
