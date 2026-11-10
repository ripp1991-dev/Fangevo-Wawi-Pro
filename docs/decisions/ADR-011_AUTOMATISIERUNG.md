# ADR-011 – Automatisierung: Webhooks und Regeln

**Stand:** 2026-11-09 · **Status:** angenommen

## Kontext

Playbook 16 und 20 verlangen Webhooks bei fachlichen Ereignissen sowie kundeneigene Regeln mit Versionierung, Ausführungsprotokoll, Fehlerbehandlung und Schutz vor Endlosschleifen. Grundlage ist die bestehende Outbox (ADR-006).

## Entscheidung

1. **Ereignisse tragen die Firma** (`outbox_events.company_id`). Webhooks und Regeln sind firmenbezogen und laufen mit Firmenkontext (RLS).
2. **Webhooks:** Zustellungen werden aus Outbox-Ereignissen erzeugt (idempotent je Ereignis und Webhook) und über die Hintergrund-Warteschlange gesendet. Signatur: HMAC-SHA256 über `Zeitstempel.Body`, Header `X-FangEvo-Signature`, `X-FangEvo-Timestamp`, `X-FangEvo-Event`, `X-FangEvo-Delivery`. Bis zu 8 Versuche mit wachsender Wartezeit (1 min … 6 h); nach 20 endgültig fehlgeschlagenen Zustellungen wird der Webhook abgeschaltet und die Verantwortlichen werden benachrichtigt. Ziele im privaten Netz (Loopback, RFC 1918, Link-Local, Metadaten-Adressen) sind in Produktion gesperrt (SSRF-Schutz); keine Weiterleitungen, 10 s Zeitlimit. Der Signaturschlüssel liegt verschlüsselt (AES-256-GCM) in der Datenbank.
3. **Regeln** bestehen aus Auslöser, Bedingungen (alle/eine) und Aktionen. Jede gespeicherte Fassung ist eine unveränderliche Version; Läufe verweisen auf ihre Version. Läufe entstehen idempotent je Regel, Ereignis und Datensatz und werden im Hintergrund mit den aktuellen Rechten der Person ausgeführt, die die Regel zuletzt gespeichert hat. Aktionen nutzen die Fach-Services (`OrdersService.transitionInTx` usw.) – keine Sonderwege. „Versenden“ und „Stornieren“ sind als Regel-Aktion ausgeschlossen.
4. **Schutz vor Endlosschleifen:** höchstens 3 erfolgreiche Läufe je Regel und Datensatz in 10 Minuten, weitere werden mit Begründung übersprungen.
5. **Zeitsteuerung:** Fälligkeiten in der globalen Tabelle `workflow_schedule` (nur IDs); der Worker prüft jede Minute (`FOR UPDATE SKIP LOCKED`). Je Treffer und Zeitraum (Stunde/Tag) höchstens ein Lauf.
6. **Editor:** zunächst ein Formular „Wenn – und – dann“ mit Testlauf gegen einen echten Datensatz (ohne Ausführung). Ein grafischer Editor folgt später.

## Konsequenzen

- (+) Externe Systeme werden zuverlässig und überprüfbar informiert; Kunden automatisieren ohne Programmierung.
- (+) Jede Ausführung ist nachvollziehbar (Version, Kontext, Schritte, Fehler).
- (−) Regeln können nur die freigegebenen Aktionen nutzen; weitere Aktionen kommen bei Bedarf hinzu.
