# ADR-007 – Firmentrennung per RLS und Bestandsjournal

**Stand:** 2026-11-09 · **Status:** angenommen

## Kontext

Ab Phase 3 gibt es Fachdaten (Artikel, Kunden, Lieferanten, Lager), die laut Playbook 5.2 **je Firma** getrennt sind. FangEvo hat bestätigt: getrennte Daten je Firma, gemeinsam genutzte Artikel sind derzeit nicht nötig. Bestände müssen nachvollziehbar und revisionssicher sein (Playbook-Regel: „Bestände nur über das Bestandsjournal ändern“).

## Entscheidung

1. **Firmentrennung in der Datenbank:** Fachtabellen tragen `account_id` **und** `company_id`. Die RLS-Policy `company_isolation` verlangt `account_id = app_current_account() AND company_id = app_current_company()`. Die API setzt `app.company_id` aus dem geprüften Header `X-Company-Id` (`CompanyDb.run`). Ohne Firmenkontext sind Fachtabellen leer.
2. **Standardwerte je Firma** (Steuersätze 19/7/0 %, Kundengruppen, Hauptlager, Nummernkreise) werden beim ersten Zugriff in einer **eigenen Transaktion** angelegt, gesichert gegen gleichzeitige Erstzugriffe.
3. **Bestandsjournal:** `stock_movements` ist unveränderlich (Trigger + nur `SELECT/INSERT` für die App-Rolle). `stock_levels` ist der fortgeschriebene Stand und wird nur zusammen mit einer Journalbuchung geändert. Die Bestandszeile wird per `UPDATE … RETURNING` gesperrt, sodass parallele Buchungen nacheinander laufen. Minusbestand ist je Firma einstellbar (Standard: aus).
4. **Geld und Mengen:** `numeric(19,4)` in der Datenbank, Übertragung als Text, Rechnen mit Decimal. Keine Gleitkommazahlen.
5. **Nummernkreise:** lückenlos über eine gesperrte Zeile je Firma und Kreis. Eine gescheiterte Transaktion verbraucht keine Nummer.

## Konsequenzen

- (+) Selbst ein Programmierfehler kann keine Daten einer anderen Firma zeigen. Abgesichert durch Tests auf API- und Datenbankebene.
- (+) Jeder Bestand lässt sich aus dem Journal nachvollziehen; Korrekturen erfolgen nur durch neue Buchungen.
- (−) Firmenübergreifende Auswertungen (z. B. Gesamtumsatz aller Firmen) brauchen später einen eigenen, bewusst freigegebenen Weg.
- Gemeinsam genutzte Artikel über Firmen hinweg sind ausdrücklich nicht vorgesehen (FangEvo, 2026-11-09).
