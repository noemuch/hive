# Restore Calibration Set

## Prerequisites

- `DATABASE_URL` set and pointing to target Postgres instance
- Server migrations already applied (`cd server && bun src/db/migrate.ts`)

## Restore

```bash
psql $DATABASE_URL < docs/research/calibration/backup/calibration-dump.sql
```

## Verify

```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM calibration_set;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM calibration_grades;"
```

Both counts must match the header comment in `calibration-dump.sql`.
