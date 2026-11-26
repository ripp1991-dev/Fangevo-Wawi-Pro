# Shopify anbinden

Die Wawi bindet Shopify über die App **„FangEvo Wawi“** an (Entscheidung: ADR-015). Eine App für alle Kunden: Jeder Shop installiert sie, danach verbindet man den Shop mit einem Klick in der Wawi.

Was die Anbindung macht:

| Richtung       | Was                                                                             | Wann                              |
| -------------- | ------------------------------------------------------------------------------- | --------------------------------- |
| Shopify → Wawi | Bezahlte, noch nicht versendete Bestellungen werden Aufträge (netto, mit Kunde) | alle 5 Minuten und auf Knopfdruck |
| Wawi → Shopify | Verfügbarer Bestand der verknüpften Artikel am gewählten Shopify-Standort       | alle 5 Minuten (nur Änderungen)   |
| Wawi → Shopify | Versand mit Sendungsnummer, optional Versandmail von Shopify an den Kunden      | sobald der Auftrag versendet ist  |
| Verknüpfung    | Shopify-Variante ↔ Artikel über SKU = Artikelnummer, sonst Barcode = EAN        | stündlich und auf Knopfdruck      |

## 1. App im Shopify Dev Dashboard (einmal je Umgebung, macht FangEvo)

1. https://dev.shopify.com → Organisation wählen → **Apps → App erstellen → App manuell erstellen**.
2. Werte aus `apps/shopify-app/shopify.app.toml` übernehmen:
   - App-Name „FangEvo Wawi“
   - **App-URL** = Adresse der Wawi + `/channels` (Entwicklung: `http://localhost:5173/channels`, Produktion: `https://<wawi-domain>/channels`)
   - „In Shopify-Admin einbetten“ **aus**, „Älteren Installationsablauf“ **aus**
   - Bereiche (Scopes): `read_orders, read_products, read_inventory, write_inventory, read_locations, read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders`
3. Version veröffentlichen.
4. Unter **Einstellungen** stehen Client-ID und Client-Schlüssel. **Beides trägt der Administrator selbst** in die Serverkonfiguration ein (`.env` bzw. Secret-Speicher der Produktion) – nie in Chat, Tickets, Code oder Screenshots:

```
SHOPIFY_CLIENT_ID=…
SHOPIFY_CLIENT_SECRET=…
```

5. API und Worker neu starten.

Alternativ mit der Shopify CLI aus `apps/shopify-app`: `shopify app deploy` (die Client-ID der jeweiligen App in `shopify.app.toml` eintragen).

### Für fremde Shops (später, öffentlicher Vertrieb)

- Im Dev Dashboard **Vertrieb** wählen (öffentlich oder benutzerdefiniert mit Installationslink).
- **Geschützte Kundendaten** beantragen (Name, Adresse, E-Mail, Telefon) – sonst fehlen diese Felder in Bestellungen.
- Ein **Schlüsselpaar** erzeugen und den öffentlichen Schlüssel im Dev Dashboard hinterlegen (Einstellungen → Öffentliche Schlüssel):

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out shopify-private.pem
openssl pkey -in shopify-private.pem -pubout -out shopify-public.pem
node -p 'JSON.stringify({...require("crypto").createPublicKey(require("fs").readFileSync("shopify-public.pem")).export({format:"jwk"}), kid:"fangevo-1", alg:"RS256", use:"sig"})'
```

Dann zusätzlich: `SHOPIFY_PRIVATE_KEY_FILE=/pfad/zu/shopify-private.pem` und `SHOPIFY_KEY_ID=fangevo-1`. Der private Schlüssel bleibt nur auf dem Server. Der Client-Schlüssel wird weiterhin für die Signaturprüfung beim Verbinden gebraucht.

## 2. Shop verbinden (macht der Kunde, ca. 1 Minute)

1. App im Shop installieren (Dev Dashboard → Apps → ⋯ → **App installieren** → Shop wählen, bzw. Installationslink von FangEvo).
2. Shopify öffnet danach die Wawi unter **Verkaufskanäle**. Wer noch nicht angemeldet ist, meldet sich an und landet wieder dort.
3. **Shop verbinden** bestätigen (Name und Lager optional). Der Kanal ist sofort aktiv.

Später: In Shopify unter **Apps → FangEvo Wawi** öffnet sich ebenfalls die Wawi.

## 3. Einstellungen je Shop (Verkaufskanäle → Shop → Bearbeiten)

- **Lager**: aus diesem Lager kommen Bestand und Aufträge.
- **Shopify-Standort**: an diesem Standort setzt die Wawi den Bestand (leer = kein Bestandsabgleich).
- **Bestellungen ab**: ältere Bestellungen werden nicht übernommen (Standard: 7 Tage vor dem Verbinden).
- Bestellungen übernehmen / auch unbezahlte / Bestand übertragen / Versand melden / Versandmail von Shopify.

Knöpfe im Kanal: **Jetzt abgleichen**, **Artikel neu verknüpfen**, **Verbindung prüfen** (zeigt fehlende Berechtigungen). Alles Weitere steht im **Protokoll** des Kanals.

## 4. Typische Meldungen

| Meldung im Protokoll                                           | Lösung                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| „Bestellung #1003 nicht übernommen: Artikel „X“ ist unbekannt“ | Artikel mit Artikelnummer bzw. EAN = SKU/Barcode in Shopify anlegen. Beim nächsten Abgleich klappt es. |
| „… ohne E-Mail-Adresse“                                        | Bei fremden Shops: geschützte Kundendaten im Dev Dashboard freigeben lassen.                           |
| „x am Standort nicht aktivierbar“ | Die Wawi aktiviert Artikel am gewählten Standort selbst. Klappt das nicht, in Shopify beim Produkt die Bestandsführung prüfen. |
| „Die App … ist in diesem Shop nicht installiert“               | App im Shop (erneut) installieren.                                                                     |
| „Bestellung #… wurde in Shopify storniert“                     | Auftrag in der Wawi prüfen und ggf. stornieren.                                                        |

## 5. Test gegen den Dev-Shop

1. `SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET` in `.env` (selbst eintragen), API und Web starten.
2. In Shopify die App öffnen → Wawi → Shop verbinden.
3. In Shopify einen Artikel mit SKU = Artikelnummer der Wawi anlegen, Bestand am Standort aktivieren.
4. Testbestellung im Shop (Bogus Gateway) → nach „Jetzt abgleichen“ ist der Auftrag in der Wawi.
5. Auftrag in der Wawi packen/versenden → in Shopify ist die Bestellung „Versendet“ mit Sendungsnummer.
6. Bestand in der Wawi ändern → nach dem Abgleich zeigt Shopify den neuen verfügbaren Bestand.
