import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const rootDir = join(__dirname, '..', '..');
const compose = readFileSync(join(rootDir, 'docker-compose.yml'), 'utf-8');
const composeTest = readFileSync(join(rootDir, 'docker-compose.test.yml'), 'utf-8');

describe('docker-compose.yml', () => {
  it('defines a hive service', () => {
    expect(compose).toMatch(/^\s+hive:/m);
  });

  it('references the infra/Dockerfile', () => {
    expect(compose).toContain('infra/Dockerfile');
  });

  it('sets all required environment variables', () => {
    const requiredEnvVars = [
      'ANTHROPIC_KEY_ARN',
      'GITHUB_TOKEN_ARN',
      'RUN_ID',
      'DYNAMODB_TABLE',
      'EVENTBRIDGE_BUS',
      'REPO_URLS',
      'REQUIREMENT_TITLE',
      'REQUIREMENT_DESCRIPTION',
    ];
    for (const envVar of requiredEnvVars) {
      expect(compose).toContain(envVar);
    }
  });

  it('sets HIVE_CONFIG_OVERRIDE for optional config', () => {
    expect(compose).toContain('HIVE_CONFIG_OVERRIDE');
  });

  it('mounts a workspace volume', () => {
    expect(compose).toContain('hive-workspace');
    expect(compose).toContain('/workspace');
  });

  it('declares named volumes', () => {
    expect(compose).toMatch(/^volumes:/m);
  });

  it('provides default values for env vars via variable substitution', () => {
    expect(compose).toMatch(/\$\{.*:-.*\}/);
  });
});

describe('docker-compose.test.yml', () => {
  it('defines a test service', () => {
    expect(composeTest).toMatch(/^\s+test:/m);
  });

  it('references the infra/Dockerfile', () => {
    expect(composeTest).toContain('infra/Dockerfile');
  });

  it('overrides the entrypoint to run tests', () => {
    expect(composeTest).toContain('entrypoint');
    expect(composeTest).toContain('vitest');
  });

  it('sets NODE_ENV to test', () => {
    expect(composeTest).toContain('NODE_ENV: test');
  });

  it('sets stub values for all required env vars', () => {
    const requiredEnvVars = [
      'ANTHROPIC_KEY_ARN',
      'GITHUB_TOKEN_ARN',
      'RUN_ID',
      'DYNAMODB_TABLE',
      'EVENTBRIDGE_BUS',
      'REPO_URLS',
      'REQUIREMENT_TITLE',
      'REQUIREMENT_DESCRIPTION',
    ];
    for (const envVar of requiredEnvVars) {
      expect(composeTest).toContain(envVar);
    }
  });

  it('mounts a coverage volume', () => {
    expect(composeTest).toContain('./coverage');
  });
});
