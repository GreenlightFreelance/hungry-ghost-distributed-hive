#!/bin/bash
set -euo pipefail

SHUTDOWN_REQUESTED=0
STATE_SAVED=0

# Graceful shutdown handler for Spot interruption (SIGTERM)
graceful_shutdown() {
  echo "SIGTERM received — beginning graceful shutdown (120s grace period)..."
  SHUTDOWN_REQUESTED=1

  # Save in-progress state to EFS checkpoint
  CHECKPOINT_DIR="/workspace/.checkpoints/${RUN_ID:-unknown}"
  mkdir -p "$CHECKPOINT_DIR"

  # Save hive state database
  if [ -d "/workspace/.hive" ]; then
    cp -r /workspace/.hive "$CHECKPOINT_DIR/hive-state" 2>/dev/null || true
    echo "Saved hive state to $CHECKPOINT_DIR/hive-state"
  fi

  # Save current git work-in-progress
  for repo_dir in /workspace/repos/*/; do
    if [ -d "$repo_dir/.git" ]; then
      repo_name=$(basename "$repo_dir")
      (cd "$repo_dir" && git stash --include-untracked -m "spot-interruption-$(date +%s)" 2>/dev/null) || true
      echo "Stashed WIP in $repo_name"
    fi
  done

  # Write checkpoint metadata
  cat > "$CHECKPOINT_DIR/checkpoint.json" <<CHECKPOINT_EOF
{
  "runId": "${RUN_ID:-unknown}",
  "reason": "spot-interruption",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "dynamoTable": "${DYNAMODB_TABLE:-}",
  "eventBus": "${EVENTBRIDGE_BUS:-}"
}
CHECKPOINT_EOF

  STATE_SAVED=1
  echo "Checkpoint saved to $CHECKPOINT_DIR"

  # Stop the manager daemon gracefully
  if [ -n "${MANAGER_PID:-}" ] && kill -0 "$MANAGER_PID" 2>/dev/null; then
    kill -TERM "$MANAGER_PID" 2>/dev/null || true
    wait "$MANAGER_PID" 2>/dev/null || true
  fi

  # Stop the state sync process
  if [ -n "${SYNC_PID:-}" ] && kill -0 "$SYNC_PID" 2>/dev/null; then
    kill -TERM "$SYNC_PID" 2>/dev/null || true
    wait "$SYNC_PID" 2>/dev/null || true
  fi

  echo "Graceful shutdown complete."
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

# 3a. Restore from checkpoint if available
CHECKPOINT_DIR="/workspace/.checkpoints/${RUN_ID:-unknown}"
if [ -f "$CHECKPOINT_DIR/checkpoint.json" ]; then
  echo "Restoring from checkpoint: $CHECKPOINT_DIR"
  if [ -d "$CHECKPOINT_DIR/hive-state" ]; then
    cp -r "$CHECKPOINT_DIR/hive-state" /workspace/.hive 2>/dev/null || true
    echo "Restored hive state from checkpoint"
  fi
fi

hive init

# 4. Clone repos from the run config
for repo in $(echo "$REPO_URLS" | jq -r '.[]'); do
  hive add-repo "$repo"
done

# 4a. Restore git stashes if recovering from Spot interruption
if [ -f "$CHECKPOINT_DIR/checkpoint.json" ]; then
  for repo_dir in /workspace/repos/*/; do
    if [ -d "$repo_dir/.git" ]; then
      (cd "$repo_dir" && git stash pop 2>/dev/null) || true
    fi
  done
  echo "Checkpoint restore complete — resuming run"
fi

# 5. Apply user config overrides
if [ -n "${HIVE_CONFIG_OVERRIDE:-}" ]; then
  echo "$HIVE_CONFIG_OVERRIDE" > .hive/hive.config.yaml
fi

# 6. Start state sync adapter (background)
node /opt/hive/dist/adapters/state-sync.js \
  --run-id "$RUN_ID" \
  --table "$DYNAMODB_TABLE" \
  --event-bus "$EVENTBRIDGE_BUS" &
SYNC_PID=$!

# 7. Submit requirement and run
hive req "$REQUIREMENT_TITLE" --description "$REQUIREMENT_DESCRIPTION"
hive assign

# 8. Start manager daemon (foreground — keeps container alive)
hive manager start --no-daemon --verbose &
MANAGER_PID=$!

# Wait for manager to finish (allows trap to fire)
wait "$MANAGER_PID" || true

# Manager exits when all stories are merged or max runtime exceeded
if [ "$SHUTDOWN_REQUESTED" -eq 0 ]; then
  echo "Run complete. Shutting down."
fi
