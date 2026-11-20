# ADR-015: Shopify als Verkaufskanal

Status: angenommen (2026-11-20)

## Kontext

Für den Alltag muss die Wawi Bestellungen aus dem eigenen Shopify-Shop übernehmen, den Bestand dorthin übertragen und den Versand zurückmelden. Die Anbindung soll später auch anderen Kunden zur Verfügung stehen („teilen“), ohne dass jeder Kunde selbst eine App bauen oder Zugangsschlüssel kopieren muss.

Shopify legt neue Apps seit 2026 im **Dev Dashboard** an. Für Server-Apps ohne Benutzeroberfläche in Shopify gibt es den Token-Abruf `grant_type=client_credentials`:

- mit **Client-Schlüssel**: nur für Shops der eigenen Shopify-Organisation, Token 24 h gültig;
- mit **Schlüsselpaar** (signierte Client-Assertion, RS256/ES256): für jeden Shop, der eine öffentlich vertriebene App installiert hat, Token ca. 1 h gültig.

## Entscheidung

1. **Eine App „FangEvo Wawi“ für alle Kunden.** Die Wawi kennt nur Client-ID und Schlüssel der App (Serverkonfiguration `SHOPIFY_*`), keine Zugangsdaten je Shop. In der Datenbank steht je Kanal nur die Shop-Adresse. Tokens liegen nur im Speicher und werden vor Ablauf erneuert.
2. **Verbinden nur über einen signierten Aufruf aus Shopify.** Nach der Installation (oder beim Öffnen der App im Shopify-Admin) ruft Shopify die App-Seite der Wawi mit `shop`, `timestamp` und `hmac` auf. Die Wawi prüft die HMAC-SHA256-Signatur mit dem Client-Schlüssel (zeitkonstant) und dass der Aufruf höchstens 1 Stunde alt ist. Nur wer den Shop verwaltet, kommt an einen solchen Aufruf – so kann niemand einen fremden Shop, der die App ebenfalls installiert hat, mit seinem Wawi-Konto verbinden. Ein Shopify-Kanal lässt sich nicht über das normale Formular anlegen, und die Shop-Adresse ist danach nicht mehr änderbar.
3. **Abgleich im Hintergrund.** Eine globale Fälligkeitstabelle `channel_sync_schedule` (nur IDs, wie `workflow_schedule`) plant aktive Shopify-Kanäle alle `CHANNEL_SYNC_MINUTES` (Standard 5) als Job `shopify_sync` ein. Der Job läuft mit Mandanten- und Firmenkontext (RLS) im Namen der Person, die den Kanal zuletzt gespeichert hat.
   - **Bestellungen:** neue/geänderte Bestellungen seit dem letzten Stand (`updated_at`), ab einem einstellbaren Datum. Übernommen werden bezahlte (optional auch unbezahlte), nicht stornierte, noch nicht versendete Bestellungen über `ChannelsService.receiveOrderInTx` – also mit denselben Prüfungen wie die API-Übergabe und idempotent je Shopify-Bestell-ID. Bruttopreise werden mit dem Steuersatz der Position auf netto umgerechnet. Scheitert eine Bestellung (z. B. unbekannte SKU), steht der Grund im Kanalprotokoll; sie wird bei jedem Abgleich erneut versucht. Storno nach Übernahme ergibt eine Warnung.
   - **Artikel verknüpfen:** Shopify-Variante ↔ Artikel über SKU = Artikelnummer, sonst Barcode = EAN bzw. Zusatz-Barcode (`channel_article_links`, erzwungene RLS). Stündlich und auf Knopfdruck neu.
   - **Bestand:** Die Wawi ist führend (verfügbar = Bestand − Reservierungen im Kanallager, nie negativ). Gesetzt wird mit `inventorySetQuantities`, Idempotenzschlüssel und **Vergleich-und-Tausch** (`changeFromQuantity` = eben gelesener Shopify-Wert). Hat sich der Wert in Shopify inzwischen geändert (neue Bestellung), wird nicht überschrieben, sondern im nächsten Lauf nach dem Bestellabruf. Nur Änderungen werden gesendet.
4. **Versand melden.** Die Ereignisse `order.shipped` und `shipment.tracking_set` (Outbox) planen den Job `shopify_fulfillment`: offene Fulfillment-Orders der Bestellung werden mit allen Sendungsnummern erfüllt (`fulfillmentCreate`); spätere Sendungsnummern werden nachgetragen. Die Fulfillment-ID wird als externe Referenz gespeichert (höchstens eine Meldung je Auftrag).
5. **API-Version** fest eingestellt (`SHOPIFY_API_VERSION`, Standard `2026-10`), damit sich das Verhalten nicht unbemerkt ändert. Wiederholung bei Drosselung (`THROTTLED`/429), Serverfehlern und Netzwerkfehlern; bei 401 einmal neu anmelden.
6. **App-Konfiguration im Repository** (`apps/shopify-app/shopify.app.toml`): Name, Berechtigungen, App-Adresse. So lässt sich die App für eine andere Umgebung (Test, Produktion) reproduzierbar anlegen und mit der Shopify CLI veröffentlichen.

## Folgen

- Für eigene Shops genügt der Client-Schlüssel. Für fremde Shops (öffentlicher Vertrieb) muss die App von Shopify geprüft werden und zusätzlich ein Schlüsselpaar hinterlegt sein; Kundendaten (Name, Adresse, E-Mail) brauchen dafür die Freigabe „geschützte Kundendaten“ im Dev Dashboard.
- Nur Shops in Euro. Weitere Währungen, Teillieferungen und Rücksendungen aus Shopify sind spätere Ausbaustufen.
- Bestellungen älter als 60 Tage liefert Shopify nur mit zusätzlicher Berechtigung `read_all_orders` – für den Betrieb nicht nötig.
- Die Anbindung ist mit einem simulierten Shop automatisch getestet (`shopify.test.ts`) und manuell gegen den Dev-Shop zu prüfen (docs/SHOPIFY.md).
