#!/bin/bash
set -euo pipefail

# ── Graceful shutdown handler for Fargate Spot interruptions ──
# Fargate sends SIGTERM with a 120-second grace period before SIGKILL.
# We save hive state and agent logs to EFS so a retry can resume.
EFS_CHECKPOINT_DIR="/workspace/checkpoints/${RUN_ID:-unknown}"

graceful_shutdown() {
  echo "[SIGTERM] Spot interruption detected. Saving state to EFS..."
  mkdir -p "$EFS_CHECKPOINT_DIR"

  # Save hive state snapshot
  if [ -d "/workspace/.hive" ]; then
    cp -r /workspace/.hive "$EFS_CHECKPOINT_DIR/hive-state" 2>/dev/null || true
  fi

  # Save agent logs
  if [ -d "/workspace/agent-logs" ]; then
    cp -r /workspace/agent-logs "$EFS_CHECKPOINT_DIR/agent-logs" 2>/dev/null || true
  fi

  # Save run metadata
  echo "{\"runId\":\"${RUN_ID:-unknown}\",\"interruptedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"reason\":\"spot-interruption\"}" \
    > "$EFS_CHECKPOINT_DIR/interrupt-meta.json"

  echo "[SIGTERM] State saved to $EFS_CHECKPOINT_DIR. Exiting."
  exit 0
}

trap graceful_shutdown SIGTERM SIGINT

# 1. Fetch secrets — LOCAL_MODE skips Secrets Manager, uses env vars directly
if [ "${LOCAL_MODE:-false}" = "true" ]; then
  echo "[entrypoint] LOCAL_MODE=true — using env var API keys directly (skipping Secrets Manager)"
  export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-sk-ant-local-placeholder}"
  export GITHUB_TOKEN="${GITHUB_TOKEN:-ghp-local-placeholder}"
else
  export ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
    --secret-id "$ANTHROPIC_KEY_ARN" --query SecretString --output text)
  export GITHUB_TOKEN=$(aws secretsmanager get-secret-value \
    --secret-id "$GITHUB_TOKEN_ARN" --query SecretString --output text)
fi

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

# 7. Submit requirement and run
hive req "$REQUIREMENT_TITLE" --description "$REQUIREMENT_DESCRIPTION"
hive assign

# 8. Start manager daemon (background + wait — allows SIGTERM to be caught by trap)
hive manager start --no-daemon --verbose &
MANAGER_PID=$!
wait $MANAGER_PID

# Manager exits when all stories are merged or max runtime exceeded
echo "Run complete. Shutting down."
