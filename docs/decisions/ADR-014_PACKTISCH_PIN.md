# ADR-014: PIN-Anmeldung am Touch-Packtisch

- **Status:** angenommen
- **Datum:** 2026-11-12

## Kontext

Packer arbeiten an gemeinsam genutzten Lagerrechnern mit Touchscreen. Eine Anmeldung mit E-Mail und langem Passwort bei jedem Schichtwechsel ist dort unpraktisch und verleitet dazu, angemeldet zu bleiben oder Zugangsdaten zu teilen. Gewünscht ist eine schnelle Anmeldung mit Name und kurzer PIN – ohne die Sicherheit der übrigen Warenwirtschaft zu schwächen.

## Entscheidung

1. **Nur freigegebene Geräte.** Ein Lagerleiter (Recht `shipping.manage`) gibt einen Rechner einmal für einen Packplatz frei. Der Server setzt dabei ein httpOnly-Cookie (`fe_packing_device`, `SameSite=Strict`, 1 Jahr) mit Account-, Firmen- und Geräte-ID sowie einem Zufallstoken (256 Bit). In `packing_devices` (RLS je Account und Firma) steht nur der SHA-256-Hash. Freigaben sind jederzeit widerrufbar; der Widerruf beendet alle PIN-Sitzungen des Geräts.
2. **PIN je Person und Account** in `packer_pins` (RLS je Account), 4–6 Ziffern, keine trivialen Folgen, gespeichert als Argon2id-Hash. Festlegen: selbst (mit Passwort bestätigt) oder durch einen Administrator (`users.manage`). Die PIN wird nie ausgegeben.
3. **Sperre:** nach 5 falschen PINs 15 Minuten gesperrt (auch die richtige PIN); zusätzlich Rate-Limits je IP und je Person. Unbekannte Personen kosten dieselbe Prüfzeit.
4. **Eingeschränkte Sitzung:** Die PIN-Anmeldung erzeugt eine normale Serversitzung mit `scope = 'packing'`, Firma und Gerät, höchstens 12 Stunden. Der zentrale `AccessGuard` lässt damit nur Endpunkte mit `@AllowPackingScope()` zu (Warteschlange, Auftrag laden, Abschluss, Problem melden, Etikett/Beleg-PDF, Sitzung, Abmelden) und erzwingt die Firma des Geräts. Rechte und Lizenz der Person gelten unverändert zusätzlich. Die Oberfläche meldet nach 15 Minuten ohne Eingabe ab.
5. **Kein neues globales Verzeichnis:** Das Cookie enthält Account und Firma, daher kann das Gerät direkt im Mandantenkontext (RLS) geprüft werden.

## Folgen

- Packer können sich in Sekunden an- und abmelden; jede Aktion bleibt der Person zugeordnet (Audit-Log, Verlauf).
- Eine gestohlene PIN nützt ohne freigegebenes Gerät nichts; ein gestohlenes Geräte-Cookie nützt ohne PIN nichts und reicht nur bis zum Packtisch.
- Neue Packtisch-Endpunkte müssen bewusst mit `@AllowPackingScope()` markiert werden; alles andere ist für PIN-Sitzungen automatisch gesperrt.
