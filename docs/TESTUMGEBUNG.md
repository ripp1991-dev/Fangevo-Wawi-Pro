# Testumgebung FangEvo Wawi Pro

Eine Testumgebung, die sich wie der spätere Betrieb verhält: dieselben Produktions-Abbilder (API, Hintergrund-Worker, Web mit nginx), eine eigene Datenbank und realistische Testdaten. Sie läuft auf einem Rechner mit Docker, getrennt von der Entwicklungsumgebung.

**Adresse:** http://localhost:8080 · **E-Mails** (Registrierung, Passwort vergessen): http://localhost:8025 (Mailpit)

> Nur Testdaten. Die Kunden sind ausgedacht. Keine echten Kunden- oder Zahlungsdaten eintragen.

## Was drin ist

| Bereich        | Testdaten                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firma          | FangEvo Test GmbH mit Adresse, Steuernummer und Bank (damit Rechnungen festgeschrieben werden können)                                                                                                                                                                                                                                                                                                                                                                              |
| Artikel        | **Echtes Sortiment:** die 150 meistverkauften Produkte aus dem Shopify-Bericht „Gesamtumsatz nach Produkt“ (Titel, Hersteller, Durchschnittspreis netto), automatisch in Kategorien sortiert (Süßwaren → Lakritz/Schokolade/Fruchtgummi/Bonbons/Gebäck, Chips & Snacks, Getränke, Lebensmittel → Hot Dogs/Marmelade, Kühlware → Eis). Artikelnummern (NFS-0001 …), EAN und Bestand sind Testwerte; dazu 3 Eis-Testartikel für den Kühlware-Platz. Ohne Bericht: 18 Beispielartikel |
| Lieferanten    | 3 Testlieferanten                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Verkaufskanäle | Shopify, Amazon, eBay, Kaufland.de, Kaufland.at, Temu (Bestellungen kommen über die Kanal-Schnittstelle wie von echten Shops)                                                                                                                                                                                                                                                                                                                                                      |
| Aufträge       | ca. 40 in allen Ständen: neu, in Bearbeitung, auf Pickliste, versandbereit, versendet mit Lieferschein und Rechnung. Die Artikel verteilen sich nach den echten Verkaufszahlen; Kunden sind ausgedacht                                                                                                                                                                                                                                                                             |
| Packplätze     | Platz 1 Shopify · Platz 2 Marktplätze ohne Kühlware · Platz 3 nur Kühlware (sperrt fremde Aufträge) · Platz 4 Rest/Gemischt                                                                                                                                                                                                                                                                                                                                                        |
| Sonstiges      | eine offene Pickliste, eine angemeldete Retoure                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Testablauf (ca. 20 Minuten)

1. **Anmelden** mit den Zugangsdaten aus `TESTUMGEBUNG-LOGIN.txt` (liegt neben dem Repository, nicht eingecheckt).
2. **Aufträge:** Links im Statusbaum „Versandbereit“ wählen, dann unter „Offen nach Kanal“ z. B. „Amazon“. Einen Auftrag anklicken → unten erscheinen die Positionen. „Auftrag öffnen“ zeigt alle Details.
3. **Kommissionierung:** Pickliste PL-000001 öffnen, Entnahmen bestätigen, abschließen. Die Aufträge gehen in „Verpackung“.
4. **Packtisch:** Packplatz „Platz 1 – Shopify“ wählen. Die Warteschlange zeigt nur Shopify-Aufträge. „Packen“ klicken, Artikel scannen (EAN oder Artikelnummer eintippen) oder mit „+“ hinzufügen, Gewicht eintragen, „Packen abschließen“. Lieferschein, Rechnung und Etikett lassen sich als PDF öffnen.
5. **Packregeln testen:** „Platz 3 – Kühlware“ wählen und einen Schokoladen-Auftrag scannen → wird gesperrt.
6. **Belege:** Unter „Belege“ Rechnungen ansehen, eine Rechnung als bezahlt markieren.
7. **Retoure:** RT-000001 öffnen, Eingang buchen („wieder verkaufbar“), Gutschrift erstellen. Der Bestand steigt wieder.
8. **Packregeln ändern:** Packtisch → Packplätze → „Bearbeiten“: Kanäle und Kategorien umstellen und die Warteschlange beobachten.

Was auffällt oder fehlt, bitte notieren (Bildschirmfoto + kurzer Satz). Das ist die wichtigste Eingabe für die nächsten Schritte.

## Eigene Artikel aus JTL übernehmen

1. In JTL-Wawi unter **Artikel (F2)** die Artikelliste als CSV/Excel exportieren (oder über die JTL-Ameise: Export → Artikel).
2. In FangEvo **Import → Artikel** die Datei hochladen, die Spalten zuordnen (Artikelnummer, Name, EAN, Kategorie, VK netto, EK netto, Gewicht) und die Zuordnung als Vorlage speichern.
3. **Prüflauf** ansehen (Fehler je Zeile), dann ausführen. Bei Fehlern lässt sich der Import rückgängig machen.

Kunden- oder Auftragsdaten aus JTL werden für die Testumgebung **nicht** übernommen.

## Bedienung für Technik

Alle Befehle im Ordner des Repositorys, Docker Desktop muss laufen.

```bash
# Starten (baut die Abbilder beim ersten Mal, dauert einige Minuten)
docker compose -p fangevo-test -f infrastructure/production/docker-compose.yml --env-file .env.testumgebung up -d --build --wait

# Stoppen (Daten bleiben erhalten)
docker compose -p fangevo-test -f infrastructure/production/docker-compose.yml --env-file .env.testumgebung stop

# Komplett zurücksetzen (löscht alle Testdaten!)
docker compose -p fangevo-test -f infrastructure/production/docker-compose.yml --env-file .env.testumgebung down -v
```

`.env.testumgebung` entsteht aus `infrastructure/production/env.production.example` mit zufälligen Passwörtern, `WEB_ORIGIN=http://localhost:8080`, `SMTP_HOST=host.docker.internal`, `SMTP_PORT=1025`. Mailpit läuft über `infrastructure/docker/docker-compose.yml`.

**Testdaten neu laden** (nach dem Zurücksetzen):

```bash
FANGEVO_BASE=http://localhost:8080 MAILPIT=http://localhost:8025 \
LICENSE_CMD="docker compose -p fangevo-test -f infrastructure/production/docker-compose.yml --env-file .env.testumgebung run --rm --no-deps migrate pnpm exec tsx scripts/license-set.ts --account {account} --plan professional" \
node scripts/demo-data.mjs ../TESTUMGEBUNG-LOGIN.txt
```

Das Skript legt ein neues Konto an (Paket Professional), schreibt die Zugangsdaten in die angegebene Datei und erzeugt alle Testdaten über die normale API. Mit `PRODUCTS_CSV=<Shopify-Bericht „Gesamtumsatz nach Produkt“ als CSV>` (optional `PRODUCTS_LIMIT=150`) wird das echte Sortiment übernommen. Der Bericht enthält nur Produktdaten, keine Kunden. Die Datei bleibt lokal und gehört nicht ins Repository. Das Anfrage-Limit der API bremst das Skript; ein Lauf dauert einige Minuten.

## Grenzen der Testumgebung

- Kein echter Versand an DHL/DPD/GLS: Es gibt eigene Etiketten (PDF) und manuelle Trackingnummern.
- Keine echten Marktplatz-Anbindungen: Die Kanäle sind Test-Schnittstellen, Bestellungen kommen per Skript.
- Läuft nur auf diesem Rechner. Für Zugriff im Team braucht es einen Server (siehe `OPERATIONS.md`, `PILOT.md`).
