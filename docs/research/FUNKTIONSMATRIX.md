# Funktionsmatrix JTL-Wawi → FangEvo Wawi Pro

**Stand:** 2026-11-10 · **Quelle:** Oberfläche von JTL-Wawi 2.0.4 (Mandant Lundelius, Profil eB-Standard), nur angesehen, nichts geändert.
**Methode:** Alle Hauptmodule, Menüs und die Artikelmaske durchgeklickt. Keine Datenbank-Analyse (siehe 02_JTL_CHECKLISTE.md, Abschnitt A). Keine Kundendaten übernommen.

Status-Werte: `geprüft – vorhanden` = in der Oberfläche gesehen · `ungeprüft` = nur Menüpunkt gesehen, nicht geöffnet.
Priorität: P0 = Kern für Start · P1 = kurz danach · P2 = später.

## 1. Mengengerüst (aus der Oberfläche)

| Größe           | Wert                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Lager           | 3: Heideland (eigenes Lager), Amazon, FBA (EU) Nohawa                                                 |
| Lieferanten     | 52                                                                                                    |
| Aufträge        | 12.803 in der Standardansicht „letzte 90 Tage“, Summe ca. 381.149 EUR                                 |
| Kundengruppen   | Endkunden (Standard), Gast, Grenze, Händler, Händler National                                         |
| Verkaufskanäle  | Onlineshop, Shopify, B2B-Shop, Amazon.de (Konto Nohawa), eBay.de, Kaufland.de, Kaufland.at, Temu (DE) |
| Kategorie-Bäume | mehrere Wurzeln je Kanal (NFS Shop, B2B-Shop, Amazon Nørre, Calgros, Temu, USA …)                     |
| Produktion      | Modul nicht lizenziert (zeigt nur Werbeseite)                                                         |

## 2. Hauptnavigation von JTL

Menüleiste: Start · Artikel · Lager · Kunden · Verkauf · Zahlungen · Versand · Retouren · Plattformen · Produktion · Controlling · Admin · Hilfe.
Modul-Leiste mit Tastenkürzeln: F2 Artikel · F3 Beschaffung · F4 Lager · F5 Kunden · F6 Verkauf · F7 Zahlungen · F8 Versand · F9 Retouren · F10 Plattformen · F12 Statistik · Alt+S Service · Alt+P Produktion · Alt+D Dashboard.

Grundmuster jedes Moduls: **Statusbaum links → Liste in der Mitte (filterbar, Spalten wählbar) → Detail-/Positionsbereich unten → Aktionsleiste**. Dieses Muster sollte FangEvo übernehmen, weil das Team es gewohnt ist.

## 3. Matrix

### Artikel (F2)

| Funktion                                                                                                                                                                               | FangEvo-Modul  | Prio               | Status                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------ | ------------------------- |
| Artikelliste mit Kategoriebaum, Suche (Global/Enthält), Labels, temporäre Filter                                                                                                       | Artikel        | P0                 | geprüft – vorhanden       |
| Schnellfilter: Aktive, Nur Hauptbestand, Inaktive, Kindartikel, Stücklisten                                                                                                            | Artikel        | P0                 | geprüft – vorhanden       |
| Listenspalten: Bestand, Lagerbestand eigen/gesamt, Verfügbar, In Aufträgen, Im Zulauf, Auf Einkaufsliste, Netto-VK, Ø Netto-EK, Onlineshop aktiv                                       | Artikel        | P0                 | geprüft – vorhanden       |
| Stammdaten: Artikelnummer, GTIN, HAN, Name, Hersteller, Steuerklasse, Versandklasse, Sortiernummer, inaktiv-Flag                                                                       | Artikel        | P0                 | geprüft – vorhanden       |
| Mehrfach-Kategorisierung (ein Artikel in mehreren Kategoriebäumen), Warengruppe                                                                                                        | Artikel        | P0                 | geprüft – vorhanden       |
| Preise: Brutto-/Netto-VK, UVP, Ø EK, letzter EK mit Datum, Kosten                                                                                                                      | Artikel/Preise | P0                 | geprüft – vorhanden       |
| Preise je Kanal (Global, B2B-Shop, Shopify, Amazon, eBay, Kunden, weitere Marktplätze)                                                                                                 | Preise         | P0                 | geprüft – vorhanden       |
| Kundengruppenpreise und Staffelpreise                                                                                                                                                  | Preise         | P0                 | geprüft – vorhanden       |
| Sonderpreise (zeitlich), Massenbearbeitung                                                                                                                                             | Preise         | P1                 | ungeprüft                 |
| Lager je Artikel: Bestandsführung an/aus, Bestand je Lager, Mindest-/Maximalbestand, Überverkäufe                                                                                      | Lager          | P0                 | geprüft – vorhanden       |
| Grundpreis/Einheit, Abnahme (Mindestmenge/Intervall), Maße/Gewicht                                                                                                                     | Artikel        | P0                 | geprüft – vorhanden       |
| Kanal-Freischaltung pro Artikel (Haken je Kanal mit Status)                                                                                                                            | Multichannel   | P0                 | geprüft – vorhanden       |
| Weitere Reiter: Beschreibung, Bestände, Lieferanten, Bilder, Attribute/Merkmale, Sonstiges, Variationen, Verkaufskanäle, Stückliste/Konfigurator, Sonderpreise, Dateien, Eigene Felder | Artikel        | P0/P1              | Reiter gesehen, ungeprüft |
| Artikelstatistik, Artikelhistorie                                                                                                                                                      | Artikel        | P1                 | ungeprüft                 |
| Anlegen: Hersteller, Warengruppen, Verkaufs-/Maßeinheiten, Artikelzustände, Lieferstatus, verantwortliche Personen, Cross-Selling-Gruppen, Konfigurationsgruppen, Attribute, Merkmale  | Stammdaten     | P0/P1              | Menü gesehen              |
| MHD prüfen (Mindesthaltbarkeitsdatum)                                                                                                                                                  | Lager          | **P0** (Süßwaren!) | Menü gesehen              |
| GTIN-Import, Bildgrößen                                                                                                                                                                | Artikel        | P2                 | Menü gesehen              |

