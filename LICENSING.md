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
