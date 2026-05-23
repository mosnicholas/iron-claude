FROM node:24-slim

ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA

# git is required by Claude Agent SDK; curl + ca-certificates for general HTTPS.
RUN apt-get update && apt-get install -y git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/local/bin/node /usr/bin/node \
    && ln -sf /usr/local/bin/npm /usr/bin/npm

# Ensure node is in PATH for child processes (required by Claude Agent SDK).
ENV PATH="/usr/local/bin:$PATH"

WORKDIR /app

COPY package*.json ./

# Install all dependencies (need devDeps for the build step).
RUN npm ci

# Claude Code CLI is required by claude-agent-sdk.
RUN npm install -g @anthropic-ai/claude-code

# Build TypeScript → dist/.
COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build

# Drop devDependencies after build. `tsx` is in `dependencies` so the
# migration script + importer + grant-tier admin script remain runnable
# via `fly ssh`.
RUN npm prune --omit=dev

# Prompts are loaded relative to dist/src/coach, so place them at dist/prompts.
COPY prompts/ ./dist/prompts/

# Drizzle migrations + the runner. start.sh executes `npm run db:migrate`
# before serving; both inputs MUST be in the image.
COPY drizzle/ ./drizzle/
COPY scripts/ ./scripts/

EXPOSE 8080

COPY start.sh ./start.sh
RUN chmod +x start.sh
CMD ["./start.sh"]
