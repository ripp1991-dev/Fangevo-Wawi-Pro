# API

REST unter `/api/v1`, Health-Check unter `/health`. Maschinenlesbar: [`docs/api/openapi.json`](docs/api/openapi.json) (neu erzeugen mit `pnpm --filter @fangevo/api openapi`). Interaktiv in der Entwicklung: `http://localhost:3000/api/docs`.

## Konventionen

- **Authentifizierung:** HttpOnly-Sitzungscookie `fe_session` (SameSite=Lax, in Produktion `Secure`). API-Schlüssel für externe Systeme folgen in Phase 5.
- **CSRF:** Jede schreibende Anfrage (`POST/PUT/PATCH/DELETE`) braucht den Header `x-fangevo-csrf: 1`.
- **Firmenkontext:** Header `X-Company-Id`. Er wird serverseitig gegen die Firmenrechte geprüft. Mandant und Benutzer kommen immer aus der Sitzung, nie aus Parametern.
- **Validierung:** Zod-Schemas aus `@fangevo/shared`. Unbekannte Felder werden verworfen.
- **Fehler:** `application/problem+json` (RFC 9457) mit stabilem `code`, z. B.

```json
{
  "type": "about:blank",
  "title": "VALIDATION_FAILED",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "detail": "Eingaben sind ungültig",
  "errors": [{ "path": "email", "message": "Ungültige E-Mail-Adresse" }]
}
```

- **Optimistische Sperre:** Änderungen an Firmen schicken `version` mit; bei zwischenzeitlicher Änderung kommt `409 CONFLICT`.
- **Paginierung:** Cursor-basiert (`?cursor=…&limit=…`, Antwort `nextCursor`).

## Fehlercodes

| Code                                                                              | Bedeutung                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `VALIDATION_FAILED` (422/400)                                                     | Eingaben ungültig, Details in `errors`                     |
| `UNAUTHENTICATED` / `SESSION_EXPIRED` (401)                                       | Nicht angemeldet bzw. Sitzung abgelaufen                   |
| `INVALID_CREDENTIALS` (401)                                                       | E-Mail oder Passwort falsch                                |
| `EMAIL_NOT_VERIFIED` (403)                                                        | E-Mail-Adresse noch nicht bestätigt                        |
| `MFA_REQUIRED` / `MFA_INVALID` (401)                                              | Zwei-Faktor-Code fehlt bzw. falsch                         |
| `CSRF_HEADER_MISSING` (403)                                                       | Header `x-fangevo-csrf` fehlt                              |
| `PERMISSION_DENIED` (403)                                                         | Recht fehlt (auch beim Versuch, fremde Rechte zu vergeben) |
| `MODULE_NOT_LICENSED` (403)                                                       | Modul nicht gebucht                                        |
| `LICENSE_LIMIT_REACHED` (403)                                                     | Firmen- oder Benutzerlimit erreicht                        |
| `ACCOUNT_SUSPENDED` (403)                                                         | Account im Nur-Lese-Modus                                  |
| `COMPANY_ACCESS_DENIED` / `COMPANY_REQUIRED`                                      | Kein Zugriff auf die Firma bzw. Header fehlt               |
| `TOKEN_INVALID` (400)                                                             | Link ungültig, abgelaufen oder bereits verwendet           |
| `LAST_OWNER` (409)                                                                | Letzter Inhaber kann nicht gesperrt werden                 |
| `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500) |                                                            |

## Endpunkte (Phase 1)

**Authentifizierung** (`/auth`): `POST register`, `POST verify-email`, `POST resend-verification`, `POST login`, `POST mfa/verify`, `POST logout`, `GET session`, `POST switch-account`, `POST password/forgot`, `POST password/reset`, `POST password/change`, `PATCH profile`, `POST mfa/setup`, `POST mfa/enable`, `POST mfa/disable`, `GET sessions`, `DELETE sessions/:id`, `GET invitations/:token`, `POST invitations/accept`

**Administration:**

| Endpunkt                                                                                                     | Recht                 |
| ------------------------------------------------------------------------------------------------------------ | --------------------- |
| `GET /admin/companies`, `GET /admin/companies/:id`                                                           | `companies.read`      |
| `POST /admin/companies`, `PUT /admin/companies/:id`, `POST …/archive`, `POST …/restore`                      | `companies.manage`    |
| `GET /admin/members`, `GET /admin/members/invitations`                                                       | `users.read`          |
| `PUT /admin/members/:id/access`, `POST …/disable`, `POST …/enable`, `POST/DELETE /admin/members/invitations` | `users.manage`        |
| `GET /admin/roles`, `GET /admin/roles/permissions`                                                           | `roles.read`          |
| `POST/PUT/DELETE /admin/roles`                                                                               | `roles.manage`        |
| `GET /admin/audit`                                                                                           | `audit.read`          |
| `GET /admin/license`                                                                                         | `license.read`        |
| `PATCH /admin/account`                                                                                       | `account.manage`      |
| `GET /context/company`                                                                                       | Header `X-Company-Id` |

Webhooks, API-Schlüssel und OAuth2 für externe Systeme: Phase 5/6.

## Endpunkte (Phase 2)

| Endpunkt                                                                                      | Recht / Hinweis                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /admin/companies?q=&sort=feld:asc&filters=<JSON>&page=&pageSize=&archived=`              | `companies.read`; Antwort `{ items, total, page, pageSize }` |
| `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`          | eigene Benachrichtigungen                                    |
| `GET/PUT /notifications/preferences`                                                          | eigene Einstellungen (`{ "company.created": false }`)        |
| `GET /activity?entityType=&entityId=&cursor=&limit=`                                          | Datensatz: dessen Leserecht; gesamt: `audit.read`            |
| `GET /custom-fields?entityType=company`                                                       | alle Mitglieder                                              |
| `POST /custom-fields`, `PUT /custom-fields/:id`, `POST …/archive`, `POST …/restore`           | `custom_fields.manage`                                       |
| `GET /search?q=&limit=`                                                                       | Treffer nur mit passendem Recht und Firmenzugriff            |
| `GET/POST /views?table=`, `PUT/DELETE /views/:id`                                             | eigene bzw. freigegebene Ansichten; ändern nur Ersteller     |
| `GET/PUT /preferences/:key`, `PUT /preferences/:key/reset`                                    | persönlich (`nav`)                                           |
| `PUT /admin/preferences/:key`                                                                 | `account.manage` (Standard für alle)                         |
| `GET /dashboards`, `POST /dashboards`, `PUT/DELETE /dashboards/:id`, `POST /dashboards/reset` | persönlich                                                   |
| `POST /admin/dashboards/template`                                                             | `account.manage` (eigene Seiten als Vorlage für alle)        |

