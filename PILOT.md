# Pilotkunden – Vorbereitung und Checkliste

Ziel der Pilotphase: 2–5 echte Händler arbeiten 4–8 Wochen mit FangEvo Wawi Pro. Wir lernen, was im Alltag fehlt oder stört, bevor der Verkauf startet.

## 1. Vor dem Start (FangEvo)

| Punkt                                                                                 | Wer               | Status                           |
| ------------------------------------------------------------------------------------- | ----------------- | -------------------------------- |
| Server/Hosting in der EU wählen (z. B. Hetzner, IONOS, AWS Frankfurt), Domain, TLS    | FangEvo           | offen                            |
| `.env.production` ausfüllen (Passwörter, Schlüssel, SMTP, Support-Postfach)           | FangEvo / Technik | offen                            |
| Absenderdaten für Rechnungen (`PLATFORM_ISSUER_*`) – oder Pilot ohne Rechnungen       | FangEvo           | offen                            |
| Plattform-Mitarbeiter festlegen (`PLATFORM_ADMIN_EMAILS`), Zwei-Faktor einrichten     | FangEvo           | offen                            |
| Tägliche Sicherung einrichten und **eine Wiederherstellungs-Probe** durchführen       | Technik           | Werkzeuge fertig (OPERATIONS.md) |
| Überwachung `/health` und Fehlerlogs einrichten                                       | Technik           | offen                            |
| Datenschutz: Auftragsverarbeitungsvertrag (AVV), Datenschutzerklärung, Löschkonzept   | FangEvo / Anwalt  | offen                            |
| AGB / Nutzungsbedingungen für den Pilot (kostenlos oder vergünstigt, Laufzeit)        | FangEvo           | offen                            |
| Externer Penetrationstest (empfohlen vor dem offenen Verkauf, für den Pilot optional) | FangEvo           | offen                            |
| Steuerberater: Rechnungstexte, Umsatzsteuer (OSS/Reverse Charge), E-Rechnung          | FangEvo           | offen                            |

Für Pilotkunden ohne Zahlung: In der Plattform-Verwaltung das Paket wählen und „Abo ohne Rechnung aktivieren“. Die Laufzeit läuft dann ohne Rechnung, Verlängerungen erzeugen aber Rechnungen. Für einen längeren kostenlosen Pilot deshalb besser „Testphase verlängern“ (bis 365 Tage) nutzen.

## 2. Einrichtung je Pilotkunde (ca. 2–4 Stunden gemeinsam)

1. Kunde registriert sich selbst. FangEvo stellt Paket und Pilot-Laufzeit in der Plattform-Verwaltung ein.
2. Firmen anlegen, Firmeneinstellungen (Steuersätze, Nummernkreise, Bankdaten, Pflichtangaben für Rechnungen).
3. Benutzer einladen, Rollen anpassen, Zwei-Faktor für Administratoren empfehlen.
4. **Datenübernahme** mit FangEvo Import:
   - Artikel, Kunden, Lieferanten, Bestände als CSV/Excel (z. B. aus JTL).
   - Immer zuerst den **Prüflauf**: Fehler je Zeile ansehen, Zuordnung als Vorlage speichern.
   - Danach ausführen, Stichproben prüfen (10 Artikel, 10 Kunden, Bestandssumme).
   - Bei Fehlern: neu angelegte Stammdaten mit „Rückgängig“ entfernen und erneut importieren.
5. Probeauftrag durchspielen: Auftrag → Pickliste → Packtisch → Versand → Rechnung (PDF) → Zahlung → Retoure.
6. Optional: eigener Shop über API-Schlüssel, Webhooks, erste Regeln.

## 3. Während des Pilots

- Wöchentlicher kurzer Termin (30 min): Was hat gefehlt? Was war umständlich?
- Fehler und Wünsche kommen über **Support** in der Software. Antworten über die Plattform-Verwaltung.
- FangEvo prüft wöchentlich Fehlerlogs und Rückstände der Hintergrundaufgaben.
- Updates nur mit vorheriger Sicherung und Rauchtest (OPERATIONS.md).

## 4. Erfolgskriterien für den Abschluss

- Täglicher Ablauf (Aufträge bis Versand und Rechnung) läuft ohne Umwege über andere Programme.
- Keine Datenverluste, keine Fehlbuchungen im Bestand, keine falschen Rechnungsbeträge.
- Antwortzeiten im Alltag subjektiv „schnell“; keine Ausfälle über 15 Minuten.
- Liste der fehlenden Funktionen priorisiert (z. B. Versanddienstleister, Marktplätze, DATEV-Export).

## 5. Was im Pilot noch nicht geht (ehrlich kommunizieren)

- Versandetiketten direkt bei DHL/DPD/GLS usw.: Es gibt nur eigene Etiketten und manuelle Trackingnummern (Zugangsdaten und Sandbox-Tests fehlen).
- Marktplätze (Amazon, eBay, Kaufland …): nur der eigene Shop über die API.
- Zahlungsanbieter für das Abo (Lastschrift/Karte): nur Rechnung/Überweisung.
- E-Rechnung (XRechnung/ZUGFeRD), DATEV-Export, Finanzen, CRM, Analytics: geplant.
