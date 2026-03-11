// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handler } from './efs-cleanup.js';

const testDir = join(tmpdir(), 'efs-cleanup-test');
const checkpointsDir = join(testDir, 'checkpoints');
const runsDir = join(testDir, 'runs');

describe('efs-cleanup handler', () => {
  beforeEach(() => {
    mkdirSync(checkpointsDir, { recursive: true });
    mkdirSync(runsDir, { recursive: true });
    process.env.EFS_MOUNT_PATH = testDir;
    process.env.EFS_MAX_AGE_DAYS = '30';
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.EFS_MOUNT_PATH;
    delete process.env.EFS_MAX_AGE_DAYS;
  });

  it('deletes directories older than 30 days', async () => {
    const oldDir = join(checkpointsDir, 'run-old');
    mkdirSync(oldDir);
    writeFileSync(join(oldDir, 'state.json'), '{}');
    // Set mtime to 31 days ago — must set AFTER creating children
    const oldTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const oldSec = oldTime.getTime() / 1000;
    utimesSync(oldDir, oldSec, oldSec);

    const result = await handler();
    expect(result.deleted).toContain(oldDir);
  });

  it('keeps directories newer than 30 days', async () => {
    const newDir = join(checkpointsDir, 'run-new');
    mkdirSync(newDir);
    writeFileSync(join(newDir, 'state.json'), '{}');

    const result = await handler();
    expect(result.deleted).toEqual([]);
  });

  it('handles missing directories gracefully', async () => {
    rmSync(checkpointsDir, { recursive: true, force: true });
    rmSync(runsDir, { recursive: true, force: true });

    const result = await handler();
    expect(result.deleted).toEqual([]);
  });

  it('cleans both checkpoints and runs directories', async () => {
    const oldCheckpoint = join(checkpointsDir, 'run-old-cp');
    const oldRun = join(runsDir, 'run-old-run');
    mkdirSync(oldCheckpoint);
    mkdirSync(oldRun);
    const oldTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const oldSec = oldTime.getTime() / 1000;
    utimesSync(oldCheckpoint, oldSec, oldSec);
    utimesSync(oldRun, oldSec, oldSec);

    const result = await handler();
    expect(result.deleted).toHaveLength(2);
  });
});
