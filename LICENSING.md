# Lizenzierung

Stand: Phase 1 (Lizenz-**Kern**). Abonnements, Zahlungen, Kundenportal und Marketplace folgen in Phase 7.

## Prinzip

- Das Lizenzsystem ist **nicht** in die Module einprogrammiert. Module erklären nur, was sie brauchen (`@RequiresModule('orders')`, Limits über `canAdd(...)`). Die Auswertung liegt zentral in `packages/licensing` und im `AccessGuard`.
- Alle Prüfungen erfolgen **serverseitig**.
- Lizenzstand je Account: Tabelle `entitlements`; jede Änderung landet in `entitlement_events` (unveränderlich).

## Pakete (vorläufig, Playbook 6.1)

| Paket        | Preis/Monat | Module                                                                    |
| ------------ | ----------- | ------------------------------------------------------------------------- |
| Starter      | 199 €       | Core, Dashboard, Artikel, Kunden, Lieferanten, Aufträge, Lager, Dokumente |
| Business     | 299 €       | Starter + Einkauf, Pack, Versand, Retouren, Import                        |
| Professional | 499 €       | Business + Multichannel, Finanzen, API, Automatisierung, CRM, Analytics   |
| Enterprise   | individuell | alle Module                                                               |

Preise und Modulzuordnung sind **Platzhalter** und müssen kalkuliert werden (`packages/licensing/src/catalog.ts`). Benutzerlimits je Paket sind im Playbook nicht festgelegt und daher derzeit unbegrenzt (`null`).

## Lizenzarten und Umsetzungsstand

| Lizenzart                     | Stand                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| A. Grundlizenz (Paket)        | ✅ `plan`, `modules`                                                                           |
| B. Firmenlizenz (3 inklusive) | ✅ `max_companies`, geprüft beim Anlegen und Wiederherstellen; archivierte Firmen zählen nicht |
| C. Benutzerlizenz             | ✅ `max_users`, zählt aktive Mitglieder + offene Einladungen                                   |
| D. Modullizenz                | ✅ `modules` + `@RequiresModule`; Rechte nicht gebuchter Module sind wirkungslos               |
| E. Schnittstellenlizenz       | ⏳ Feld `max_connectors` vorhanden, Prüfung kommt mit den Connectoren (Phase 5)                |
| F. Individuelle Integration   | ⏳ Phase 7                                                                                     |

## Hinweis Phase 2

Neues Recht `custom_fields.manage` (Modul Core). Systemrollen erhalten neue Rechte automatisch, weil ihre Rechte aus dem Code gelesen werden. Dashboard-Widgets und Menüeinträge erscheinen nur, wenn Recht und Modul vorhanden sind.

## Hinweis Phase 3a

Die Module **Artikel, Kunden, Lieferanten und Lager** sind verfügbar (`available: true`) und im Paket Starter enthalten. Ohne gebuchtes Modul antwortet die API mit `MODULE_NOT_LICENSED`; Menüpunkte und Rechte des Moduls sind dann wirkungslos.

## Hinweis Phase 3b

Die Module **Aufträge** und **Dokumente** (Belege) sind verfügbar und im Paket Starter enthalten. **Einkauf** ist verfügbar und ab Paket Business enthalten. Weil Systemrollen alle Rechte im Code haben, können Administratoren die Rolle „Administrator“ auch dann weitergeben, wenn Rechte noch nicht gebuchter Module darin stecken; diese Rechte wirken erst mit der Buchung. Wer eine eigene Rolle ohne diese Rechte hat, kann sie nicht vergeben.

## Hinweis Phase 4

Picklisten und die mobile Scan-Seite gehören zum Modul **Lager** (alle Pakete). **FangEvo Pack**, **Versand** und **Retouren** sind ab Paket **Business** enthalten.

## Hinweis Phase 5

**FangEvo Import** ist ab Paket Business enthalten, **Öffentliche API** und **Multichannel** ab Professional. API-Schlüssel funktionieren nur, solange das Modul „Öffentliche API“ gebucht ist.

## Status und Zugriff

| Status                  | Zugriff                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `TRIAL`                 | voll bis `trial_ends_at` (14 Tage ab Registrierung), danach nur lesen                                               |
| `ACTIVE`                | voll (bis `valid_until`, falls gesetzt)                                                                             |
| `PAST_DUE`              | voll. Eine fehlgeschlagene Zahlung sperrt nicht sofort                                                              |
| `SUSPENDED`, `CANCELED` | **nur lesen**: Daten bleiben vollständig erhalten und exportierbar, Abmelden und Kontoeinstellungen bleiben möglich |

## Lizenz ändern (bis Phase 7)

Nur FangEvo-intern über das Plattform-Werkzeug (schreibt die Historie mit):

```bash
pnpm --filter @fangevo/database license:set -- --account <account-id> --plan business --status ACTIVE --max-companies 5
```
