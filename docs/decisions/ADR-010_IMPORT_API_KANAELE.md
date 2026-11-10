# ADR-010 – Import, Hintergrundaufgaben, API-Schlüssel und Verkaufskanäle

**Stand:** 2026-11-09 · **Status:** angenommen

## Kontext

Phase 5 verlangt Massenimporte mit Prüfung vor der Ausführung, eine öffentliche API und eine Connector-Architektur für Shops und Marktplätze (Playbook 14, 15, 20). Echte Marktplatz-Anbindungen dürfen erst nach Sandbox-Tests als fertig gelten.

## Entscheidung

1. **Hintergrundaufgaben über `job_queue`:** globale Tabelle nur mit IDs (wie `outbox_pending`), Verarbeitung durch `JobQueue` im Worker (`FOR UPDATE SKIP LOCKED`, Sperrzeit, Wiederholungen). Handler arbeiten mit Mandanten- und Firmenkontext und den Rechten der auslösenden Person zum Ausführungszeitpunkt.
2. **Import = Datei → Zuordnung → Prüflauf → Ausführung.** Dateien (CSV mit erkannter Kodierung/Trennzeichen, XLSX über `exceljs`) werden als Zeilen im Importauftrag gespeichert (max. 50.000 Zeilen, 10 MB). Ohne erfolgreichen Prüflauf kein Start. Jede Zeile läuft über die Services der Fachmodule in einer eigenen Transaktion: gleiche Prüfungen, Rechte und Protokolle wie in der Oberfläche; fehlerhafte Zeilen stoppen den Import nicht und werden mit Zeilennummer protokolliert. Abbrüche werden fortgesetzt (verarbeitete Zeilen werden übersprungen).
3. **Rückgängig nur, wo fachlich sicher:** neu angelegte Artikel, Kunden und Lieferanten werden archiviert. Bestände (Journal), Preise und Änderungen an bestehenden Datensätzen werden nicht automatisch zurückgedreht.
4. **API-Schlüssel** gehören zu einer Firma, tragen ausgewählte Fachrechte (keine Administration) und handeln im Namen der anlegenden Person: wirksam ist die Schnittmenge mit deren aktuellen Rechten. Gespeichert wird nur der SHA-256-Hash in einem globalen Index (für die Anmeldung vor dem Mandantenkontext); Rate-Limit je Schlüssel (600/min); Sperren und Ablaufdatum. Anfragen mit Schlüssel und ohne Cookie brauchen keinen CSRF-Header.
5. **Verkaufskanäle als Connector-Rahmen:** Kanal mit Typ, Konfiguration (Geheimnisse verschlüsselt vorgesehen), Status, Protokoll, Zuordnung externer IDs und kanalbezogenen Artikeldaten. Erster Typ „Eigener Shop über API“ (passiv: Shop sendet Bestellungen, liest Bestand/Preise/Status). Die externe Bestellnummer ist je Kanal eindeutig (DB-Index) – doppelte Übergaben liefern den vorhandenen Auftrag. Amazon, eBay, Shopify usw. folgen als weitere Typen erst mit Zugangsdaten und Sandbox-Test.

## Konsequenzen

- (+) Importierte Daten unterliegen denselben Regeln wie manuell erfasste; kein Umgehen von Rechten oder Prüfungen.
- (+) JTL-Exporte lassen sich ohne Übernahme fremder Datenstrukturen einspielen (nur Spaltennamen werden erkannt).
- (−) Zeilenweise Verarbeitung ist langsamer als Massen-SQL (ca. 20–50 ms je Zeile); dafür nachvollziehbar und fehlertolerant.
- (−) Ausgehende Synchronisation (Bestände an Marktplätze schicken) folgt mit den ersten aktiven Connectoren bzw. Webhooks (Phase 6).
