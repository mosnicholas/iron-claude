FROM node:24-slim

# Build arg for version tracking
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA

# Install git (required by Claude Agent SDK), curl (for cron jobs), and ca-certificates
RUN apt-get update && apt-get install -y git curl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/local/bin/node /usr/bin/node \
    && ln -sf /usr/local/bin/npm /usr/bin/npm

# Install Supercronic for cron scheduling
ENV SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 \
    SUPERCRONIC_SHA1SUM=71b0d58cc53f6bd72cf2f293e09e294b79c666d8
RUN curl -fsSLO "$SUPERCRONIC_URL" \
    && echo "${SUPERCRONIC_SHA1SUM}  supercronic-linux-amd64" | sha1sum -c - \
    && chmod +x supercronic-linux-amd64 \
    && mv supercronic-linux-amd64 /usr/local/bin/supercronic

# Ensure node is in PATH for child processes (required by Claude Agent SDK)
ENV PATH="/usr/local/bin:$PATH"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Install Claude Code CLI globally (required by claude-agent-sdk)
RUN npm install -g @anthropic-ai/claude-code

# Copy built app and config
COPY dist/ ./dist/
# Prompts are loaded relative to dist/src/coach, so place them at dist/prompts
COPY prompts/ ./dist/prompts/
COPY crontab ./crontab

# Expose port
EXPOSE 8080

# Start script runs both server and cron
COPY start.sh ./start.sh
RUN chmod +x start.sh
CMD ["./start.sh"]
