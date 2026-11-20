# Shopify-App „FangEvo Wawi“

Kein eigener Code: Die App ist nur die „Hülle“ bei Shopify (Name, Berechtigungen, App-Adresse).
Die eigentliche Anbindung steckt in der Wawi (`apps/api/src/modules/channels/shopify`).

- `shopify.app.toml` – Konfiguration der App, mit der Shopify CLI veröffentlichbar (`shopify app deploy`).
- Einrichtung, Verbinden eines Shops und Fehlerbehebung: [docs/SHOPIFY.md](../../docs/SHOPIFY.md).
