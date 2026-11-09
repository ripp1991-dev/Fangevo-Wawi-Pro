# Changelog

## [0.1.0] – 2026-11-09 – Phase 1: Technisches Fundament

### Hinzugefügt

- Monorepo (pnpm, Turborepo), TypeScript strict, ESLint mit Modulgrenzen, Prettier, Vitest, CI (GitHub Actions), Docker Compose für die Entwicklung.
- Datenbank: Kernschema mit Mandantentrennung per Row-Level Security, unveränderlichem Audit-Log, Lizenzhistorie und Sicherheitsereignissen.
- API (NestJS/Fastify): Registrierung mit E-Mail-Bestätigung, Login, Zwei-Faktor (TOTP + Wiederherstellungscodes), Sitzungsverwaltung, Passwort vergessen/ändern, Account-Wechsel, Firmen, Benutzer und Einladungen, Rollen und Einzelrechte, Firmenzugriff, Lizenz-Kern (Module, Limits, Testphase, Nur-Lese-Modus), Audit-Log, Health-Check, OpenAPI.
- Sicherheit: CSRF-Schutz, Rate-Limits, Schutz gegen Rechteausweitung, Helmet, Log-Redaktion.
- Web-App: Anmeldeseiten, App-Rahmen mit Navigation, Account- und Firmenwechsler, Hell-/Dunkelmodus, responsiv, Verwaltung von Firmen, Benutzern, Rollen, Audit-Log, Lizenz, Account sowie Profil & Sicherheit.
- Designsystem-Grundlage `@fangevo/ui`.
- 73 automatisierte Tests inkl. Pflicht-Testsuite zur Mandantentrennung, Browser-E2E-Test.
- Dokumentation: README, ARCHITECTURE, DATABASE, API, SECURITY, LICENSING, MODULES, TESTING, DECISIONS.

### Behoben (während der Entwicklung durch Tests gefunden)

- `RATE_LIMIT_DISABLED=false` wurde als „aktiv“ gelesen und hätte den Brute-Force-Schutz abgeschaltet.
- Nach dem Login leitete der Routen-Schutz wegen veralteter Sitzungsdaten zurück zum Login.
- Der E-Mail-Bestätigungslink wurde im Entwicklungsmodus doppelt gesendet und dadurch als ungültig angezeigt.
- Der Einladungsdialog konnte ohne vorausgewählte Rolle öffnen.
- Sicherheitsupdates für fastify, nodemailer, @fastify/static und indirekte Abhängigkeiten.

## [0.0.1] – 2026-11-09 – Phase 0: Bestandsaufnahme

- Master Playbook, Systemanalyse, JTL-/Afterbuy-Checkliste, Technologieempfehlung (ADR-001), Entwicklungsplan.
