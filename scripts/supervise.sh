#!/usr/bin/env bash
# Host-side supervisor for autonomous-agent.
#
# Runs the agent container via docker compose. When the container exits
# with code 42 (molt swap requested), this script force-recreates the
# container so it boots from the newly retagged autonomous-agent:current.
#
# Usage:
#   ./scripts/supervise.sh
#
# This replaces `docker compose up` as the primary run command when molt
# support is needed. Without this script, `restart: unless-stopped` in
# compose just restarts the same container pinned to the old image.

set -euo pipefail
cd "$(dirname "$0")/.."

echo "[supervise] starting autonomous-agent supervisor"
echo "[supervise] Ctrl+C to stop"

while true; do
  echo "[supervise] starting container..."
  # Run in foreground so we get the exit code.
  docker compose up --exit-code-from agent agent || true
  EXIT_CODE=$?

  echo "[supervise] container exited with code $EXIT_CODE"

  if [ "$EXIT_CODE" -eq 42 ]; then
    echo "[supervise] molt swap detected (exit 42). force-recreating container with new image..."
    docker compose up -d --force-recreate agent
    # Wait for the new container to start, then re-attach.
    sleep 2
    docker compose logs -f agent || true
    # If logs -f exits (container stopped), loop back.
    continue
  fi

  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "[supervise] clean exit. stopping."
    break
  fi

  # Any other exit code — restart after a brief pause.
  echo "[supervise] unexpected exit. restarting in 10s..."
  sleep 10
done

echo "[supervise] supervisor stopped."