**Filter-Format:** `filters=[{"field":"country","op":"eq","value":"AT"},{"field":"cf.region","op":"in","value":["nord","west"]}]`. Operatoren: `eq`, `neq`, `contains`, `in`, `gte`, `lte`, `empty`, `notEmpty` (die letzten beiden noch nicht für eigene Felder). Unbekannte Felder → `422`.

## Endpunkte (Phase 3a)

Alle verlangen den Header **`X-Company-Id`** (aktive Firma) und das jeweilige Modul in der Lizenz.

| Endpunkt                                                                                                                                                                                                                                                                                                                                                           | Recht                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `GET /company/master-data`                                                                                                                                                                                                                                                                                                                                         | Zugriff auf die Firma (Auswahllisten)                          |
| `PUT /company/settings`, `POST/PUT /company/tax-rates`, `POST /company/tax-rates/:id/archive`, `POST/PUT /company/customer-groups`, `POST/PUT /company/categories`, `POST /company/categories/:id/archive`, `PUT /company/number-sequences/:key`, `POST/PUT /company/warehouses`, `POST /company/warehouses/:id/archive`, `POST /company/warehouses/:id/locations` | `company_settings.manage`                                      |
| `POST /company/manufacturers`                                                                                                                                                                                                                                                                                                                                      | `articles.manage`                                              |
| `GET /articles`, `GET /articles/:id`                                                                                                                                                                                                                                                                                                                               | `articles.read` (Einkaufspreise nur mit `articles.prices`)     |
| `POST /articles`, `PUT /articles/:id`, `POST …/archive`, `POST …/restore`, `POST …/variants/generate`                                                                                                                                                                                                                                                              | `articles.manage` (Preise ändern zusätzlich `articles.prices`) |
| `GET /customers`, `GET /customers/:id`                                                                                                                                                                                                                                                                                                                             | `customers.read`                                               |
| `POST/PUT /customers…`, archivieren/wiederherstellen                                                                                                                                                                                                                                                                                                               | `customers.manage`                                             |
| `GET /suppliers`, `GET /suppliers/:id`                                                                                                                                                                                                                                                                                                                             | `suppliers.read`                                               |
| `POST/PUT /suppliers…`, `PUT /suppliers/:id/articles`, `DELETE /suppliers/:id/articles/:articleId`                                                                                                                                                                                                                                                                 | `suppliers.manage` (Einkaufspreise: `articles.prices`)         |
| `GET /inventory/levels`, `GET /inventory/movements`, `GET /inventory/low-stock`                                                                                                                                                                                                                                                                                    | `inventory.read`                                               |
| `POST /inventory/bookings` (Zugang/Abgang), `POST /inventory/transfers`, `POST /inventory/corrections`                                                                                                                                                                                                                                                             | `inventory.manage`                                             |