### Beschaffung (F3)

| Funktion                                                                                                         | FangEvo-Modul       | Prio | Status              |
| ---------------------------------------------------------------------------------------------------------------- | ------------------- | ---- | ------------------- |
| Lieferantenliste mit Ansprechpartnern und getätigten Bestellungen                                                | Einkauf             | P0   | geprüft – vorhanden |
| Bestellvorschläge, Einkaufsliste, Preisanfragen                                                                  | Einkauf             | P1   | Baum gesehen        |
| Bestellungen mit Status: Offen, Freigegeben, In Bearbeitung, Teilgeliefert, Abgeschlossen, Überfällig, Rückstand | Einkauf             | P0   | Baum gesehen        |
| Dropshipping-Bestellungen (Offen/Gesendet/Abgeschlossen)                                                         | Einkauf             | P2   | Baum gesehen        |
| Eingangsrechnungen (Offen/Gebucht/Abgeschlossen)                                                                 | Einkauf/Buchhaltung | P1   | Baum gesehen        |

### Lager (F4 + Menü Lager)

| Funktion                                              | FangEvo-Modul | Prio  | Status              |
| ----------------------------------------------------- | ------------- | ----- | ------------------- |
| Wareneingang, Wareneingangshistorie                   | Lager         | P0    | Menü gesehen        |
| Korrektur/Umbuchung, Inventur, Lagerbewertung         | Lager         | P0/P1 | Menü gesehen        |
| Umlagerungen aus-/eingehend mit Status und Picklisten | Lager         | P1    | geprüft – vorhanden |
| Streckenlager, Fulfillment Network                    | Lager         | P2    | Baum gesehen        |

### Verkauf (F6)

| Funktion                                                                                                                                                    | FangEvo-Modul | Prio | Status              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---- | ------------------- |
| Aufträge mit Statusbaum: ohne/mit Rechnung, bezahlt/nicht bezahlt, storniert, (nicht) geliefert, zurückgehalten, fehlerhaft, pending, Umtausch              | Aufträge      | P0   | geprüft – vorhanden |
| Filter: Firma, Plattform, Versandland, Zahlungsart, Rückhaltegrund                                                                                          | Aufträge      | P0   | geprüft – vorhanden |
| Aktionen: Rechnung erstellen, Sofortauftrag, Zusammenfassen, Zahlung, Ausliefern, Storno, Nachricht an Kunde, Auf Einkaufsliste, Workflow-Ereignis auslösen | Aufträge      | P0   | Leiste gesehen      |
| Angebote, Abonnements                                                                                                                                       | Aufträge      | P2   | Baum gesehen        |
| Rechnungen (Entwurf, nicht bezahlt, angemahnt, bezahlt, storniert), Mahnwesen                                                                               | Rechnung      | P0   | Baum gesehen        |
| Rechnungskorrekturen (Gutschriften), Stornobelege, externe Belege (Marktplatz-Rechnungen)                                                                   | Rechnung      | P0   | Baum gesehen        |
| XRechnung/ZUGFeRD validieren                                                                                                                                | Rechnung      | P1   | Menü gesehen        |
| Auftragsimport (*.xml), Preisliste drucken, Vorgangsfarben/-status                                                                                          | Aufträge      | P2   | Menü gesehen        |

### Zahlungen (F7)

| Funktion                                                                                                   | FangEvo-Modul | Prio | Status              |
| ---------------------------------------------------------------------------------------------------------- | ------------- | ---- | ------------------- |
| Kontobewegungen mit Zuordnung zu Aufträgen (nicht/teilweise/vollständig zugewiesen, schwebend, fehlerhaft) | Zahlungen     | P1   | geprüft – vorhanden |
| Ausgangszahlungen, Bankabgleich                                                                            | Zahlungen     | P2   | Baum gesehen        |

### Versand (F8 + Menü Versand)

