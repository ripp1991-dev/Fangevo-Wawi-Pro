# Sicherheit

Stand: Phase 1. Sicherheit ist Teil der Architektur (Playbook Abschnitt 21).

## Umgesetzt

| Bereich            | Maßnahme                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mandantentrennung  | PostgreSQL Row-Level Security mit `FORCE`, Laufzeit-Rolle ohne `BYPASSRLS`, Kontext nur pro Transaktion. Pflicht-Testsuite auf API- und Datenbankebene                                                                                                                                            |
| Passwörter         | Argon2id (19 MiB, 2 Iterationen), mindestens 12 Zeichen, gleiche Antwortzeit für unbekannte Benutzer                                                                                                                                                                                              |
| Sitzungen          | Zufälliges 256-Bit-Token im HttpOnly-Cookie (SameSite=Lax, `Secure` in Produktion), in der DB nur als SHA-256-Hash. Ablauf nach 7 Tagen bzw. 12 h Inaktivität. Widerruf bei Logout, Passwortänderung/-reset, MFA-Aktivierung und Sperrung des Mitglieds. Übersicht und Abmeldung einzelner Geräte |
| Zwei-Faktor        | TOTP (RFC 6238) per Authenticator-App, Secret AES-256-GCM-verschlüsselt (`APP_ENCRYPTION_KEY`), 10 einmalige Wiederherstellungscodes (gehasht). Deaktivieren nur mit Passwort                                                                                                                     |
| Einmal-Tokens      | E-Mail-Bestätigung (48 h), Passwort-Reset (1 h), Einladung (7 Tage): nur Hash gespeichert, atomar einmal verwendbar                                                                                                                                                                               |
| Benutzer-Erkennung | Registrierung, „Passwort vergessen“ und Login verraten nicht, ob eine E-Mail existiert                                                                                                                                                                                                            |
| Rechte             | Serverseitige Prüfung jeder Route im zentralen `AccessGuard`. Schutz gegen Rechteausweitung: nur eigene Rechte und Firmen können vergeben werden. Systemrollen unveränderlich. Letzter Inhaber geschützt                                                                                          |
| Lizenz             | Serverseitige Prüfung (Module, Limits). Gesperrte Accounts: nur lesen, keine Datenlöschung                                                                                                                                                                                                        |
| CSRF               | Pflicht-Header `x-fangevo-csrf` für schreibende Anfragen + SameSite-Cookies + CORS nur für `WEB_ORIGIN`                                                                                                                                                                                           |
| Rate-Limits        | Global 600 Anfragen/min je IP; Login 10 Versuche/15 min je E-Mail und 50 je IP; Registrierung, Reset, MFA und Einladungen eigene Limits (Redis)                                                                                                                                                   |
| Eingaben           | Zod-Validierung aller Eingaben, Body-Limit 1 MB, Prisma (parametrisierte Abfragen), UUID-Prüfung des Mandantenkontexts                                                                                                                                                                            |
| Ausgaben           | Problem-Details ohne interne Fehlerdetails. React escaped Ausgaben (XSS)                                                                                                                                                                                                                          |
| Header             | Helmet (u. a. CSP, HSTS, X-Frame-Options)                                                                                                                                                                                                                                                         |
| Protokolle         | Audit-Log je Account und Sicherheitsereignisse je Benutzer, unveränderlich per Trigger. Log-Redaktion von Cookies, Passwörtern, Tokens und Codes                                                                                                                                                  |
| Geheimnisse        | Nur über Umgebungsvariablen. `.env` ist in `.gitignore`. Produktion verbietet unsichere Einstellungen (deaktivierte Rate-Limits, Mailversand ohne SMTP)                                                                                                                                           |
| Abhängigkeiten     | Versionen fest gepinnt, mindestens 2 Wochen alt. `pnpm audit` (high) in der CI. Swagger-UI in Produktion abgeschaltet                                                                                                                                                                             |

## Bekannte offene Punkte

