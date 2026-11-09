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
| Geheimnisse        | Nur über Umgebungsvariablen. `.env` ist in `.gitignore`. Produktion verbietet unsichere Einstellungen (deaktivierte Rate-Limits, Mailversand ohne SMTP)                                                                                                                                            |
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
