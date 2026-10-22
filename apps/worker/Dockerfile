# ThinkMade worker: research, scripts, quality review, Kokoro speech and ffmpeg assembly.
# Built for the Oracle Cloud Always Free Ampere A1 VM (linux/arm64); also runs on x86-64.
#   docker build -f apps/worker/Dockerfile -t thinkmade-worker .
#   docker run -d --restart unless-stopped --env-file worker.env --name thinkmade-worker thinkmade-worker
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    WORK_DIR=/tmp/thinkmade-work \
    HF_HOME=/models

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
# Workspace manifests the lockfile refers to (sources are not needed by the worker).
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --workspace apps/worker --include-workspace-root=false --omit=dev --ignore-scripts=false \
 && npm install --no-save tsx@4 \
 && mkdir -p /models /tmp/thinkmade-work \
 && chown -R node:node /app /models /tmp/thinkmade-work

USER node
# The worker only makes outbound connections (Postgres, object storage, model APIs). No ports are exposed.
CMD ["npx", "tsx", "apps/worker/src/main.ts"]
