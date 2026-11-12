# Touch-Packtisch einrichten

Anleitung für einen Lagerrechner mit Touchscreen (ab 1280 × 720), USB-Handscanner und Drucker.

## 1. Rechner vorbereiten

- **Handscanner:** als Tastatur angeschlossen (Standard bei USB-Handscannern), mit „Enter“ nach jedem Scan.
- **Drucker:** Etikettendrucker bzw. Bürodrucker in Windows als **Standarddrucker** festlegen. Papierformat im Druckertreiber passend zum Etikett einstellen.
- **Browser:** Google Chrome oder Microsoft Edge.

## 2. Packtisch im Vollbild starten

Eine Verknüpfung auf dem Desktop anlegen mit diesem Ziel (Adresse anpassen):

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing https://wawi.example.de/packtisch
```

- `--kiosk`: Vollbild ohne Adressleiste und Menüs.
- `--kiosk-printing`: Drucken ohne Druckdialog auf den Standarddrucker. Ohne diese Option erscheint beim automatischen Druck der normale Druckdialog.
- Beenden des Kiosk-Modus: `Alt` + `F4`.

Optional die Verknüpfung in den Autostart legen (`Win` + `R` → `shell:startup`).

## 3. Packplatz und Gerät einrichten (Lagerleiter)

1. In FangEvo unter **Packtisch › Packplätze** den Packplatz anlegen: Lager, Versandart, Belege und **„Etikett und Belege am Touch-Packtisch automatisch drucken“**.
2. Am Lagerrechner einmal mit E-Mail und Passwort anmelden, den Packtisch öffnen und den Packplatz wählen.
3. Oben **„Gerät für PIN freigeben“** tippen, danach **„Abmelden“**.
4. Ab jetzt zeigt der Rechner „Wer packt?“.

Ein Gerät lässt sich unter **Packtisch › Packplätze › Freigegebene Geräte** widerrufen (z. B. bei Verlust oder Austausch). Alle Packer an diesem Gerät sind dann sofort abgemeldet.

## 4. PINs vergeben

- Jede Person mit dem Recht **„Packen“** kann unter **Profil & Sicherheit › PIN für den Packtisch** eine eigene PIN festlegen (4–6 Ziffern, mit dem eigenen Passwort bestätigt).
- Oder der Administrator vergibt sie unter **Benutzer › PIN**.
- Zu einfache PINs (1111, 1234 …) werden abgelehnt. Nach 5 falschen Eingaben ist die PIN 15 Minuten gesperrt.

## 5. Im Alltag

- Name antippen, PIN eingeben, packen.
- **Problem** (Artikel fehlt, beschädigt …): Der Auftrag wird zurückgestellt und erscheint im Büro unter „In Bearbeitung“.
- Nach 15 Minuten ohne Eingabe meldet der Packtisch automatisch ab, spätestens nach 12 Stunden.
- Mit PIN ist nur der Packtisch erreichbar, nicht der Rest der Warenwirtschaft.

## Noch nicht enthalten

- Gewicht automatisch von einer USB-Waage übernehmen (braucht das Waagenmodell).
- Etiketten von DHL, DPD, GLS usw. (brauchen Zugangsdaten und einen Test im Testsystem des Versanddienstleisters).
