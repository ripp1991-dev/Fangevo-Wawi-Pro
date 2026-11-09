# ADR-001 – Architektur- und Technologieempfehlung

**Stand:** 2026-11-09 · **Status:** angenommen mit der Freigabe von Phase 1. Präzisiert durch ADR-002 (Authentifizierung), ADR-003 (Vite, vorläufig) und ADR-005 (Versionen).

Bewertet wird der Vorschlag aus Playbook Abschnitt 4.2. Wo ich davon abweiche, steht es ausdrücklich dabei, mit Begründung.

---

## 1. Gesamtarchitektur: modularer Monolith ✅ (wie Playbook)

**Empfehlung:** ein TypeScript-Monorepo (pnpm Workspaces + Turborepo) mit **einem** Backend-Prozess (API) und **einem** Worker-Prozess (Hintergrundjobs). Beide nutzen dieselben Module.

|               |                                                                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vorteile      | Eine Codebasis, ein Deployment, Transaktionen über Modulgrenzen ohne verteilte Systeme, schnelle Entwicklung, einfaches Debugging                                                                                                                                                         |
| Nachteile     | Module können „verkleben“, wenn die Grenzen nicht erzwungen werden                                                                                                                                                                                                                        |
| Gegenmaßnahme | Jedes Modul hat eine öffentliche Service-Schnittstelle. Zugriffe auf fremde Tabellen sind verboten und werden per Lint-Regel (Import-Grenzen) im CI geprüft. Module kommunizieren zusätzlich über **interne Domain-Events** (Outbox-Muster), sodass sie später ausgelagert werden können. |

## 2. Mandantentrennung – wichtigste Einzelentscheidung

**Empfehlung:** eine gemeinsame PostgreSQL-Datenbank, gemeinsames Schema, jede Geschäftstabelle trägt `account_id` und `company_id`. Zusätzlich **PostgreSQL Row-Level Security (RLS)** als zweite Sicherheitsebene.

| Variante                                    | Bewertung                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Eine Datenbank pro Kunde                    | sehr starke Trennung, aber bei Tausenden Kunden teuer und Migrationen werden zum Albtraum ❌                    |
| Ein Schema pro Kunde                        | ähnliche Probleme ab einigen Hundert Kunden ❌                                                                  |
| **Gemeinsames Schema + `account_id` + RLS** | skaliert auf Tausende Kunden, eine Migration für alle; RLS verhindert Datenlecks auch bei Programmierfehlern ✅ |

Umsetzung: Jede Anfrage läuft in einer Transaktion, die `app.account_id` / `app.company_id` setzt. RLS-Policies lassen nur passende Zeilen zu. Automatisierte Tests versuchen gezielt, fremde Mandantendaten zu lesen, und müssen dabei scheitern.
Große Enterprise-Kunden können später auf eine eigene Datenbank verschoben werden, ohne dass sich der Code ändert.

## 3. Backend: NestJS ✅ (wie Playbook)

|              |                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vorteile     | Modulsystem passt direkt zum modularen Monolithen; Dependency Injection, Guards (Rechte, Lizenzen) und Interceptors (Mandantenkontext) sind eingebaut; OpenAPI-Generierung; großer Talentpool |
| Nachteile    | Etwas schwergewichtig, Decorator-lastig                                                                                                                                                       |
| Entscheidung | NestJS mit **Fastify**-Adapter (schneller als Express). Validierung mit **Zod**, gemeinsam genutzt von Frontend und Backend.                                                                  |

## 4. Frontend: React + TypeScript + Tailwind ✅, aber **Vite statt Next.js** ⚠️ (Abweichung)

Die Warenwirtschaft ist eine Anwendung hinter einem Login. Suchmaschinen-Optimierung und serverseitiges Rendering, die Hauptstärken von Next.js, bringen dort kaum Nutzen. Next.js würde stattdessen eine zweite Server-Schicht neben NestJS schaffen (doppelte Authentifizierung, doppelte Logik, mehr Betriebsaufwand).

| Option                                               | Bewertung                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Next.js                                              | gut für Marketing-Website und Kundenportal, für die App unnötige Server-Schicht             |
| **Vite + React (SPA)** + TanStack Router/Query/Table | schlank, sehr schnelle Entwicklung, klare Trennung: das Frontend spricht nur mit der API ✅ |

**Empfehlung:** App (`apps/web`) mit Vite. Die spätere öffentliche Website bzw. der Marketplace-Katalog kann mit Next.js gebaut werden.
UI-Basis: **shadcn/ui** (auf Radix aufgebaut, also barrierearm, Code liegt im eigenen Repo) + eigenes Designsystem in `packages/ui`. Dashboard-Baukasten mit `react-grid-layout`, Tabellen mit TanStack Table (Spalten verschieben, ausblenden, gespeicherte Ansichten).

