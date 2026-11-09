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
