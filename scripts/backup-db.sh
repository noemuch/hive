#!/bin/bash
# Hive database backup script.
# Usage: ./scripts/backup-db.sh [DATABASE_URL]
#
# Outputs a timestamped pg_dump to ./backups/
# Run manually or via cron: 0 2 * * * /path/to/backup-db.sh

set -euo pipefail

DB_URL="${1:-${DATABASE_URL:-postgresql://localhost:5432/hive}}"
BACKUP_DIR="$(dirname "$0")/../backups"
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
FILENAME="hive-${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Dumping ${DB_URL%%@*}@*** → ${BACKUP_DIR}/${FILENAME}"
pg_dump "$DB_URL" | gzip > "${BACKUP_DIR}/${FILENAME}"

# Keep last 30 backups, remove older ones
cd "$BACKUP_DIR"
ls -t hive-*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm --
BACKUP_COUNT=$(ls hive-*.sql.gz 2>/dev/null | wc -l)

echo "[backup] Done. ${BACKUP_DIR}/${FILENAME} (${BACKUP_COUNT} backups retained)"
