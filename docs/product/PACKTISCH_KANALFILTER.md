# Arbeitspaket: Packtisch nach Verkaufskanal filtern

**Stand:** 2026-11-10 · **Status:** umgesetzt auf Branch `feat/packing-rules-channel-category`. Typprüfung, Lint, Web-Build und Regel-Unit-Tests sind grün. Die API-Integrationstests (`phase4.test.ts`, brauchen PostgreSQL + Redis) sind noch nicht gelaufen.

**Erweitert um Kategorien (Entscheidung FangEvo):** Packregeln je Packplatz kombinieren Kanal und Kategorie.

- „Nur Kategorien“: Aufträge, deren Artikel **alle** aus diesen Kategorien stammen (inkl. Unterkategorien).
- „Ohne Kategorien“: blendet reine Aufträge dieser Kategorien aus. Gemischte Aufträge bleiben sichtbar, zum Beispiel für einen Allround-Platz.
- Festlegung: Ein festgelegter Platz verhindert „auch andere Kanäle anzeigen“.
- Die Packplatz-Auswahl merkt sich der Browser je Arbeitsplatz. Feste Zuordnung je Mitarbeiter ist bewusst noch nicht enthalten.
  **Wunsch FangEvo:** Am Packtisch gezielt nur die Aufträge einer Plattform packen, z. B. „nur Shopify“, „nur Amazon“ oder „nur Kaufland“.

## Ausgangslage

- **JTL:** Der JTL-Packtisch+ 2.0.4 kann nur nach Versandart, Firma, Lieferbarkeit und Auftragsart filtern, nicht nach Plattform. Das ist der Grund für dieses Arbeitspaket.
- **FangEvo hat die Grundlage schon:**
  - Jeder Auftrag kennt seinen Verkaufskanal (`sales_orders.channel_id`, seit Phase 5).
  - Der Packtisch (`modules/logistics/packing.service.ts`, `pages/wawi/packing.tsx`) arbeitet heute nur per Scan der Auftragsnummer. Eine Liste der Aufträge, die zum Packen bereitstehen, gibt es dort nicht.
  - Picklisten (`picking.service.ts`, `pages/wawi/picking.tsx`) werden aus einer Auftragsliste ohne Kanalfilter erstellt.

## Ziel aus Sicht des Packers

1. Am Packplatz gibt es oben die Kanal-Reiter **Alle · Shopify (12) · Amazon (30) · Kaufland (4) · Ohne Kanal (1)**, jeweils mit der Zahl der offenen Pakete.
2. Darunter steht die Warteschlange der packbereiten Aufträge, die zum gewählten Kanal gehören, die ältesten zuerst.
3. Scannt der Packer einen Auftrag aus einem anderen Kanal, erscheint ein deutlicher Hinweis („Dieser Auftrag ist von Amazon, gewählt ist Shopify“). Je nach Einstellung des Packplatzes ist das nur eine Warnung oder eine Sperre.
4. Ein Packplatz kann einen festen Standard-Kanal haben, zum Beispiel „Packplatz 2 = nur Amazon“.
5. Picklisten lassen sich ebenfalls pro Kanal erstellen. So passen Kommissionierung und Packen zusammen.

## Umsetzung (klein, ohne Datenbank-Migration)

| #   | Teil                  | Änderung                                                                                                                                                                                          |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | API Aufträge          | `ORDER_FIELDS` bekommt `channelId` als Filter (Enum, inklusive „ohne Kanal“). Die Auftragsliste liefert zusätzlich `channelName`.                                                                 |
| 2   | API Packtisch         | Neu: `GET /packing/queue?channelIds=…` liefert packbereite Aufträge (Status aus `ORDER_SHIPPABLE`) mit Kanalname und Zählern je Kanal. Rechte wie beim bestehenden Packen.                        |
| 3   | API Packtisch         | `prepare()` liefert zusätzlich `order.channelId` und `order.channelName`.                                                                                                                         |
| 4   | Packplatz-Einstellung | `packing_stations.settings` (JSON, schon vorhanden) bekommt `channelIds: string[]` und `channelMismatch: "warn" \| "block"`. Beim Speichern wird geprüft, dass die Kanäle zur Firma gehören.      |
| 5   | API Packen            | `complete()` lehnt bei `channelMismatch = "block"` Aufträge aus fremden Kanälen ab (409, klarer Text). Die Prüfung läuft serverseitig.                                                            |
| 6   | Oberfläche Packtisch  | Kanal-Reiter, Warteschlange, Hinweis bei fremdem Kanal, Kanalwahl in den Packplatz-Einstellungen.                                                                                                 |
| 7   | Oberfläche Picklisten | Kanalfilter in „Neue Pickliste“.                                                                                                                                                                  |
| 8   | Tests                 | Filter je Kanal, „ohne Kanal“, Zähler, Sperre bei fremdem Kanal, ungültige Kanal-IDs beim Speichern, **Mandanten-Trenntest** (Kanäle und Aufträge anderer Firmen nie sichtbar), e2e am Packtisch. |
| 9   | Doku                  | API.md, MODULES.md, CHANGELOG.md, TESTING.md, Roadmap-Status.                                                                                                                                     |

## Bewusst nicht enthalten

- Plattform-Anbindungen an Shopify, Amazon und Kaufland selbst. Die Kanäle sind in FangEvo heute vom Typ `api`, weitere Typen kommen erst nach einem Sandbox-Test. Der Filter funktioniert mit jedem angelegten Kanal, unabhängig vom Typ.
- Gruppierung mehrerer Kanäle zu einer „Plattform“, z. B. Kaufland.de und Kaufland.at als „Kaufland“. Im ersten Schritt ist eine Mehrfachauswahl von Kanälen möglich. Feste Gruppen kommen nur, wenn das im Pilotbetrieb fehlt.

## Offene Frage an FangEvo

- Soll ein Auftrag aus einem fremden Kanal am Packplatz standardmäßig nur **gewarnt** oder **gesperrt** werden? Vorschlag: warnen.
