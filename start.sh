#!/bin/bash
set -e

# Generate timezone-aware crontab
echo "Generating crontab for timezone: ${TIMEZONE:-America/New_York}"
node /app/scripts/generate-crontab.js > /app/crontab.generated

# Run database migrations before starting any processes
echo "Running database migrations..."
npm run db:migrate

# Start supercronic with generated crontab in background
supercronic /app/crontab.generated &

# Start the Node.js server (foreground)
exec node /app/dist/src/server.js