| Punkt                                                                                         | Bewertung / Plan                                                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm audit`: 2 mittlere Funde in `glob`/`minimatch` (über `@fastify/static`, nur Swagger-UI) | Die Swagger-UI ist in Produktion abgeschaltet. Update, sobald die korrigierten Versionen 2 Wochen alt sind |
| Virenscan für Uploads                                                                         | Es gibt noch keine Datei-Uploads; kommt mit Dateispeicher (Phase 3)                                        |
| Backups / Wiederherstellungstests                                                             | Teil der Infrastruktur vor Pilotbetrieb (Phase 8)                                                          |
| Löschkonzept DSGVO (Fristen, Export, Löschung personenbezogener Daten)                        | Muss fachlich definiert werden, bevor Kundendaten (Phase 3) verarbeitet werden                             |
| SSO (SAML/OIDC) für Enterprise                                                                | Später                                                                                                     |
| Externer Penetrationstest                                                                     | Vor Go-live (Phase 8)                                                                                      |
| Zugriffskontext wird pro Anfrage aus der DB geladen                                           | Sicher und aktuell. Caching erst nach Lasttests (Änderungen an Rechten wirken derzeit sofort)              |

## Schwachstellen melden

Bitte nicht öffentlich als Issue melden, sondern direkt an das FangEvo-Team.

## Ergänzungen Phase 2

| Bereich                 | Maßnahme                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Hintergrundverarbeitung | Worker verarbeitet jedes Ereignis mit Mandantenkontext (RLS); die globale Warteschlange enthält nur IDs                                    |
| Benachrichtigungen      | RLS beschränkt zusätzlich auf den eigenen Benutzer                                                                                         |
| Neue Geräte             | Anmeldung mit unbekanntem Browser → E-Mail und Benachrichtigung                                                                            |
| Listen                  | Filter und Sortierung nur auf freigegebenen Feldern; keine beliebigen Spaltennamen aus dem Browser                                         |
| Suche                   | Eingaben werden auf Buchstaben/Ziffern reduziert, bevor sie in eine Volltextabfrage gehen; parametrisierte SQL-Abfrage; Rate-Limit 120/min |
| Eigene Felder           | Serverseitige Typprüfung; Verweise nur auf Datensätze im eigenen Mandanten                                                                 |
| CSV-Export              | Zellen, die mit `=`, `+`, `-`, `@` beginnen, werden entschärft (Schutz gegen Formel-Einschleusung in Excel)                                |
| Dashboards              | Widgets ohne passendes Recht werden serverseitig entfernt; Vorlagen übernehmen keine persönlichen Notizen                                  |

## Ergänzungen Phase 3a

| Bereich        | Maßnahme                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Firmentrennung | RLS prüft Account **und** Firma; Firmenkontext nur aus dem geprüften Header `X-Company-Id`; Tests auf API- und DB-Ebene          |
| Preise         | Einkaufspreise nur mit `articles.prices` sichtbar und änderbar (auch in Listen, Sortierung, Filtern, Lieferanten-Artikeln)       |
| Bestand        | Unveränderliches Journal, Sperre der Bestandszeile gegen gleichzeitige Buchungen (Test mit 20 parallelen Abgängen)               |
| Nummern        | Lückenlos und eindeutig je Firma                                                                                                 |
| JTL-Daten      | Export nur lesend, nur Artikeldaten, keine personenbezogenen Daten; Exportdateien per `.gitignore` vom Repository ausgeschlossen |

## Ergänzungen Phase 3b

| Bereich               | Maßnahme                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Preise und Summen     | Werden immer serverseitig berechnet (Decimal, kaufmännisch gerundet); der Client liefert höchstens einen gewünschten Einzelpreis (Recht `orders.manage`)                       |
| Belege (GoBD)         | Nummer erst beim Festschreiben, lückenlos; festgeschriebene Belege per Trigger unveränderlich (nur Zahlungsstatus und Versanddatum änderbar), Löschen verboten                 |
| Beleg-PDF             | Unveränderlich gespeichert mit SHA-256; beim Abruf wird die Prüfsumme kontrolliert                                                                                             |
| Zahlungen, Eingänge   | Tabellen `payments`, `goods_receipts`, `order_status_history`, `document_files` nur `SELECT, INSERT` für die App-Rolle, zusätzlich Trigger gegen Ändern/Löschen                |
| Bestand bei Aufträgen | Reservierung nach Anlage-Reihenfolge; Versand nutzt die Zeilensperre des Bestandsjournals; doppelter Versand desselben Auftrags wird verhindert (Test mit parallelen Anfragen) |
| E-Mail-Versand        | Nur festgeschriebene Belege; Empfängeradresse geprüft; Versand wird im Audit-Log festgehalten                                                                                  |
| Logo                  | Nur PNG/JPEG als data-URL, max. ca. 200 KB, Inhalt wird nicht ins Audit-Log geschrieben                                                                                        |
| Rechteweitergabe      | Rechte nicht gebuchter Module nur weitergeben, wer sie selbst (ohne Lizenzfilter) besitzt                                                                                      |

## Ergänzungen Phase 4

| Bereich       | Maßnahme                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Packen        | Vollständigkeit, fremde Artikel und doppelte Seriennummern werden auf dem Server geprüft, nicht nur in der Oberfläche |
| Seriennummern | Je Artikel höchstens einmal im Bestand (Service-Prüfung + CHECK-Regel)                                                |
| Sendungen     | Nicht löschbar (Trigger); Etiketten nur mit Firmenkontext abrufbar                                                    |
| Retouren      | Höchstens die versendete Menge; Gutschrift nur mit zusätzlichem Recht `documents.manage`                              |
| Kamera        | Zugriff nur nach Freigabe im Browser; die Erkennung läuft lokal (BarcodeDetector), Bilder verlassen das Gerät nicht   |

## Ergänzungen Phase 5

| Bereich       | Maßnahme                                                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-Schlüssel | Nur SHA-256-Hash gespeichert, einmalige Anzeige, nur Fachrechte (keine Administration), Schnittmenge mit den aktuellen Rechten der anlegenden Person, an eine Firma gebunden, Ablaufdatum, Sperren, 600 Anfragen/Minute, letzte Nutzung mit IP |
| CSRF          | Nur Anfragen mit API-Schlüssel und ohne Cookie sind vom CSRF-Header ausgenommen                                                                                                                                                                |
| Import        | Max. 10 MB und 50.000 Zeilen; nur CSV/XLSX; Größenlimit nur für den Upload-Endpunkt erhöht; Ausführung mit den aktuellen Rechten der Person über die Fach-Services                                                                             |
| Export (CSV)  | Schutz gegen Formel-Einschleusung; Einkaufspreise nur mit `articles.prices`                                                                                                                                                                    |
| Kanäle        | Externe Bestellnummer je Kanal eindeutig (DB-Index), Fehler werden protokolliert; Hintergrundtabellen `job_queue` und `api_key_index` enthalten nur IDs/Hashes                                                                                 |
