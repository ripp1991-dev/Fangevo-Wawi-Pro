# Datenbank

PostgreSQL 16 · Prisma 6 · Schema: [`packages/database/prisma/schema.prisma`](packages/database/prisma/schema.prisma)

## Rollen

| Rolle           | Zweck                                                                            | Rechte                                           |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| `fangevo_owner` | Eigentümer der Tabellen, führt Migrationen aus (`DATABASE_MIGRATE_URL`)          | DDL                                              |
| `fangevo_app`   | Laufzeit-Rolle der API (`DATABASE_URL`), **ohne** `BYPASSRLS` und ohne Superuser | Lesen/Schreiben, Protokolle nur lesen + anhängen |

Die Migration vergibt die Rechte an `fangevo_app` automatisch, wenn die Rolle existiert. In Produktion werden beide Rollen mit eigenen Passwörtern über das Secret-Management angelegt.

## Mandantentrennung (Row-Level Security)

- Jede mandantenbezogene Tabelle hat `account_id` und eine Policy `tenant_isolation`: Zeilen sind nur sichtbar bzw. schreibbar, wenn `account_id = app_current_account()`.
- `FORCE ROW LEVEL SECURITY` ist aktiv, gilt also auch für den Tabelleneigentümer.
- Die API setzt den Kontext pro Transaktion mit `set_config('app.account_id', …, true)` (Helfer `withTenant`). Er gilt nur innerhalb der Transaktion.
- Ohne Kontext liefern Mandantentabellen **keine** Zeilen. Ein vergessener Filter führt also zu „nichts gefunden“, nie zu fremden Daten.
- Sonderfälle: `memberships` zeigt zusätzlich die eigenen Mitgliedschaften (`user_id = app_current_user()`) für die Account-Auswahl; `accounts` zeigt Accounts, in denen der Benutzer aktives Mitglied ist.
- Globale Tabellen ohne Mandantenbezug: `users`, `sessions`, `auth_tokens`, `mfa_recovery_codes`, `security_events`. Nur der Auth-Bereich der API greift darauf zu.

Abgesichert durch die Testsuite `apps/api/test/tenant-isolation.test.ts` (API- und Datenbankebene).

## Tabellen (Phase 1)

| Tabelle                                      | Inhalt                                                                             | RLS    |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| `users`                                      | Personen (E-Mail, Argon2id-Passworthash, MFA-Secret AES-GCM-verschlüsselt)         | global |
| `sessions`                                   | Sitzungen (nur SHA-256-Hash des Tokens)                                            | global |
| `auth_tokens`                                | Einmal-Tokens: E-Mail-Bestätigung, Passwort-Reset, MFA-Einrichtung (Hash)          | global |
| `mfa_recovery_codes`                         | Wiederherstellungscodes (Hash, einmal nutzbar)                                     | global |
| `security_events`                            | Sicherheitsereignisse je Benutzer (unveränderlich)                                 | global |
| `accounts`                                   | Mandanten                                                                          | ✅     |
| `companies`                                  | Firmen inkl. Adresse, USt-IdNr., `version` für optimistische Sperre, `archived_at` | ✅     |
| `memberships`                                | Benutzer ↔ Account, Inhaber-Flag, Status, „alle Firmen“                            | ✅     |
| `company_access`                             | Firmenzugriff je Mitgliedschaft                                                    | ✅     |
| `roles`, `role_permissions`                  | Rollen und ihre Rechte; Systemrollen über `system_key`                             | ✅     |
| `membership_roles`, `membership_permissions` | Rollen und Einzelrechte je Mitgliedschaft                                          | ✅     |
| `invitations`                                | Einladungen (Token-Hash, Rollen, Firmen, Ablauf)                                   | ✅     |
| `entitlements`                               | Lizenz-Kern je Account                                                             | ✅     |
| `entitlement_events`                         | Lizenzhistorie (unveränderlich)                                                    | ✅     |
| `audit_logs`                                 | Audit-Log (unveränderlich)                                                         | ✅     |

**Unveränderlich** heißt: Trigger `app_reject_modification` verhindert `UPDATE`/`DELETE`, zusätzlich hat `fangevo_app` nur `SELECT, INSERT`.

## Konventionen

- IDs: UUID v7 (zeitlich sortierbar, im Code erzeugt), daher Cursor-Paginierung über die ID möglich.
- Tabellen/Spalten `snake_case`, Prisma-Modelle `PascalCase`.
- Geldbeträge (ab Phase 3): `numeric` bzw. Ganzzahl in Cent, nie Gleitkomma.
- Bestände (ab Phase 3): ausschließlich über ein unveränderliches Bestandsjournal.

## Migrationen

- Entwicklung: `pnpm db:migrate:dev` (erzeugt und spielt Migrationen ein).
- Deployment/CI: `pnpm db:migrate` (`prisma migrate deploy`, nicht-destruktiv).
- Testdatenbank: `pnpm db:test:migrate` (nur Datenbanken mit Endung `_test`).
- Jede Migration ist eine SQL-Datei im Repository. RLS-Policies, Trigger und Rechte stehen direkt in der Migration.
- **Destruktive Änderungen** (Spalten/Tabellen löschen, `migrate reset`) nur mit ausdrücklicher Freigabe (Playbook-Regel 13).

## Tabellen (Phase 2)

| Tabelle                    | Inhalt                                                               | RLS                  |
| -------------------------- | -------------------------------------------------------------------- | -------------------- |
| `outbox_events`            | Fachliche Ereignisse (unveränderlich)                                | ✅                   |
| `outbox_pending`           | Zustellwarteschlange, nur IDs, Sperre und Wiederholungen             | global (ohne Inhalt) |
| `notifications`            | Benachrichtigungen je Benutzer, `dedupe_key` gegen Doppelte          | ✅ + nur eigene      |
| `notification_preferences` | An/Aus je Benachrichtigungsart                                       | ✅ + nur eigene      |
| `saved_views`              | Gespeicherte Tabellenansichten (persönlich/freigegeben)              | ✅                   |
| `custom_field_definitions` | Eigene Felder je Datensatztyp                                        | ✅                   |
| `preferences`              | Einstellungen (persönlich oder Account-Standard bei `user_id` leer)  | ✅                   |
| `dashboards`               | Dashboard-Seiten mit Widgets (JSON), persönlich oder Account-Vorlage | ✅                   |
| `search_documents`         | Suchindex                                                            | ✅                   |
| `companies.custom_fields`  | Werte der eigenen Felder (JSONB)                                     | –                    |

**Benachrichtigungen:** Die Policy erlaubt nur Zeilen des angemeldeten Benutzers. Ohne Benutzerkontext (Worker) sind alle Zeilen des Accounts sichtbar, damit Benachrichtigungen für andere angelegt werden können.

**Von Hand gepflegte Indizes** (Prisma kennt sie nicht; bei neuen Migrationen mit `--create-only` prüfen, dass sie bleiben): `search_documents_fts` (Volltext deutsch), `search_documents_title_trgm` (Trigramm), `preferences_scope_key` (eindeutig je Account/Benutzer/Schlüssel). Die Erweiterung `pg_trgm` wird von der Migration angelegt.

**Befüllung des Suchindex:** Die Migration `phase2_tools` übernimmt vorhandene Firmen, Mitglieder und Rollen. Dafür wird RLS für den Eigentümer innerhalb der Migration kurz gelockert (`NO FORCE`) und sofort wieder aktiviert.