Beträge und Mengen werden als Text übertragen (`"49.90"`, auch `"49,90"` wird akzeptiert). Neue Fehlerfälle: `COMPANY_REQUIRED` (400) ohne Firmenkontext, `CONFLICT` (409) bei zu wenig Bestand oder vergebener Nummer.

## Endpunkte (Phase 3b)

Ebenfalls mit Header **`X-Company-Id`** und gebuchtem Modul (`orders`, `documents`, `purchasing`).

| Endpunkt                                                                                                                             | Recht               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `GET /orders`, `GET /orders/:id` (mit Positionen, Statusverlauf, Fehlmengen), `GET /orders/stats`                                    | `orders.read`       |
| `POST /orders`, `PUT /orders/:id` (nur in bearbeitbaren Status, mit `version`)                                                       | `orders.manage`     |
| `POST /orders/:id/status` `{to, note}`, `POST /orders/:id/ship`, `POST /orders/:id/cancel` `{reason}`                                | `orders.manage`     |
| `GET /documents`, `GET /documents/:id`, `GET /documents/:id/pdf`, `GET /documents/stats`                                             | `documents.read`    |
| `POST /documents/from-order/:orderId` `{type}` (offer, order_confirmation, delivery_note, invoice)                                   | `documents.manage`  |
| `POST /documents/:id/finalize`, `DELETE /documents/:id` (nur Entwurf), `POST /documents/:id/send` `{to}`                             | `documents.manage`  |
| `POST /documents/:id/payments` `{amount, paidOn}`, `POST /documents/:id/credit-note`, `POST /documents/:id/cancel`                   | `documents.manage`  |
| `GET /purchase-orders`, `GET /purchase-orders/:id`, `GET /purchase-orders/:id/pdf`, `GET /purchase-orders/suggestions`               | `purchasing.read`   |
| `POST /purchase-orders`, `PUT /purchase-orders/:id` (nur Entwurf), `POST …/order`, `POST …/send`, `POST …/cancel`, `POST …/receipts` | `purchasing.manage` |

**Preise:** Bleibt `unitPriceNet` einer Artikelposition leer, ermittelt der Server den Preis (Kundengruppenpreis → Staffelpreis → Verkaufspreis; ohne eigenen Preis erbt eine Variante vom Vaterartikel) und setzt den Rabatt der Kundengruppe. Alle Summen rechnet der Server.

**Statuswechsel** sind fest vorgegeben (`ORDER_TRANSITIONS` in `packages/shared/src/schemas/sales.ts`). „Versendet“ wird nur über `/ship`, „Storniert“ nur über `/cancel` erreicht. Kommissionierung, Verpackung und Versandbereit setzen ausreichend Bestand voraus (`409` mit Fehlmengen).

**Belege:** Entwurf ohne Nummer → `finalize` vergibt die Nummer und erzeugt das PDF. Für Rechnungen, Gutschriften und Stornos sind Firmenanschrift und Steuernummer oder USt-IdNr. sowie die Kundenanschrift Pflicht (`422`). Pro Auftrag gibt es höchstens eine gültige Rechnung (`409`); nach einer Stornorechnung ist eine neue möglich. Das PDF kommt als `application/pdf`.

