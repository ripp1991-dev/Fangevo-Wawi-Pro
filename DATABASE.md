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

| Tabelle                                      | Inhalt                                                                                                         | RLS    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| `users`                                      | Personen (E-Mail, Argon2id-Passworthash, MFA-Secret AES-GCM-verschlüsselt)                                     | global |
| `sessions`                                   | Sitzungen (nur SHA-256-Hash des Tokens); `scope`/`scope_company_id`/`device_id` für PIN-Sitzungen am Packtisch | global |
| `auth_tokens`                                | Einmal-Tokens: E-Mail-Bestätigung, Passwort-Reset, MFA-Einrichtung (Hash)                                      | global |
| `mfa_recovery_codes`                         | Wiederherstellungscodes (Hash, einmal nutzbar)                                                                 | global |
| `security_events`                            | Sicherheitsereignisse je Benutzer (unveränderlich)                                                             | global |
| `accounts`                                   | Mandanten                                                                                                      | ✅     |
| `companies`                                  | Firmen inkl. Adresse, USt-IdNr., `version` für optimistische Sperre, `archived_at`                             | ✅     |
| `memberships`                                | Benutzer ↔ Account, Inhaber-Flag, Status, „alle Firmen“                                                        | ✅     |
| `company_access`                             | Firmenzugriff je Mitgliedschaft                                                                                | ✅     |
| `roles`, `role_permissions`                  | Rollen und ihre Rechte; Systemrollen über `system_key`                                                         | ✅     |
| `membership_roles`, `membership_permissions` | Rollen und Einzelrechte je Mitgliedschaft                                                                      | ✅     |
| `invitations`                                | Einladungen (Token-Hash, Rollen, Firmen, Ablauf)                                                               | ✅     |
| `entitlements`                               | Lizenz-Kern je Account                                                                                         | ✅     |
| `entitlement_events`                         | Lizenzhistorie (unveränderlich)                                                                                | ✅     |
| `audit_logs`                                 | Audit-Log (unveränderlich)                                                                                     | ✅     |

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

## Tabellen (Phase 3a, firmenbezogen)

Alle mit `account_id` **und** `company_id`, Policy `company_isolation` (Account und aktive Firma müssen passen, siehe ADR-007).

| Tabelle                                          | Inhalt                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `company_settings`                               | Minusbestand erlaubt, Währung                                                                                             |
| `tax_rates`                                      | Steuersätze (Prozentsatz nach Anlage fest, archivierbar, ein Standard)                                                    |
| `number_sequences`                               | Nummernkreise (Präfix, nächste Nummer, Stellen)                                                                           |
| `categories`, `manufacturers`, `customer_groups` | Auswahllisten                                                                                                             |
| `articles`                                       | Artikel inkl. Art (standard/parent/variant/set), Preise netto `numeric(19,4)`, Rückverfolgung, `custom_fields`, `version` |
| `article_prices`                                 | Staffel-/Kundengruppenpreise                                                                                              |
| `set_components`                                 | Bestandteile von Sets                                                                                                     |
| `customers`, `suppliers`                         | Stammdaten inkl. `custom_fields`, `version`                                                                               |
| `addresses`, `contacts`                          | Adressen und Ansprechpartner von Kunden/Lieferanten (`owner_type`, `owner_id`)                                            |
| `supplier_articles`                              | Bezugsquellen (Lief.-Art.-Nr., EK, Lieferzeit, Mindestmenge, bevorzugt)                                                   |
| `warehouses`, `storage_locations`                | Lager und Lagerplätze                                                                                                     |
| `stock_movements`                                | **Bestandsjournal, unveränderlich** (Trigger; App-Rolle nur `SELECT/INSERT`)                                              |
| `stock_levels`                                   | aktueller Bestand je Artikel/Lager/Lagerplatz (eindeutig über Ausdrucks-Index `stock_levels_slot`)                        |