| Funktion                                                                                                    | FangEvo-Modul | Prio | Status              |
| ----------------------------------------------------------------------------------------------------------- | ------------- | ---- | ------------------- |
| Versandliste: Lieferbar, Teillieferbar, Unbezahlt, Fehlbestand, Dropshipping, Zurückgehalten, Auf Pickliste | Versand       | P0   | geprüft – vorhanden |
| Lieferscheine (Offen/Versendet/Fehlerhaft/ohne Rechnung)                                                    | Versand       | P0   | Baum gesehen        |
| Versandarten (genutzt u. a. DHL, WP 4.0, EU 4.0), Versandklassen, Rückhaltegründe                           | Versand       | P0   | geprüft – vorhanden |
| JTL-ShippingLabels, Track&Trace (Erstellt/Unterwegs/Zugestellt/Problem)                                     | Versand       | P0   | Baum gesehen        |
| Packtisch+/WMS-Ausgabe, Picklisten                                                                          | Versand/WMS   | P1   | Menü gesehen        |
| Fulfillment-Aufträge                                                                                        | Versand       | P2   | Baum gesehen        |

### Retouren (F9)

| Funktion                                                                                                                   | FangEvo-Modul | Prio | Status              |
| -------------------------------------------------------------------------------------------------------------------------- | ------------- | ---- | ------------------- |
| Retouren mit Status Angelegt → Eingetroffen → Abgeschlossen, Retourenetikett, Bezug zu Auftrag/Rechnung/Rechnungskorrektur | Retouren      | P1   | geprüft – vorhanden |

### Plattformen (F10)

| Funktion                                                                                                                                       | FangEvo-Modul | Prio | Status              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---- | ------------------- |
| Amazon: Bestellungen, Angebote, Lister, Abrechnungen, Buchungsdaten, Beleg-Upload, Multi-Channel-Aufträge, Gutschriften                        | Multichannel  | P1   | geprüft – vorhanden |
| eBay: Angebote, Bestellungen, eBay-Vorlagen                                                                                                    | Multichannel  | P1   | Baum gesehen        |
| Weitere Verkaufskanäle (SCX: Kaufland, Temu …): Angebote, Bestellabgleich (Zahlungen, Retouren, Versanddaten, Stornos), Rechnungsdatenabgleich | Multichannel  | P1   | Baum gesehen        |
| Onlineshop: fehlerhafte Aufträge, Neukunden                                                                                                    | Multichannel  | P0   | Baum gesehen        |

### Statistik, Controlling, Admin

| Funktion                                                                                                                | FangEvo-Modul   | Prio | Status              |
| ----------------------------------------------------------------------------------------------------------------------- | --------------- | ---- | ------------------- |
| Auswertungsmodule (Aufträge, Rechnungen inkl. Gewinn, offene Posten, Retouren, Beschaffung) mit Vorlagen und Diagrammen | Reporting       | P1   | geprüft – vorhanden |
| Dashboard                                                                                                               | Reporting       | P1   | ungeprüft           |
| JTL Business Intelligence (Abgleich, Logbuch)                                                                           | Reporting       | P2   | Menü gesehen        |
| Firmen/E-Mail, Benutzer/Rechte, globale Einstellungen, Steuern, eigene Felder, Prozessparameter, Konten                 | Admin           | P0   | Menü gesehen        |
| Druck-/E-Mail-/Exportvorlagen                                                                                           | Admin           | P0   | Menü gesehen        |
| JTL-Workflows, Worker-Status, Hintergrundprozesse, Logbuch                                                              | Automatisierung | P1   | Menü gesehen        |
| Kasse (POS)                                                                                                             | Kasse           | P2   | Menü gesehen        |
| JTL-Wawi API: App-Registrierungen, Cloud-Verbindung                                                                     | Schnittstellen  | P1   | Menü gesehen        |

## 4. Erkenntnisse für FangEvo

1. **Multichannel ist der Kern.** Es gibt 8 Kanäle mit eigenen Preisen, eigenen Kategoriebäumen und Freischaltung pro Artikel. FangEvo braucht von Anfang an „Artikel × Kanal“ als Grundkonzept, nicht als Zusatz.
2. **Statusbäume statt Menüs.** Fast jede Arbeit beginnt mit einem Klick auf einen Status („Lieferbar“, „Nicht bezahlt“). Das ist das zentrale Bedienmuster.
3. **Lebensmittel:** MHD-Prüfung und Steuerklasse „ermäßigt“ sind Pflicht.
4. **Mehrere Lager inklusive FBA.** Bestand wird je Lager geführt, und Amazon-FBA zählt als eigenes Lager.
5. **Marktplatz-Rechnungen kommen als „externe Belege“ getrennt von eigenen Rechnungen.** Das ist für die Buchhaltung wichtig.
6. **Ungenutzte Bereiche** (Produktion, vermutlich Abonnements und Kasse) haben niedrige Priorität.

## 5. Offen (nächste Schritte)

- Reiter der Artikelmaske einzeln ansehen: Variationen, Stückliste, Lieferanten, Bilder, Merkmale
- Liste der aktiven JTL-Workflows (Admin → JTL-Workflows)
- Genutzte Ameise-Vorlagen
- Top-10-Schmerzpunkte des Teams (Interviews)