➡️ **Entscheidung durch FangEvo nötig.** Wenn Next.js gewünscht ist, ist das machbar, bedeutet aber mehr Komplexität.

## 5. Datenbank: PostgreSQL ✅ + Prisma ✅ (mit Auflagen)

- **PostgreSQL 16+**: transaktionssicher, JSONB für benutzerdefinierte Felder, RLS, Volltextsuche für den Start ausreichend.
- **Prisma 7**: typsicher, gut lesbare Migrationen als SQL-Dateien (Playbook-Regel 12: „Migrationen nachvollziehbar“).
  - Auflage 1: RLS-Kontext über eine Prisma-Client-Erweiterung pro Transaktion setzen.
  - Auflage 2: Komplexe Auswertungen (Bestände, Umsätze) dürfen gezielt **typisiertes SQL** nutzen.
  - Alternative: Drizzle ORM (näher an SQL). Nur wählen, wenn sich die RLS-Integration mit Prisma im Prototyp als zu umständlich erweist.
- **Geldbeträge** nie als Gleitkommazahl, sondern als `numeric` bzw. Ganzzahl in Cent. Rundungsregeln zentral.
- **Bestände als Buchungsjournal:** Jede Bewegung (Wareneingang, Verkauf, Umlagerung, Inventur) ist ein unveränderlicher Eintrag; der Bestand ergibt sich daraus (plus Zwischenspeicher für schnelle Abfrage). So ist jeder Bestand nachvollziehbar und revisionssicher.

## 6. Hintergrundverarbeitung: Redis + BullMQ ✅

Für Importe, Shop-Synchronisation, PDF-Erzeugung, Workflows, E-Mails und Webhooks. Wiederholungslogik, Rate-Limits pro Connector und Zeitplanung sind eingebaut.

## 7. Authentifizierung: eigene Bibliothek, kein Eigenbau der Kryptografie

| Option                                                          | Bewertung                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Vollständig selbst programmieren                                | hohes Sicherheitsrisiko ❌                                                                        |
| Externer Dienst (Auth0, Clerk)                                  | schnell, aber teuer pro Nutzer, Daten außerhalb, US-Anbieter (DSGVO) ⚠️                           |
| Keycloak (selbst betrieben)                                     | sehr mächtig, aber eigener Java-Dienst mit hohem Betriebsaufwand ⚠️                               |
| **Better Auth** (TypeScript-Bibliothek, in die API eingebettet) | E-Mail/Passwort, TOTP-MFA, Passkeys, Sessions, Einladungen; Daten bleiben in eigener Datenbank ✅ |

Rollen, Rechte und Firmenzuordnung baut FangEvo selbst (fachliche Logik). Später ist SSO (SAML/OIDC) für Enterprise-Kunden nachrüstbar.

## 8. Lizenzsystem – früher als im Playbook ⚠️ (Abweichung in der Reihenfolge)

Das Playbook sieht das Lizenzsystem in Phase 7. **Empfehlung:** Den **Kern** (Tabelle „Berechtigungen“: welches Modul, wie viele Firmen/Benutzer/Schnittstellen hat ein Account) schon in **Phase 1** bauen, ohne Zahlungsanbindung. Sonst müsste man später jedes Modul nachträglich mit Lizenzprüfungen versehen. Abonnements und Zahlung folgen in Phase 7 (Stripe Billing oder Mollie, beide mit SEPA-Lastschrift).

## 9. Dateien, Dokumente, PDF

- S3-kompatibler Speicher (lokal: MinIO; Produktion: z. B. Hetzner Object Storage oder AWS S3 Frankfurt). Getrennte Buckets für Bilder und Belege.
- PDF aus HTML-Vorlagen mit **Gotenberg** oder Playwright, als eigener Worker-Job.
- **Rechtlicher Hinweis (Deutschland):** Seit 2025 müssen Unternehmen E-Rechnungen empfangen können. Ab 2027 (Vorjahresumsatz über 800.000 €) bzw. 2028 (alle) müssen B2B-Rechnungen als **E-Rechnung (XRechnung / ZUGFeRD)** ausgestellt werden. Zusätzlich gelten die **GoBD**: unveränderbare Belege, lückenlose Nummernkreise, Aufbewahrung. Das gehört in die erste marktfähige Version und muss fachlich und rechtlich geprüft werden (Playbook Abschnitt 18).

## 10. Infrastruktur und Betrieb

