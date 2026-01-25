FROM node:24-slim

# Install git (required by Claude Agent SDK), curl (for cron jobs), and ca-certificates
RUN apt-get update && apt-get install -y git curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install Supercronic for cron scheduling
ENV SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 \
    SUPERCRONIC_SHA1SUM=71b0d58cc53f6bd72cf2f293e09e294b79c666d8
RUN curl -fsSLO "$SUPERCRONIC_URL" \
    && echo "${SUPERCRONIC_SHA1SUM}  supercronic-linux-amd64" | sha1sum -c - \
    && chmod +x supercronic-linux-amd64 \
    && mv supercronic-linux-amd64 /usr/local/bin/supercronic

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy built app and config
COPY dist/ ./dist/
COPY prompts/ ./prompts/
COPY crontab ./crontab

# Expose port
EXPOSE 8080

# Start script runs both server and cron
COPY start.sh ./start.sh
RUN chmod +x start.sh
CMD ["./start.sh"]
