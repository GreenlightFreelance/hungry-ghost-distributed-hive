import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const infraDir = join(__dirname, '..');
const dockerfile = readFileSync(join(infraDir, 'Dockerfile'), 'utf-8');
const entrypoint = readFileSync(join(infraDir, 'entrypoint.sh'), 'utf-8');

describe('Dockerfile', () => {
  it('uses node:20-slim as base image', () => {
    expect(dockerfile).toMatch(/^FROM node:20-slim/m);
  });

  it('installs required system dependencies', () => {
    const requiredDeps = ['tmux', 'git', 'curl', 'jq', 'openssh-client'];
    for (const dep of requiredDeps) {
      expect(dockerfile).toContain(dep);
    }
  });

  it('installs Claude CLI globally', () => {
    expect(dockerfile).toContain('npm install -g @anthropic-ai/claude-code');
  });

  it('installs GitHub CLI', () => {
    expect(dockerfile).toContain('apt-get install -y gh');
  });

  it('installs AWS CLI', () => {
    expect(dockerfile).toContain('awscli');
  });

  it('copies hive source and builds', () => {
    expect(dockerfile).toContain('COPY . /opt/hive');
    expect(dockerfile).toContain('npm ci && npm run build');
  });

  it('copies and sets entrypoint', () => {
    expect(dockerfile).toContain('COPY infra/entrypoint.sh /opt/entrypoint.sh');
    expect(dockerfile).toContain('chmod +x /opt/entrypoint.sh');
    expect(dockerfile).toContain('ENTRYPOINT ["/opt/entrypoint.sh"]');
  });

  it('cleans up apt cache to reduce image size', () => {
    expect(dockerfile).toContain('rm -rf /var/lib/apt/lists/*');
  });
});

describe('entrypoint.sh', () => {
  it('starts with bash strict mode', () => {
    expect(entrypoint).toMatch(/^#!\/bin\/bash\nset -euo pipefail/m);
  });

  it('fetches ANTHROPIC_API_KEY from Secrets Manager when not in LOCAL_MODE', () => {
    expect(entrypoint).toContain('ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value');
    expect(entrypoint).toContain('ANTHROPIC_KEY_ARN');
  });

  it('fetches GITHUB_TOKEN from Secrets Manager when not in LOCAL_MODE', () => {
    expect(entrypoint).toContain('GITHUB_TOKEN=$(aws secretsmanager get-secret-value');
    expect(entrypoint).toContain('GITHUB_TOKEN_ARN');
  });

  it('detects LOCAL_MODE and skips Secrets Manager calls', () => {
    expect(entrypoint).toContain('LOCAL_MODE');
    expect(entrypoint).toContain('skipping Secrets Manager');
  });

  it('uses env var API keys directly in LOCAL_MODE', () => {
    // In LOCAL_MODE, ANTHROPIC_API_KEY and GITHUB_TOKEN are set from env vars
    expect(entrypoint).toMatch(/LOCAL_MODE.*true/);
    expect(entrypoint).toContain('ANTHROPIC_API_KEY=');
    expect(entrypoint).toContain('GITHUB_TOKEN=');
  });

  it('configures git credentials', () => {
    expect(entrypoint).toContain('git config --global user.name');
    expect(entrypoint).toContain('git config --global credential.helper store');
    expect(entrypoint).toContain('.git-credentials');
  });

  it('initializes hive workspace in /workspace', () => {
    expect(entrypoint).toContain('mkdir -p /workspace && cd /workspace');
    expect(entrypoint).toContain('hive init');
  });

  it('clones repos from REPO_URLS env var', () => {
    expect(entrypoint).toContain('REPO_URLS');
    expect(entrypoint).toContain('hive add-repo');
  });

  it('supports optional config override', () => {
    expect(entrypoint).toContain('HIVE_CONFIG_OVERRIDE');
    expect(entrypoint).toContain('.hive/hive.config.yaml');
  });

  it('starts state sync adapter in background', () => {
    expect(entrypoint).toContain('state-sync.js');
    expect(entrypoint).toContain('RUN_ID');
    expect(entrypoint).toContain('DYNAMODB_TABLE');
    expect(entrypoint).toContain('EVENTBRIDGE_BUS');
    expect(entrypoint).toMatch(/state-sync\.js[\s\S]*?&/m);
  });

  it('submits requirement and assigns stories', () => {
    expect(entrypoint).toContain('hive req "$REQUIREMENT_TITLE"');
    expect(entrypoint).toContain('hive assign');
  });

  it('starts manager in foreground (no-daemon mode)', () => {
    expect(entrypoint).toContain('hive manager start --no-daemon --verbose');
  });
});
