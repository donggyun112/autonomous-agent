# ----------------------------------------------------------------------------
# autonomous-agent runtime
#
# The agent lives inside this container. The body (data/) is mounted as a
# volume from the host, so the agent's memory persists across container
# restarts. The shell (src/) may be mounted or copied in — compose uses a
# bind mount during dev so edits take effect immediately.
#
# This same image is reused by the molt protocol to sandbox candidate shells:
# the host runs `docker run --rm` with a different src mounted, runs
# self-test, and throws the container away afterward.
# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim

ENV PNPM_HOME=/usr/local/pnpm-global
ENV PATH=${PNPM_HOME}:$PATH
ENV NODE_ENV=production

# corepack ships with Node 22 — just enable pnpm
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /agent

# Install dependencies first — these change less often than src/
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Copy the shell in (dev can override with a bind mount)
COPY tsconfig.json ./
COPY src ./src

# data/ and generations/ are expected to be volumes mounted at runtime.
# Create empty targets so path resolution inside the container works.
RUN mkdir -p /agent/data /agent/generations

# Default command runs the daemon. Override with `docker run ... cycle` or
# `docker run ... status` etc.
ENTRYPOINT ["pnpm", "exec", "tsx", "src/cli.ts"]
CMD ["live"]
