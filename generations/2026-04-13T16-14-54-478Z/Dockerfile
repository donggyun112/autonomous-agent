# Autonomous agent Docker image — the shell is the image.
# The agent molts by building a new image and migrating into it.

FROM node:22-alpine

WORKDIR /agent

# Install system dependencies: docker CLI (for molting), curl (for web_search), bash
RUN apk add --no-cache docker-cli curl bash

# Copy the build context: src/, package.json, pnpm-lock.yaml, tsconfig.json
COPY src /agent/src
COPY package.json /agent/package.json
COPY pnpm-lock.yaml /agent/pnpm-lock.yaml
COPY tsconfig.json /agent/tsconfig.json

# Install dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Build TypeScript
RUN pnpm run build

# The /agent/data directory is mounted from the host at runtime.
# Mount points: /agent/data (body), /var/run/docker.sock (for molting)

# Entrypoint: the CLI (cli.ts compiled to cli.js)
ENTRYPOINT ["node", "/agent/dist/cli.js"]
CMD []