## Endpunkte (Phase 4)

| Endpunkt                                                                                                              | Recht / Modul                       |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `GET /scan?code=` (Artikel oder Lagerplatz mit Bestand je Platz/Charge/SN)                                            | `inventory.read` / Lager            |
| `GET/POST /articles/:id/barcodes`, `DELETE /articles/:id/barcodes/:barcodeId`                                         | `articles.read` / `articles.manage` |
| `GET /pick-lists`, `GET /pick-lists/:id`, `POST /pick-lists` `{orderIds}`, `POST …/confirm`, `…/complete`, `…/cancel` | `picking.execute` / Lager           |
| `GET /packing/stations`, `GET /packing/orders?code=`, `POST /packing/orders/:id/complete`                             | `packing.execute` / Pack            |
| `POST/PUT /packing/stations…`, `POST …/archive`                                                                       | `shipping.manage` / Pack            |
| `GET /packing/shipments`, `PUT /packing/shipments/:id/tracking`, `GET /packing/shipments/:id/label`                   | `packing.execute` / Pack            |
| `GET /returns`, `GET /returns/:id`, `GET /returns/returnable/:orderId`                                                | `returns.read` / Retouren           |
| `POST /returns`, `POST /returns/:id/receive` (`createCreditNote` zusätzlich `documents.manage`), `…/cancel`           | `returns.manage` / Retouren         |

Umlagerung und Inventur nehmen jetzt `batch` und `serialNumber` an. Bei Artikeln mit Seriennummer verlangt `POST /orders/:id/ship` den Packtisch (`409`).

## Endpunkte (Phase 5)

| Endpunkt                                                                                                                            | Recht / Modul                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `POST /imports` `{entity, fileName, contentBase64}`, `GET /imports`, `GET /imports/:id`, `POST …/validate`, `…/start`, `…/rollback` | `import.execute` / Import                          |
| `GET/POST /imports/templates`, `DELETE /imports/templates/:id`, `GET /imports/export/:entity` (CSV)                                 | `import.execute` / Import                          |
| `GET /api-keys`, `GET /api-keys/permissions`, `POST /api-keys`, `POST /api-keys/:id/revoke`                                         | `api_keys.manage` / API                            |
| `GET/POST/PUT /channels…`, `GET/PUT /channels/:id/listings…`                                                                        | `channels.read` / `channels.manage` / Multichannel |
| `POST /channels/:id/orders` (Shop-Bestellung, idempotent je `externalId`)                                                           | `channels.read` + `orders.manage`                  |
| `GET /channels/:id/stock?cursor=&limit=`                                                                                            | `channels.read` + `inventory.read`                 |
| `GET /channels/:id/orders/:externalId`                                                                                              | `channels.read` + `orders.read`                    |

**Anmeldung mit API-Schlüssel:** `Authorization: Bearer fe_live_…`. Kein Cookie, kein CSRF-Header nötig; `X-Company-Id` kann entfallen (Firma des Schlüssels). `401` bei ungültigem/gesperrtem/abgelaufenem Schlüssel, `429` bei mehr als 600 Anfragen pro Minute.

## Endpunkte (Phase 6)

| Endpunkt                                                                                                                                                                        | Recht / Modul                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `GET /webhooks/events`, `GET/POST /webhooks`, `PUT /webhooks/:id`, `POST …/rotate-secret`, `…/archive`, `…/ping`, `GET …/deliveries`, `POST …/deliveries/:deliveryId/redeliver` | `webhooks.manage` / API              |
| `GET /workflows/catalog`, `GET /workflows`, `GET /workflows/:id` (mit Versionen und Läufen)                                                                                     | `workflows.read` / Automatisierung   |
| `POST /workflows`, `PUT /workflows/:id` (neue Version), `POST …/archive`, `POST …/test` `{entityId}`                                                                            | `workflows.manage` / Automatisierung |

**Webhook-Format:** `POST` mit JSON `{id, type, createdAt, companyId, data}`; Header `X-FangEvo-Event`, `X-FangEvo-Delivery`, `X-FangEvo-Timestamp`, `X-FangEvo-Signature: sha256=HMAC(secret, timestamp + "." + body)`. Antwort 2xx = zugestellt.
