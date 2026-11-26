# ADR-016: DHL als Versanddienstleister

Status: angenommen (2026-11-26)

## Kontext

Am Packtisch soll nach „Fertig“ ein echtes DHL-Etikett mit Sendungsnummer entstehen. Bisher gab es nur „Manuell“ (eigene Trackingnummer) und ein eigenes Adressetikett. DHL bietet für Geschäftskunden die REST-Schnittstelle „DHL Paket DE Versenden“ v2 mit einer Testumgebung (Sandbox), die keine echten Sendungen erzeugt.

## Entscheidung

1. **Zwei Ebenen von Zugangsdaten.** Der API-Schlüssel der App (developer.dhl.com) liegt in der Serverkonfiguration (`DHL_API_KEY`, `DHL_API_SECRET`, `DHL_ENV` = `sandbox` oder `production`). Jede Firma hinterlegt ihren Benutzer des Post & DHL Geschäftskundenportals, ihre Abrechnungsnummern und das Etikettenformat in `carrier_accounts` (erzwungene RLS Account + Firma). Das Passwort wird mit AES-256-GCM verschlüsselt gespeichert, nie zurückgegeben und nie protokolliert.
2. **Anmeldung über OAuth2** (ROPC, wie von DHL für v2 vorgesehen); Tokens nur im Speicher, vor Ablauf erneuert, bei 401 einmal neu angemeldet. Basic Auth wird nicht verwendet (DHL schaltet es ab).
3. **Etikett außerhalb der Versand-Transaktion.** Der Packtisch prüft zuerst (Status, Vollständigkeit), holt dann das Etikett bei DHL und bucht danach den Versand wie bisher (`OrdersService.shipInTx`). Scheitert die Buchung, wird die DHL-Sendung storniert (`DELETE /orders`). So hängt keine Datenbank-Sperre an einem fremden Dienst, und es bleibt keine DHL-Sendung ohne Versand in der Wawi zurück.
4. **Umfang der ersten Stufe:** DHL Paket national (V01PAK) und DHL Paket International in die EU (V53WPAK, eigene Abrechnungsnummer), **ein Paket je Auftrag**, Etikett als PDF im gewählten Format. Warnungen von DHL (z. B. Adresse nicht prüfbar) verhindern das Etikett nicht und werden am Packtisch angezeigt; Fehler von DHL werden im Klartext weitergegeben, gebucht wird dann nichts.
5. **Nicht enthalten** (bewusst, spätere Stufen): Drittländer mit Zollangaben, mehrere Pakete je Auftrag, Retourenetikett, Nachnahme und weitere Services, Tagesabschluss per Knopf (DHL schließt automatisch ab), Kleinpaket.

## Folgen

- Ohne `DHL_API_KEY` ist DHL ausgeschaltet; die Oberfläche zeigt einen Hinweis.
- Für den Echtbetrieb braucht jede Firma einen DHL-Geschäftskundenvertrag; die App muss bei DHL für „Production“ freigegeben werden (1–3 Werktage).
- Automatisch getestet mit simuliertem DHL (`dhl.test.ts`); Live-Test gegen die Sandbox nach docs/DHL.md.