- Docker + Docker Compose für die Entwicklung, CI über GitHub Actions (Lint, Typprüfung, Tests, Mandanten-Trenn-Tests).
- **Hosting in der EU** (DSGVO). Einstieg: Hetzner Cloud (Deutschland) oder AWS Frankfurt.
- Logging/Monitoring: strukturierte Logs (pino), OpenTelemetry, Sentry (EU-Region) oder selbst gehostet.
- Backups: tägliche PostgreSQL-Sicherung plus Point-in-Time-Recovery, Wiederherstellungstest monatlich.

### Grobe Betriebskosten (Schätzung, ohne Personal)

| Stufe                         | Annahme                                        | Hetzner (ca.)   | AWS Frankfurt managed (ca.) |
| ----------------------------- | ---------------------------------------------- | --------------- | --------------------------- |
| Entwicklung / Staging         | 1–2 Server, kleine DB                          | 30–80 €/Monat   | 150–300 €/Monat             |
| Pilotbetrieb (bis ~20 Kunden) | App + Worker + DB + Redis + Speicher + Backups | 100–300 €/Monat | 400–900 €/Monat             |
| Wachstum (Hunderte Kunden)    | mehrere App-Knoten, DB-Replikat                | ab ~800 €/Monat | ab ~2.500 €/Monat           |

Die Zahlen sind grobe Richtwerte und müssen mit echten Lasttests überprüft werden. Bei Hetzner sind managed Datenbanken eingeschränkt, das bedeutet mehr eigenen Betriebsaufwand.

## 11. Lokaler FangEvo Connector (Drucker, Waagen, Scanner)

Später als kleines Programm für Windows/macOS (Node oder Go), das sich per sicherer WebSocket-Verbindung beim Server anmeldet und Druckaufträge und Waagenwerte weiterreicht. Scanner funktionieren im Browser meist ohne Connector (Tastatur-Emulation). Erst in Phase 4 nötig.

## 12. Sicherheitsanforderungen (von Anfang an)

RLS-Mandantentrennung · MFA · Argon2-Passwort-Hashing · kurzlebige Sessions mit sicheren Cookies · CSRF-Schutz · Rechteprüfung serverseitig in jedem Endpunkt (Guards) · Lizenzprüfung serverseitig · Audit-Log für sicherheitskritische Aktionen · Rate-Limits · Upload-Prüfung (Typ, Größe, Virenscan) · Geheimnisse nur über Umgebungsvariablen / Secret-Manager · Abhängigkeits-Scans im CI.

## 13. Technische Risiken

| Risiko                                                        | Wirkung                                         | Gegenmaßnahme                                                                                       |
| ------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Umfang** – JTL und Afterbuy sind über viele Jahre gewachsen | Projekt wird nie „fertig“                       | Strikter Fokus auf die erste marktfähige Version (Playbook Abschnitt 27), Funktionsmatrix mit P0–P3 |
| Mandanten-Datenleck                                           | existenzbedrohend                               | RLS + automatisierte Tests + Code-Review                                                            |
| Marktplatz-APIs (Amazon, eBay …)                              | Zulassungsprozesse, Rate-Limits, API-Änderungen | Connector-Architektur zuerst, Integrationen erst nach Sandbox-Tests als fertig melden               |
| E-Rechnung / GoBD / Steuern                                   | Rechtsrisiko                                    | Früh Steuerberater bzw. Fachanwalt einbinden                                                        |
| Hardware-Anbindung Packtisch                                  | viele Gerätetypen                               | Pilotkunden-Hardware standardisieren                                                                |
| Performance bei großen Händlern                               | langsame Listen und Importe                     | Indizes, Paginierung, Hintergrundjobs, Lasttests ab Phase 3                                         |

## 14. Zusammenfassung der Empfehlung

| Bereich     | Empfehlung                                         | Abweichung vom Playbook                     |
| ----------- | -------------------------------------------------- | ------------------------------------------- |
| Architektur | Modularer Monolith, pnpm + Turborepo               | –                                           |
| Backend     | NestJS (Fastify), Zod, OpenAPI                     | –                                           |
| Frontend    | React + **Vite** + Tailwind + shadcn/ui + TanStack | **Vite statt Next.js** (Entscheidung offen) |
| Datenbank   | PostgreSQL + Prisma + **RLS**                      | RLS zusätzlich                              |
| Jobs        | Redis + BullMQ                                     | –                                           |
| Auth        | Better Auth + eigenes Rechtesystem                 | konkretisiert                               |
| Lizenz-Kern | ab Phase 1                                         | **früher**                                  |
| Hosting     | EU (Hetzner oder AWS Frankfurt)                    | konkretisiert                               |
