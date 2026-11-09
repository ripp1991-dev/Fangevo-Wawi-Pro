# ADR-008 – Belege (GoBD), PDF-Ablage und Bestandsreservierung

**Stand:** 2026-11-09 · **Status:** angenommen

## Kontext

Phase 3b bringt Aufträge, Rechnungen und den Einkauf. Rechnungen müssen lückenlos nummeriert, nach dem Erstellen unveränderlich und zehn Jahre lesbar archiviert sein (GoBD, § 14 UStG). Aufträge sollen Bestand vormerken, ohne dass zwei Aufträge dieselbe Ware „bekommen“. FangEvo hat festgelegt: PDF-Rechnungen jetzt, E-Rechnung (XRechnung/ZUGFeRD) nach Prüfung durch den Steuerberater.

## Entscheidung

1. **Belege als Entwurf → festgeschrieben.** Ein Beleg entsteht als Entwurf ohne Nummer. Erst `finalize` vergibt die Nummer aus dem Nummernkreis der Belegart (lückenlos, dieselbe Transaktion) und erzeugt das PDF. Danach erlaubt ein Datenbank-Trigger nur noch Änderungen an Zahlungsstatus und Versanddatum; Löschen ist verboten. Korrekturen erfolgen über Gutschrift oder Stornorechnung (negierte Beträge).
2. **Positionen und Empfänger als Kopie im Beleg** (JSON). Spätere Änderungen an Artikeln, Kunden oder Aufträgen verändern einen Beleg nicht.
3. **PDF in der Datenbank** (`document_files`, `bytea`) mit SHA-256-Prüfsumme, die beim Abruf kontrolliert wird. Grund: gleiche Sicherung, gleiche Mandanten- und Firmentrennung (RLS) wie alle Daten, kein zusätzlicher Dienst nötig. Bei großem Volumen kann die Ablage später in einen Objektspeicher (MinIO/S3 mit Objektsperre) wandern, ohne das Datenmodell zu ändern.
4. **PDF-Erzeugung mit pdfkit** im API-Prozess (keine Browser-Engine nötig, schnell, Standardschrift mit Umlauten und €). Die Steuer wird je Steuersatz auf die Nettosumme berechnet und kaufmännisch gerundet.
5. **Reservierung nach Anlage-Reihenfolge.** Ein Auftrag reserviert ab Anlage bis Versand oder Storno (`stock_reservations`, Sets als Komponenten). Für einen Auftrag gilt: verfügbar = Lagerbestand − Reservierungen **älterer** Aufträge. Damit kann ein neuer Auftrag einem älteren keine Ware wegnehmen. Kommissionierung, Verpackung, Versandbereit und Versand setzen volle Verfügbarkeit voraus (außer Minusbestand ist erlaubt). Der Versand bucht über `InventoryService.apply()` (Zeilensperre, Journal).
6. **Preise und Summen rechnet immer der Server** (Decimal). Ein vom Benutzer gesetzter Einzelpreis wird übernommen; alle Beträge, Steuern und Summen werden neu berechnet.

## Konsequenzen

- (+) Rechnungen sind nachweisbar unverändert (Trigger + Prüfsumme), Nummern lückenlos, auch bei Fehlern mitten im Vorgang.
- (+) Keine Doppelvergabe von Ware; die Reihenfolge ist für Mitarbeitende nachvollziehbar.
- (−) Die Datenbank wächst mit den PDFs (ca. 3–10 KB je Beleg ohne Logo). Bei Bedarf Auslagerung wie in Punkt 3 beschrieben.
- (−) Prioritäten zwischen Aufträgen (z. B. „Großkunde zuerst“) sind noch nicht möglich; folgt bei Bedarf mit FangEvo Pack (Phase 4).
- Offen für den Steuerberater: Hinweise für Reverse-Charge, innergemeinschaftliche Lieferung und Kleinunternehmer; E-Rechnung.
