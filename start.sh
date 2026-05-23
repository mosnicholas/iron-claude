#!/bin/bash
set -e

# Run database migrations before serving. The image carries drizzle/ and
# scripts/db-migrate.ts; tsx is in `dependencies` so it survives prune.
echo "Running database migrations..."
npm run db:migrate

# Single foreground process. Cron jobs are driven externally (cron-job.org or
# Fly scheduled machines) — running Supercronic in-container would duplicate
# cron firings across instances under horizontal scaling. See DEPLOY.md.
exec node /app/dist/src/server.js
