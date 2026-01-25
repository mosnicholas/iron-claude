#!/bin/bash
set -e

# Start supercronic in background
supercronic /app/crontab &

# Start the Node.js server (foreground)
exec node /app/dist/src/server.js
