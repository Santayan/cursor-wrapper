# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install dependencies needed to run cursor-agent and the install script.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
      bash \
    && rm -rf /var/lib/apt/lists/*

# Install cursor-agent into a system-wide path.
# The official install script downloads the correct binary for the platform.
# To pin to a specific version, replace with a direct download:
#   curl -fsSL https://cursor.com/install/cursor-agent?version=X.Y.Z | bash
# cursor-agent is a shell script that references $SCRIPT_DIR/node and
# $SCRIPT_DIR/index.js. We must keep the full versioned directory intact;
# copying only the script breaks it. Move the whole tree to /opt and symlink.
RUN curl -fsSL https://cursor.com/install | bash \
    && mv ~/.local/share/cursor-agent /opt/cursor-agent \
    && chmod -R 755 /opt/cursor-agent \
    && ln -sf "$(find /opt/cursor-agent/versions -maxdepth 2 -name cursor-agent -type f | head -1)" \
              /usr/local/bin/cursor-agent

# Create a non-root user to run the service.
RUN groupadd --system cursorwrapper \
    && useradd --system --gid cursorwrapper --shell /bin/false cursorwrapper

# Create and own the default job working directory.
RUN mkdir -p /var/cursor-jobs && chown cursorwrapper:cursorwrapper /var/cursor-jobs

WORKDIR /app

# Copy compiled output and config from the builder stage.
COPY --from=builder /app/dist dist/
COPY config/ config/

# The app files are owned by root and read-only to the service user — intentional.
RUN chown -R root:cursorwrapper /app && chmod -R 750 /app

USER cursorwrapper

# ── Defaults (override via env or docker-compose) ────────────────────────────
ENV CURSOR_BIN=/usr/local/bin/cursor-agent
ENV CURSOR_WORKDIR_ROOT=/var/cursor-jobs
ENV CURSOR_WRAPPER_PORT=3000
ENV CURSOR_TIMEOUT_MS=120000
ENV CURSOR_MAX_OUTPUT_BYTES=1048576
ENV CURSOR_MAX_CONCURRENCY=2
ENV CURSOR_ALLOWLIST_PATH=/app/config/allowlist.json

# node:20-slim sets NODE_OPTIONS=--use-system-ca which cursor-agent's bundled
# Node runtime doesn't recognise. Clear it for all processes in the container.
ENV NODE_OPTIONS=

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
