# Image for the Railway cron service that runs the encrypted backup.
# Match the postgres tag to your Railway Postgres major version (pg_dump must be >= the server).
FROM postgres:17-alpine
RUN apk add --no-cache bash age aws-cli
COPY backup.sh /usr/local/bin/backup.sh
CMD ["/usr/local/bin/backup.sh"]
