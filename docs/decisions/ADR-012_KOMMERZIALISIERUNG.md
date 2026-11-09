# ADR-012 – Kommerzialisierung: Abo, Abrechnung, Marketplace, Support, Plattform-Verwaltung

**Stand:** 2026-11-09 · **Status:** angenommen (Preise und Steuerbehandlung vorläufig)

## Kontext

Playbook 6 und 21 verlangen buchbare Pakete und Zusatzmodule, Testphasen, Rechnungen, ein Kundenportal, Support und eine Verwaltung für FangEvo. Bis Phase 6 wurden Lizenzen nur über ein Kommandozeilen-Werkzeug gesetzt. Ein Zahlungsanbieter (Stripe, Mollie) ist noch nicht entschieden; Zugangsdaten liegen nicht vor.

## Entscheidung

1. **Das Abo ist die Quelle der Lizenz.** Je Account gibt es ein Abo (`subscriptions`: Paket, monatlich/jährlich, Status `trialing | active | past_due | canceled`, Laufzeit, Kündigung zum Laufzeitende, geplanter Wechsel, Sperre, zusätzliche Firmen) und Zusatzmodule (`subscription_addons`: `trial | active | canceled`). Die Lizenz (`entitlements`) wird daraus mit der reinen Funktion `computeEntitlement` (`packages/licensing/src/billing.ts`) berechnet. API, Plattform-Verwaltung und das Kommandozeilen-Werkzeug nutzen dieselbe Funktion. Jede Änderung landet in der Lizenz-Historie und im Audit-Log.
2. **Regeln:**
   - Testphase 14 Tage (Paket frei wählbar, keine Rechnung).
   - Hochstufen gilt sofort, mit anteiliger Rechnung bis zum Laufzeitende (ganze Tage, Beträge in Cent, keine Gleitkommazahlen).
   - Herabstufen und der Wechsel zwischen monatlich und jährlich gelten zum Laufzeitende.
   - Jahrespreis = 10 Monatspreise.
   - Zusatzmodule: beim ersten Buchen 14 Tage Testversion, danach automatisch kostenpflichtig (anteilig).
   - Kündigung: Testversion sofort, bezahlte Module zum Laufzeitende.
   - Module, die durch einen Paketwechsel enthalten sind, entfallen als Zusatzmodul, mit Gutschrift für die Restlaufzeit.
3. **Zahlungsverzug sperrt nicht sofort** (Playbook 6.3). Ist eine Rechnung überfällig, gilt `past_due` (voller Zugriff). Nach mehr als 30 Tagen Verzug wird der Account `SUSPENDED` (nur lesen). Gekündigte Abos enden zum Laufzeitende mit `CANCELED` (nur lesen). Daten werden nie gelöscht. Abo und Rechnungen bleiben im Lesemodus bedienbar, damit Kunden wieder aktivieren können.
4. **Rechnungen von FangEvo** (`platform_invoices`):
   - Fortlaufende Nummer `FE-JJJJ-NNNNNN` über den globalen Zähler `platform_counters`.
   - PDF mit dem bestehenden Beleg-Layout (§ 14 UStG) und SHA-256-Prüfsumme.
   - Unveränderlich per Datenbank-Trigger: nur Status und Zahlungsdatum dürfen sich ändern, Löschen ist nicht möglich.
   - Versand per E-Mail mit PDF nach erfolgreichem Abschluss der Transaktion.
   - Zahlart zunächst nur **Rechnung/Überweisung**. Der Zahlungseingang wird in der Plattform-Verwaltung markiert.
   - In Produktion werden ohne vollständige Absenderdaten (`PLATFORM_ISSUER_*`) keine Rechnungen erstellt (Fehler `BILLING_NOT_CONFIGURED`). In Entwicklung tragen sie den Hinweis „TESTRECHNUNG“.
5. **Umsatzsteuer (vorläufig, Steuerberater):**
   - DE: 19 %
   - EU mit USt-IdNr.: 0 % (Reverse Charge)
   - EU ohne USt-IdNr.: 19 %
   - Drittland: 0 %
6. **Abrechnungslauf** im Worker alle 15 Minuten. Er ist idempotent durch eine Zeilensperre auf dem Abo (`FOR UPDATE`) und holt ausgefallene Zeiträume nach. Er übernimmt die Umstellung abgelaufener Testversionen, Verlängerungen mit Rechnung, Kündigungsende und Zahlungsverzug. Er iteriert über das globale Verzeichnis `platform_accounts` (nur Name, E-Mail des Inhabers, Paket, Status) und arbeitet je Account im Mandantenkontext.
7. **Marketplace:** Katalog `MODULE_DETAILS` (Beschreibung, vorläufiger Preis, Version). Marketplace ist in jedem Paket enthalten.
8. **Support:**
   - Tickets und Nachrichten liegen beim Account (RLS).
   - Das Support-Team sieht über den globalen Index `support_ticket_index` nur IDs und Status. Es öffnet ein Ticket gezielt im Kontext des Accounts.
   - Neue Anfragen und Antworten gehen per E-Mail an `SUPPORT_EMAIL`. Antworten des Supports erzeugen eine Benachrichtigung und eine E-Mail an die anfragende Person.
9. **Plattform-Verwaltung** (`/platform/*`):
   - Nur für Personen, deren E-Mail in `PLATFORM_ADMIN_EMAILS` steht (einzelne Adressen oder `@domain`).
   - Zwei-Faktor-Anmeldung ist Pflicht. Kein Zugriff über API-Schlüssel.
   - Funktionen: Accounts suchen, Lizenz/Abo ändern ohne Rechnung (Paket, Laufzeit, zusätzliche Firmen, Testphase verlängern, sperren, ohne Rechnung aktivieren), Rechnungen als bezahlt markieren, Support beantworten, Abrechnungslauf auslösen.
   - Änderungen werden mit `platform:<E-Mail>` protokolliert.
10. Neue Rechte `billing.manage` (Abo und Rechnungen) und `support.manage` (Anfragen). Beide sind nur für Administratoren und Inhaber, nicht für API-Schlüssel.

## Konsequenzen

- (+) Kunden buchen, wechseln und kündigen selbst; FangEvo sieht Zahlungsstand und Support an einer Stelle.
- (+) Eine Stelle berechnet die Lizenz; Lizenz und Abo können nicht auseinanderlaufen.
- (−) Ohne Zahlungsanbieter kein Lastschrift-/Kartenzahlungseinzug. Die Anbindung folgt nach Entscheidung von FangEvo und mit Sandbox-Zugang, als weitere Zahlart neben „Rechnung“.
- (−) Preise, Steuerbehandlung (OSS) und Rechnungstexte müssen vor dem Verkaufsstart fachlich bestätigt werden.
- (−) Stornorechnungen für Plattform-Rechnungen sind noch nicht umgesetzt. Bis dahin werden Korrekturen manuell gutgeschrieben.
