# Access control and staff accounts

The apps are operated by a single person (Andrea Solis). There are no employees,
contractors or other staff with access to production systems or customer data.
Access to personal data is therefore limited to the owner.

## Systems and requirements
| System | Requirement |
|---|---|
| Shopify Partner / Dev Dashboard | Unique strong password from a password manager; two-factor authentication on |
| Railway (hosting, database, backups) | Unique strong password; two-factor authentication on; project members limited to the owner |
| GitHub (source code) | Unique strong password; two-factor authentication on |
| Backup bucket and `age` private key | Access keys scoped to the backup bucket only; private key kept offline |

## Rules
- No sharing of credentials; no credentials in source control (`.env` is git-ignored).
- Production database access only when required for support or maintenance.
- If anyone else is ever given access, add them here, give them the minimum access,
  and require the same password and 2FA rules.
- Production and development use separate Shopify apps and separate databases.

## Verification checklist (owner confirms, with dates)
- [ ] 2FA enabled on Shopify Partners, Railway and GitHub
- [ ] Password manager in use for all of the above
- [ ] Railway project member list shows only the owner
- [ ] Production `DATABASE_URL` rotated after it was shared outside the system
