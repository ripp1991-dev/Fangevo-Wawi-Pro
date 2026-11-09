# ADR-009 – Logistik: Bestand je Charge/Seriennummer, Pack-Prüfung, Versanddienstleister

**Stand:** 2026-11-09 · **Status:** angenommen

## Kontext

Phase 4 bringt Kommissionierung, Packtisch, Versand und Retouren. Artikel mit Chargen-, Seriennummern- oder MHD-Pflicht müssen verkauft werden können, ohne die Rückverfolgung zu verlieren. Etiketten echter Versanddienstleister setzen Verträge, Zugangsdaten und Tests im Testsystem des Anbieters voraus (Playbook 15: keine Schnittstelle als fertig melden ohne Sandbox-Test).

## Entscheidung

1. **Bestand je Lagerort, Charge und Seriennummer.** `stock_levels` erhält `batch`, `serial_number`, `best_before`; der eindeutige Index umfasst Charge und Seriennummer. Eine Seriennummer darf je Artikel höchstens einmal im Bestand sein (Prüfung im Service und CHECK-Regel). Alle Buchungen laufen weiter über `InventoryService.apply()`.
2. **Entnahme beim Versand:** Chargen nach frühestem MHD (FEFO), sonst Lagerplätze mit dem meisten Bestand. Seriennummern werden nie automatisch gewählt; sie werden am Packtisch gescannt. Der Packtisch übergibt die gescannten Chargen/Seriennummern als Entnahme an `OrdersService.shipInTx()`.
3. **Picklisten** buchen keinen Bestand; sie schlagen Platz und Charge vor und steuern den Auftragsstatus (Kommissionierung → Verpackung).
4. **Pack-Prüfung auf dem Server:** Abschluss nur, wenn je Auftragsposition (Sets je Komponente) exakt die bestellte Menge gepackt ist, keine fremden Artikel enthalten sind und jede Seriennummer genau einmal vorkommt. Die Oberfläche prüft zusätzlich sofort beim Scannen.
5. **Versanddienstleister als Adapter.** Heute gibt es „manuell“ (eigene Trackingnummer) und „eigenes Adressetikett“ (PDF ohne Frankierung). DHL, DPD, GLS, UPS usw. werden als weitere Adapter ergänzt, sobald Zugangsdaten vorliegen und Tests im Testsystem erfolgreich waren. Sendungen sind nicht löschbar (Nachweis).
6. **Retouren** buchen wieder verkaufbare Ware mit der Buchungsart `return` ein; Gutschriften entstehen als Entwurf über `DocumentsService` (keine direkten Zugriffe auf Belegtabellen).

## Konsequenzen

- (+) Rückverfolgung vom Wareneingang über Lagerplatz bis zur Sendung; Fehlpacken wird verhindert.
- (+) Neue Versanddienstleister lassen sich ergänzen, ohne Packtisch oder Aufträge zu ändern.
- (−) Bis zur ersten Carrier-Anbindung müssen Etiketten der Versanddienstleister außerhalb gedruckt und die Trackingnummer eingetragen werden.
- (−) Reservierungen gelten weiter je Artikel und Lager, nicht je Charge.
