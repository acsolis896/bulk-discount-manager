#!/usr/bin/env bash
# Encrypted offsite database backup. The dump is encrypted with age BEFORE it
# leaves this machine, so the storage bucket only ever holds ciphertext (Railway
# buckets don't provide server-side encryption). Only the PUBLIC key lives here;
# the private key is kept offline and is needed to restore.
#
# Required env: DATABASE_URL, AGE_RECIPIENT (age public key, starts with "age1"),
# BACKUP_BUCKET, BACKUP_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
# Optional: AWS_DEFAULT_REGION (default auto), BACKUP_RETENTION_DAYS (default 35).
set -euo pipefail

: "${DATABASE_URL:?}" "${AGE_RECIPIENT:?}" "${BACKUP_BUCKET:?}" "${BACKUP_ENDPOINT:?}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-35}"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="/tmp/backup-${STAMP}.sql.gz.age"

pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip | age -r "$AGE_RECIPIENT" > "$FILE"

# Refuse to upload anything that isn't an age file (guards against a failed pipe).
head -c 22 "$FILE" | grep -q "age-encryption.org" || { echo "Backup is not age-encrypted; aborting" >&2; exit 1; }

aws s3 cp "$FILE" "s3://${BACKUP_BUCKET}/db/$(basename "$FILE")" --endpoint-url "$BACKUP_ENDPOINT"
rm -f "$FILE"
echo "Uploaded db/backup-${STAMP}.sql.gz.age"

CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)"
aws s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix db/ --endpoint-url "$BACKUP_ENDPOINT" \
  --query "Contents[?LastModified<='${CUTOFF}'].Key" --output text | tr '\t' '\n' | while read -r KEY; do
  [ -n "$KEY" ] && [ "$KEY" != "None" ] && aws s3 rm "s3://${BACKUP_BUCKET}/${KEY}" --endpoint-url "$BACKUP_ENDPOINT" && echo "Pruned ${KEY}"
done
exit 0
