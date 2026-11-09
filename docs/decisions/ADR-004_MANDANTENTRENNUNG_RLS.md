# ADR-004 – Mandantentrennung mit Row-Level Security

**Stand:** 2026-11-09 · **Status:** angenommen

## Entscheidung

Gemeinsames Datenbankschema, `account_id` in jeder Mandantentabelle, PostgreSQL Row-Level Security mit `FORCE`, Laufzeit-Rolle ohne `BYPASSRLS`. Der Kontext wird pro Transaktion über `set_config(..., true)` gesetzt (`withTenant`).

## Begründung

Skaliert auf Tausende Accounts mit einer einzigen Migration. RLS schützt auch bei Programmierfehlern: Ein vergessener Filter liefert „nichts“ statt fremder Daten.

## Konsequenzen

- Jede Mandantenabfrage braucht eine (kurze) Transaktion. Bisher unkritisch, wird in Lasttests (Phase 3) überprüft.
- Globale Tabellen (Benutzer, Sitzungen) haben kein RLS und werden nur vom Auth-Bereich genutzt.
- Einladungs-Tokens enthalten die Account-ID, damit sie ohne Umgehung von RLS aufgelöst werden können.
- Große Enterprise-Kunden können später in eine eigene Datenbank verschoben werden, ohne dass sich der Code ändert.
