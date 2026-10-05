# Data retention

| Data | Why it's kept | Retention |
|---|---|---|
| Shop sessions and access tokens | Make API calls for the installed shop | Until uninstall; deleted by the shop redact webhook (48h after uninstall) |
| Discount configuration (codes, rules, eligible items) | Run the discounts | Until the discount is deleted or the shop uninstalls |
| `CodeUsageCount` (customer id per reusable code) | Enforce per-customer use limits | While the code exists; orphaned rows removed by `scripts/retention.mjs`; removed on customer redact |
| `CodeRedemption` (order reference, total, code, customer id) | Code performance reporting | 24 months (`RETENTION_REDEMPTION_DAYS`); customer id removed on customer redact |
| `PersonalDataAccessLog` | Audit trail of customer-data handling | 12 months (`RETENTION_ACCESS_LOG_DAYS`) |
| Encrypted database backups | Disaster recovery | 35 days offsite (`BACKUP_RETENTION_DAYS`); Railway volume backups per their schedule |

Not stored: customer names, email addresses, phone numbers, or physical addresses.
The shipping country used by the country restriction is read inside Shopify Functions
at checkout and is never stored by the app.

Mandatory privacy webhooks: `customers/data_request` (logged; nothing beyond what
Shopify holds), `customers/redact` and `shop/redact` (delete the rows above).

`scripts/retention.mjs` runs daily as a Railway cron service. Use `--dry-run` to
preview.
