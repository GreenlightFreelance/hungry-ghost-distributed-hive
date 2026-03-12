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
  echo "[entrypoint] LOCAL_MODE=true — skipping Secrets Manager"
  if [ "${CLAUDE_CODE_USE_BEDROCK:-}" = "1" ]; then
    echo "[entrypoint] Using Bedrock (profile=${AWS_PROFILE:-default}, region=${AWS_REGION:-us-east-1}, model=${ANTHROPIC_MODEL:-})"
  else
    export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required}"
  fi
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
echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > "$HOME/.git-credentials"
git config --global credential.helper store

# 3. Set up Claude Code auth and trust workspace
# Copy host auth (mounted read-only at .claude-host) to writable .claude
cp -r "$HOME/.claude-host/." "$HOME/.claude/" 2>/dev/null || true
# Override settings to trust workspace and skip permission prompts
cat > "$HOME/.claude/settings.json" <<'SETTINGS'
{"env":{},"permissions":{"allow":["/workspace"]},"skipDangerousModePermissionPrompt":true}
SETTINGS
# Trust /workspace in claude.json so it skips the trust dialog
# Host .claude.json is mounted read-only at .claude-host.json — copy to writable .claude.json
cp "$HOME/.claude-host.json" "$HOME/.claude.json" 2>/dev/null || echo '{}' > "$HOME/.claude.json"
export CLAUDE_JSON="$HOME/.claude.json"
node -e "
const fs = require('fs');
const p = process.env.CLAUDE_JSON;
let d = {};
try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
d.projects = d.projects || {};
d.projects['/workspace'] = Object.assign(d.projects['/workspace'] || {}, { allowedTools: [], hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
fs.writeFileSync(p, JSON.stringify(d));
console.log('[entrypoint] Trusted /workspace in claude.json');
"

# 4. Initialize hive workspace (clean previous run data)
mkdir -p /workspace && cd /workspace
rm -rf .hive repos
hive init --non-interactive --source-control github --project-management none --autonomy full --agent-runtime claude

# Disable Chrome connector (no browser in container) and fix Bedrock model IDs
sed -i 's/chrome_enabled: auto/chrome_enabled: false/' .hive/hive.config.yaml
# Override model to use direct Bedrock model ID if set
if [ "${ANTHROPIC_MODEL:-}" != "" ]; then
  sed -i "s|model: claude-opus-4-6|model: ${ANTHROPIC_MODEL}|g" .hive/hive.config.yaml
  sed -i "s|model: claude-sonnet-4-5-20250929|model: ${ANTHROPIC_MODEL}|g" .hive/hive.config.yaml
  echo "[entrypoint] Overrode hive config models to ${ANTHROPIC_MODEL}"
fi

# 4. Clone repos from the run config
for repo in $(echo "$REPO_URLS" | jq -r '.[]'); do
  TEAM_NAME=$(echo "$repo" | sed 's|.*/||')
  hive add-repo --url "$repo" --team "$TEAM_NAME" || echo "Repo $repo may already exist, continuing..."
done

# 5. Apply user config overrides
if [ -n "${HIVE_CONFIG_OVERRIDE:-}" ]; then
  echo "$HIVE_CONFIG_OVERRIDE" > .hive/hive.config.yaml
fi

# 6. Submit requirement and run
hive req "$REQUIREMENT_TITLE" --title "$REQUIREMENT_TITLE" --target-branch main
hive assign

# 8. Start manager daemon (background + wait — allows SIGTERM to be caught by trap)
hive manager start --no-daemon --verbose &
MANAGER_PID=$!
wait $MANAGER_PID

# Manager exits when all stories are merged or max runtime exceeded
echo "Run complete. Shutting down."
