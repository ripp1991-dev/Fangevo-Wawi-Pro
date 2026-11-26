# DHL anbinden

Mit der Versandart **„DHL Paket“** holt der Packtisch nach „Fertig“ das Etikett direkt bei DHL und trägt die Sendungsnummer ein (Entscheidung: ADR-016). Bei Shopify-Aufträgen wird die Sendungsnummer danach automatisch an Shopify gemeldet.

Stand: Deutschland und EU, ein Paket je Auftrag. Drittländer (Zoll) und mehrere Pakete weiter über „Manuell“.

## 1. Einmal je Server (macht FangEvo)

1. Auf https://developer.dhl.com ein Konto anlegen, eine **App** erstellen und die Schnittstelle **„DHL Paket DE Versenden (Post & Paket Deutschland)“** hinzufügen. Die Testumgebung (Sandbox) ist sofort nutzbar.
2. API Key und API Secret der App **selbst** in die Serverkonfiguration eintragen (nie in Chat, Tickets, Code oder Screenshots):

```
DHL_API_KEY=…
DHL_API_SECRET=…
DHL_ENV=sandbox
```

3. API und Worker neu starten.

Für den Echtbetrieb bei DHL die Freigabe der App für „Production“ beantragen (1–3 Werktage) und `DHL_ENV=production` setzen.

## 2. Je Firma (Packtisch › Packplätze › „Versanddienstleister: DHL Paket“)

| Feld                            | Testumgebung                                           | Echtbetrieb                                                                  |
| ------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Benutzer                        | `user-valid` (von DHL veröffentlichter Testbenutzer)   | Benutzer des Post & DHL Geschäftskundenportals, am besten ein Systembenutzer |
| Passwort                        | das in der DHL-Dokumentation genannte Sandbox-Passwort | Passwort dieses Benutzers (läuft bei Systembenutzern nach 365 Tagen ab)      |
| Abrechnungsnummer national      | Sandbox-Nummer für DHL Paket laut DHL-Dokumentation    | EKP (10 Stellen) + `01` + Teilnahme (2 Stellen)                              |
| Abrechnungsnummer International | optional                                               | EKP + `53` + Teilnahme                                                       |
| Etikettenformat                 | nach Drucker                                           | nach Drucker (Etiketten dürfen nicht skaliert werden)                        |

Danach **Verbindung prüfen**: Die Wawi meldet sich an und schickt eine Probe-Sendung im Prüfmodus (es entsteht nichts).

Außerdem nötig: vollständige **Anschrift der Firma** (Firmen › bearbeiten) – sie ist der Absender auf dem Etikett.

## 3. Am Packtisch

- Beim Packplatz „DHL Paket“ als Standard-Versandart einstellen oder am Packtisch unter „Versand“ wählen.
- Gewicht eingeben, **Fertig** → Etikett von DHL, Sendungsnummer steht in der Sendung. Mit „Automatisch drucken“ wird das Etikett sofort gedruckt (docs/PACKTISCH.md).

## 4. Typische Meldungen

| Meldung                                                 | Lösung                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „DHL hat die Anmeldung abgelehnt“                       | Benutzer/Passwort prüfen; Passwort im Geschäftskundenportal erneuern und hier neu eintragen.                                                                              |
| „DHL lehnt die Sendung ab: …“                           | Der Text kommt von DHL (z. B. Postleitzahl ungültig, Abrechnungsnummer nicht freigeschaltet). Adresse im Auftrag bzw. Einstellungen korrigieren. Es wurde nichts gebucht. |
| Hinweis „DHL: … Straße konnte nicht gefunden werden“    | Etikett ist gültig; DHL kann für nicht prüfbare Adressen ein Nachentgelt berechnen. Adresse prüfen.                                                                       |
| „… braucht Zollangaben und wird noch nicht unterstützt“ | „Manuell“ wählen und das Etikett im Geschäftskundenportal erstellen.                                                                                                      |
