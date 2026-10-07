# Security incident response policy

Owner: Andrea Solis (sole operator), acsolis896@gmail.com
Scope: Airtight Discount Code Rules and the Bajio Discounts app, including the Railway
hosting, databases, Shopify Partner accounts and GitHub repositories.

## What counts as an incident
Any confirmed or suspected: unauthorized access to the database, hosting, Shopify
Partner or GitHub accounts; leaked credentials (API secret, database URL, access
tokens, backup keys); exposure of customer or shop data; or data loss.

## Response steps
1. **Detect and record.** Note the time, what was seen, and who or what reported it
   (Railway alert, Shopify notice, merchant report, own observation). Start an
   incident note with timestamps from this point on.
2. **Contain (same day).** Rotate whatever may be exposed:
   - Railway database password (and update `DATABASE_URL`),
   - Shopify app client secret (Partner Dashboard, then update `SHOPIFY_API_SECRET`),
   - Railway, GitHub and Shopify Partner passwords/sessions; revoke API tokens,
   - the backup bucket access keys.
   If a vulnerability is being exploited, disable the affected feature (feature
   flags in `app/feature-flags.ts`) or unpublish the affected route and redeploy.
3. **Assess.** Use `PersonalDataAccessLog`, Railway logs and Shopify's app logs to
   determine which shops and customer records were affected and for how long.
4. **Notify.** Tell affected merchants and Shopify (Partner support) without undue
   delay, with a target of within 72 hours of confirming personal data was affected.
   Say what happened, what data was involved, what was done, and what to expect.
5. **Recover.** Restore from the latest verified backup if data was lost or altered
   (see `backup-and-recovery.md`), redeploy, and confirm normal operation.
6. **Review.** Within 7 days write down the root cause, what worked, and what
   changes will prevent a repeat. Update this policy and the other documents here.

## Annual review
Re-read this policy and run a backup restore test once a year, or after any incident.
