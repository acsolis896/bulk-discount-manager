# Backup and recovery (data loss prevention)

## Layers
1. **Railway volume backups** on the production Postgres service: daily, weekly and
   monthly schedules (Service settings, Backups tab). Protects against routine
   mistakes. Restores into a new volume and requires a manual Deploy.
2. **Encrypted offsite logical dumps** (`scripts/backup/backup.sh`) run daily by a
   Railway cron service built from `scripts/backup/Dockerfile`. Each dump is
   gzip-compressed and encrypted with `age` before upload, so the bucket only holds
   ciphertext. Dumps older than `BACKUP_RETENTION_DAYS` (default 35) are pruned.
   This layer survives deletion of the Railway project itself.

## Keys
- The `age` private key is stored offline (password manager secure note plus one
  offline copy). Only the public key (`AGE_RECIPIENT`) is set in Railway.
- Losing the private key means the encrypted dumps cannot be restored.

## Restore procedure
1. Download a dump: `aws s3 cp s3://$BACKUP_BUCKET/db/<file> . --endpoint-url $BACKUP_ENDPOINT`
2. Decrypt and load into an empty database:
   `age -d -i key.txt <file> | gunzip | psql "$TARGET_DATABASE_URL"`
3. Point the app's `DATABASE_URL` at it and redeploy, or restore the Railway volume
   backup instead for a same-project recovery.

## Verification checklist (owner confirms, with dates)
- [ ] Railway volume backups enabled and showing recent runs
- [ ] Backup cron service has run successfully at least twice
- [ ] A dump was downloaded, confirmed unreadable without the key, and restored into
      the staging database
- [ ] Private key stored offline and recovery tested
- [ ] Restore test repeated yearly