Zusätzliche Prüfregeln in der Datenbank: Steuersatz 0–100 %, gültige Artikel-/Kunden-/Buchungsarten, Preise ≥ 0, Buchungsmenge ≠ 0. Von Hand gepflegte Indizes: `stock_levels_slot`, `articles_name_trgm`, `customers_search_trgm`.

## Tabellen (Phase 3b, firmenbezogen)

Migration `20261109121149_phase3b_orders_documents_purchasing`. Ebenfalls mit `account_id` und `company_id` sowie Policy `company_isolation`.

| Tabelle                                   | Inhalt                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales_orders`, `sales_order_lines`       | Aufträge mit Kundendaten zum Bestellzeitpunkt (`customer_snapshot`), Status, Summen; Positionen mit Preis, Rabatt, Steuersatz, Beträgen                 |
| `order_status_history`                    | Statusverlauf (**unveränderlich**)                                                                                                                      |
| `stock_reservations`                      | Reservierter Bestand je Auftragsposition und Lager (Sets als Komponenten). Verfügbar = Bestand − Reservierungen älterer Aufträge                        |
| `documents`                               | Belege: Art, Nummer (erst beim Festschreiben, eindeutig je Firma und Art), Empfänger, Positionen und Steueraufstellung als JSON, Summen, Zahlungsstatus |
| `document_files`                          | PDF eines festgeschriebenen Belegs mit SHA-256 (**unveränderlich**)                                                                                     |
| `payments`                                | Zahlungseingänge (**unveränderlich**; Korrektur per Gegenbuchung)                                                                                       |
| `purchase_orders`, `purchase_order_lines` | Bestellungen an Lieferanten mit bestellter und gelieferter Menge                                                                                        |
| `goods_receipts`                          | Wareneingänge (**unveränderlich**); die Bestandsbuchung steht im Bestandsjournal                                                                        |

Schutz in der Datenbank: Trigger `app_protect_finalized_document` erlaubt bei festgeschriebenen Belegen nur Änderungen an `payment_status`, `sent_at` und `updated_at` und verbietet das Löschen. Für die unveränderlichen Tabellen hat die App-Rolle nur `SELECT, INSERT`. Prüfregeln: gültige Status und Belegarten, Mengen > 0, festgeschriebene Belege haben Nummer und Zeitpunkt. Neue Nummernkreise (`order`, `offer`, `order_confirmation`, `delivery_note`, `invoice`, `credit_note`, `cancellation`, `purchase_order`) werden auch für bestehende Firmen beim nächsten Zugriff ergänzt.

Firmeneinstellungen haben neue Spalten für Angaben auf Belegen (`tax_number`, `managing_director`, `register_court`, `register_number`, `bank_name`, `iban`, `bic`, `document_footer`, `logo_data_url`).

## Tabellen (Phase 4, firmenbezogen)

Migration `20261109151957_phase4_logistics`. Alle mit `company_isolation`.

| Tabelle                         | Inhalt                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `stock_levels` (erweitert)      | `batch`, `serial_number`, `best_before`; Index `stock_levels_slot` jetzt inkl. Charge und Seriennummer |
| `article_barcodes`              | Zusätzliche Barcodes je Artikel (eindeutig je Firma)                                                   |
| `pick_lists`, `pick_list_lines` | Picklisten mit Platz-/Chargenvorschlag und gepickter Menge                                             |
| `packing_devices`               | Für die PIN-Anmeldung freigegebene Lagerrechner (nur Token-Hash, widerrufbar; RLS Account + Firma)     |
| `packer_pins`                   | PIN je Person und Account (Argon2id, Fehlversuche, Sperre; RLS Account)                                |
| `packing_stations`              | Packplätze mit Einstellungen und optionalem Lager (`warehouse_id`, leer = alle Lager)                  |
| `shipments`                     | Sendungen mit Paketen, gepackten Positionen (inkl. Charge/SN), Etikett-PDF; **nicht löschbar**         |
| `returns`, `return_lines`       | Retouren mit Zustand je Position und Verweis auf die Gutschrift                                        |

Buchungsart `return` im Bestandsjournal ergänzt. Neue Nummernkreise `pick_list` (PL-), `shipment` (SE-), `return` (RT-).

## Tabellen (Phase 5)

Migrationen `…_phase5_import_api_channels` und `…_phase5_api_key_company`.

| Tabelle                                                               | Inhalt                                                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `job_queue` (global)                                                  | Hintergrundaufgaben (nur IDs)                                                                               |
| `import_jobs`, `import_job_records`, `import_templates`               | Importaufträge mit Zeilen, Zuordnung, Prüflauf, Fortschritt, Fehlern; was angelegt/geändert wurde; Vorlagen |
| `api_keys`                                                            | Schlüssel je Firma (Name, Präfix, Rechte, Ablauf, Sperre, letzte Nutzung)                                   |
| `api_key_index` (global)                                              | Hash → Schlüssel/Account/Firma für die Anmeldung                                                            |
| `sales_channels`, `channel_logs`, `channel_listings`, `external_refs` | Verkaufskanäle, Protokoll, Artikel je Kanal, Zuordnung externer IDs                                         |
| `sales_orders.channel_id`                                             | Herkunftskanal eines Auftrags                                                                               |

## Tabellen (Phase 6)

Migration `…_phase6_automation`.

| Tabelle                                                                     | Inhalt                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `outbox_events.company_id`                                                  | Firma des Ereignisses                                                                                          |
| `webhooks`, `webhook_deliveries`                                            | Abonnements (verschlüsselter Schlüssel, Ereignisse, Fehlerzähler) und Zustellungen (Status, Versuche, Antwort) |
| `workflow_rules`, `workflow_versions` (**unveränderlich**), `workflow_runs` | Regeln, Fassungen, Läufe mit Kontext und Schritten                                                             |
| `workflow_schedule` (global)                                                | Fälligkeiten zeitgesteuerter Regeln (nur IDs)                                                                  |

## Tabellen (Phase 7)

| Tabelle                | Ebene   | Inhalt                                                                                                            |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `subscriptions`        | Account | Abo: Paket, Intervall, Status, Laufzeit, Kündigung, geplanter Wechsel, Sperre, zusätzliche Firmen, Rechnungsdaten |
| `subscription_addons`  | Account | Zusatzmodule (`trial`, `active`, `canceled`) mit Testende und Laufzeitende                                        |
| `platform_invoices`    | Account | Rechnungen von FangEvo mit Positionen, Summen, PDF und Prüfsumme; Trigger erlaubt nur Status/Zahlungsdatum        |
| `support_tickets`      | Account | Support-Anfragen (Nummer `S-NNNNNN`, Kategorie, Priorität, Status)                                                |
| `support_messages`     | Account | Verlauf (nur anfügen)                                                                                             |
| `platform_counters`    | global  | Zähler für Rechnungs- und Ticketnummern                                                                           |
| `platform_accounts`    | global  | Verzeichnis für die Plattform-Verwaltung (Name, Inhaber-E-Mail, Paket, Status)                                    |
| `support_ticket_index` | global  | Postfach-Index für den Support (nur IDs, Status, Priorität)                                                       |

Migrationen: `phase7_commercial` (Tabellen, RLS, Trigger, Verzeichnis-Befüllung), `phase7_subscription_extras` (geplantes Intervall, Sperre, zusätzliche Firmen). Beide sind nicht-destruktiv. Accounts von vor Phase 7 erhalten ihr Abo beim ersten Aufruf automatisch aus der bestehenden Lizenz (Module außerhalb des Pakets werden als Zusatzmodule übernommen).

## Sicherung und Wiederherstellung (Phase 8)

Rolle `fangevo_backup` (nur lesen, `BYPASSRLS`) für `pg_dump`. Mit `fangevo_owner` bricht `pg_dump` wegen erzwungener RLS ab; das ist gewollt. Wiederherstellung mit der Administrator-Rolle in eine **neue** Datenbank. Skripte und Ablauf: [OPERATIONS.md](OPERATIONS.md), ADR-013. Für Prisma wird zusätzlich die Engine `debian-openssl-3.0.x` erzeugt (Produktions-Image).
