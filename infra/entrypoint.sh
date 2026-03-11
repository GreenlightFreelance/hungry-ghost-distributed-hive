#!/bin/bash
set -euo pipefail

# --- Graceful shutdown handler for Fargate Spot interruption ---
SHUTDOWN_REQUESTED=0
STATE_SYNC_PID=""

graceful_shutdown() {
  echo "[entrypoint] SIGTERM received — initiating graceful shutdown (120s budget)"
  SHUTDOWN_REQUESTED=1

  # Save run state marker to EFS for potential recovery
  if [ -d /workspace ]; then
    echo "{\"interrupted\":true,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"run_id\":\"${RUN_ID:-unknown}\"}" \
      > /workspace/.spot-interrupted 2>/dev/null || true
    echo "[entrypoint] Spot interruption state saved to /workspace/.spot-interrupted"
  fi

  # Stop state sync adapter gracefully (let it flush final state)
  if [ -n "$STATE_SYNC_PID" ] && kill -0 "$STATE_SYNC_PID" 2>/dev/null; then
    echo "[entrypoint] Stopping state sync adapter (PID $STATE_SYNC_PID)..."
    kill -TERM "$STATE_SYNC_PID" 2>/dev/null || true
    wait "$STATE_SYNC_PID" 2>/dev/null || true
    echo "[entrypoint] State sync adapter stopped."
  fi

  # Stop the manager daemon (foreground process)
  if [ -n "${MANAGER_PID:-}" ] && kill -0 "$MANAGER_PID" 2>/dev/null; then
    echo "[entrypoint] Stopping manager daemon (PID $MANAGER_PID)..."
    kill -TERM "$MANAGER_PID" 2>/dev/null || true
    wait "$MANAGER_PID" 2>/dev/null || true
  fi

  echo "[entrypoint] Graceful shutdown complete."
  exit 0
}

trap graceful_shutdown SIGTERM SIGINT

# 1. Fetch secrets from AWS Secrets Manager
export ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
  --secret-id "$ANTHROPIC_KEY_ARN" --query SecretString --output text)
export GITHUB_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "$GITHUB_TOKEN_ARN" --query SecretString --output text)

# 2. Configure git
git config --global user.name "Distributed Hive"
git config --global user.email "hive@distributed-hive.com"
echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
git config --global credential.helper store

# 3. Initialize hive workspace
mkdir -p /workspace && cd /workspace
hive init

# 4. Clone repos from the run config
for repo in $(echo "$REPO_URLS" | jq -r '.[]'); do
  hive add-repo "$repo"
done

# 5. Apply user config overrides
if [ -n "${HIVE_CONFIG_OVERRIDE:-}" ]; then
  echo "$HIVE_CONFIG_OVERRIDE" > .hive/hive.config.yaml
fi

# 6. Start state sync adapter (background)
node /opt/hive/dist/adapters/state-sync.js \
  --run-id "$RUN_ID" \
  --table "$DYNAMODB_TABLE" \
  --event-bus "$EVENTBRIDGE_BUS" &
STATE_SYNC_PID=$!

# 7. Submit requirement and run
hive req "$REQUIREMENT_TITLE" --description "$REQUIREMENT_DESCRIPTION"
hive assign

# 8. Start manager daemon (foreground — keeps container alive)
hive manager start --no-daemon --verbose &
MANAGER_PID=$!
wait "$MANAGER_PID" || true

# Manager exits when all stories are merged or max runtime exceeded
echo "Run complete. Shutting down."
