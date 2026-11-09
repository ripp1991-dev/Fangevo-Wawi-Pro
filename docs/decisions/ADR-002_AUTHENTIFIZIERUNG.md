# ADR-002 – Authentifizierung

**Stand:** 2026-11-09 · **Status:** angenommen

## Kontext

ADR-001 schlug die Bibliothek Better Auth vor. Bei der Umsetzung zeigte sich: FangEvo braucht ein eigenes Account-/Firmen-/Rollenmodell mit Row-Level Security. Better Auth bringt ein eigenes Organisationsmodell und eigene Tabellen mit, die parallel gepflegt und mit RLS abgeglichen werden müssten.

## Entscheidung

Eigene, schlanke Sitzungs-Authentifizierung **auf geprüften Bausteinen**, ohne eigene Kryptografie:

- Passwort-Hashing: `@node-rs/argon2` (Argon2id, OWASP-Parameter)
- TOTP: `otplib` (RFC 6238)
- Tokens: `crypto.randomBytes` (256 Bit), gespeichert als SHA-256-Hash
- Verschlüsselung von MFA-Secrets: AES-256-GCM (Node `crypto`)
- Serverseitige Sitzungen in PostgreSQL, HttpOnly-Cookie

## Konsequenzen

- (+) Ein Datenmodell, volle Kontrolle über Mandantenkontext, Widerruf und Audit.
- (+) Alle Abläufe sind durch eigene Integrationstests abgedeckt (`apps/api/test/auth.test.ts`).
- (−) Mehr eigener Code im sicherheitskritischen Bereich. Gegenmaßnahme: Tests, Code-Review, externer Pentest vor Go-live.
- Passkeys (WebAuthn) und SSO (SAML/OIDC) sind nicht enthalten und werden bei Bedarf mit etablierten Bibliotheken ergänzt (z. B. `@simplewebauthn/server`).
