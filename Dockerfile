FROM node:24-slim

ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA

# git for any future repo-aware tooling; curl + ca-certs for general HTTPS.
RUN apt-get update && apt-get install -y git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/local/bin/node /usr/bin/node \
    && ln -sf /usr/local/bin/npm /usr/bin/npm

ENV PATH="/usr/local/bin:$PATH"

WORKDIR /app

COPY package*.json ./

# Install all dependencies (need devDeps for the build step).
RUN npm ci

# Build TypeScript → dist/.
COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build

# Drop devDependencies after build. `tsx` is in `dependencies` so the
# migration script + importer + grant-tier admin script remain runnable
# via `fly ssh`.
RUN npm prune --omit=dev

# Drizzle migrations + the runner. start.sh executes `npm run db:migrate`
# before serving; both inputs MUST be in the image.
COPY drizzle/ ./drizzle/
COPY scripts/ ./scripts/

EXPOSE 8080

COPY start.sh ./start.sh
RUN chmod +x start.sh
CMD ["./start.sh"]

