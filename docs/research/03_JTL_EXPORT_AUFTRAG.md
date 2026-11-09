# Auftrag für eine lokale Claude-Code-Sitzung auf dem JTL-Rechner

**Zweck:** Eigene Artikeldaten aus der JTL-Wawi von FangEvo **nur lesend** exportieren, als Testdaten und als Grundlage für den Import-Assistenten von FangEvo Wawi Pro.

**So verwenden:** In der Claude Desktop-App auf dem JTL-Rechner eine neue Claude-Code-Sitzung starten, die **lokal** läuft (nicht „Cloud“), Arbeitsordner `C:\FangEvo-Analyse`. Den folgenden Abschnitt komplett als erste Nachricht einfügen.

---

## Text zum Einfügen

Du arbeitest auf dem Windows-Rechner, auf dem JTL-Wawi läuft. Die Daten gehören uns (FangEvo). Wir brauchen einen **lesenden Export unserer Artikeldaten** als CSV-Dateien.

**Verbindliche Regeln:**

1. **Nur lesen.** Führe ausschließlich `SELECT`-Abfragen aus. Kein `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP`, `EXEC` und keine gespeicherten Prozeduren. Nichts an der JTL-Installation, an Diensten oder Einstellungen ändern.
2. **Keine Kunden- oder Personendaten.** Keine Tabellen mit Kunden, Adressen, Ansprechpartnern, Aufträgen, Rechnungen, Benutzern oder Zahlungsdaten abfragen oder exportieren.
3. **Keine Passwörter anzeigen oder speichern.** Verbinde dich mit Windows-Anmeldung (Integrated Security). Falls ein SQL-Passwort nötig ist, frage mich danach und schreibe es nirgendwo hin.
4. Vor jedem Schritt kurz erklären, was du tust, und auf mein „ok“ warten, bevor du die Datenbank zum ersten Mal abfragst.
5. Ergebnisse nur in `C:\FangEvo-Analyse\export\` ablegen.

**Schritte:**

1. Finde die SQL-Server-Instanz der JTL-Wawi und den Namen der Mandanten-Datenbank (häufig `eazybusiness`, bei mehreren Mandanten ggf. weitere). Zeige mir, was du gefunden hast, und frage, welche Datenbank genutzt werden soll.
2. Prüfe, ob `sqlcmd` oder das PowerShell-Modul `SqlServer` (`Invoke-Sqlcmd`) vorhanden ist. Nichts ohne meine Zustimmung installieren.
3. Ermittle **lesend** über `INFORMATION_SCHEMA`, in welchen Tabellen die folgenden Daten liegen. Zeige mir deinen Vorschlag, bevor du exportierst:
   - Artikel: Artikelnummer, Bezeichnung, Kurzbeschreibung, EAN/GTIN, Einheit, Gewicht, Mindestbestand, aktiv/inaktiv, Vater-/Kindartikel (Varianten), Stücklisten/Sets
   - Preise: Einkaufspreis netto, Verkaufspreis netto, ggf. Staffel- und Kundengruppenpreise
   - Steuerklassen und Steuersätze
   - Kategorien (mit Oberkategorie) und Hersteller
   - Lager und Lagerbestand je Artikel und Lager
   - Lieferanten-Artikel (Lieferanten-Artikelnummer, Einkaufspreis, Lieferzeit), **aber keine Ansprechpartner oder Adressen der Lieferanten**
4. Exportiere jede Datenart als eigene CSV-Datei (UTF-8, Trennzeichen Semikolon, mit Kopfzeile) nach `C:\FangEvo-Analyse\export\`, z. B. `artikel.csv`, `preise.csv`, `steuern.csv`, `kategorien.csv`, `hersteller.csv`, `lager.csv`, `bestand.csv`, `lieferanten_artikel.csv`, `varianten.csv`, `stuecklisten.csv`.
5. Erstelle `C:\FangEvo-Analyse\export\BERICHT.md` mit: JTL-Version (falls ermittelbar), Anzahl Datensätze je Datei, welche Felder du nicht eindeutig zuordnen konntest, und Auffälligkeiten (z. B. doppelte Artikelnummern, Artikel ohne Steuerklasse, negative Bestände).
6. Zum Schluss: Zeige mir eine kurze Zusammenfassung. Ich lade die Dateien danach selbst in die FangEvo-Sitzung hoch.

**Falls der Datenbankzugriff nicht möglich ist:** Sage es mir. Dann nutzen wir stattdessen den Export der **JTL-Ameise** (Export → Artikel) über die JTL-Oberfläche.

---

## Hinweise für FangEvo

- Es werden **nur eigene Artikeldaten** exportiert, keine personenbezogenen Daten. Die DSGVO-Fragen aus [02_JTL_CHECKLISTE.md](02_JTL_CHECKLISTE.md) betreffen diesen Export daher nicht.
- Der Export dient dem **Import eigener Daten**. Es werden keine Programmteile oder Tabellenstrukturen von JTL in FangEvo Wawi Pro übernommen. Wer die JTL-Datenbankstruktur systematisch für die Produktentwicklung untersuchen will, sollte vorher die JTL-Lizenzbedingungen prüfen (Checkliste, Abschnitt A).
- Die CSV-Dateien kommen **nicht** in das GitHub-Repository. Sie werden nur in der Entwicklungsumgebung zum Testen und für den Import-Assistenten genutzt.
