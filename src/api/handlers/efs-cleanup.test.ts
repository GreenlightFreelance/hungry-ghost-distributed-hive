// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs and path
vi.mock('fs', () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  rmSync: vi.fn(),
}));

import { readdirSync, rmSync, statSync } from 'fs';
import { handler } from './efs-cleanup.js';

describe('efs-cleanup handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EFS_MOUNT_PATH = '/workspace';
  });

  afterEach(() => {
    delete process.env.EFS_MOUNT_PATH;
  });

  it('returns empty result when EFS mount is empty', async () => {
    vi.mocked(readdirSync).mockReturnValue([]);
    const result = await handler();
    expect(result.deleted).toEqual([]);
    expect(result.retained).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('deletes directories older than 30 days', async () => {
    vi.mocked(readdirSync).mockReturnValue(['old-run' as unknown as ReturnType<typeof readdirSync>[0]]);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => true,
      mtimeMs: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
    } as ReturnType<typeof statSync>);

    const result = await handler();
    expect(result.deleted).toEqual(['old-run']);
    expect(rmSync).toHaveBeenCalledWith('/workspace/old-run', { recursive: true, force: true });
  });

  it('retains directories newer than 30 days', async () => {
    vi.mocked(readdirSync).mockReturnValue(['recent-run' as unknown as ReturnType<typeof readdirSync>[0]]);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => true,
      mtimeMs: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
    } as ReturnType<typeof statSync>);

    const result = await handler();
    expect(result.deleted).toEqual([]);
    expect(result.retained).toBe(1);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('skips non-directory entries', async () => {
    vi.mocked(readdirSync).mockReturnValue(['file.txt' as unknown as ReturnType<typeof readdirSync>[0]]);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => false,
      mtimeMs: Date.now() - 60 * 24 * 60 * 60 * 1000,
    } as ReturnType<typeof statSync>);

    const result = await handler();
    expect(result.deleted).toEqual([]);
    expect(result.retained).toBe(0);
    expect(rmSync).not.toHaveBeenCalled();
  });

  it('handles mixed old and new directories', async () => {
    vi.mocked(readdirSync).mockReturnValue([
      'old-run' as unknown as ReturnType<typeof readdirSync>[0],
      'new-run' as unknown as ReturnType<typeof readdirSync>[0],
    ]);
    vi.mocked(statSync).mockImplementation((path) => {
      if (String(path).includes('old-run')) {
        return {
          isDirectory: () => true,
          mtimeMs: Date.now() - 45 * 24 * 60 * 60 * 1000,
        } as ReturnType<typeof statSync>;
      }
      return {
        isDirectory: () => true,
        mtimeMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
      } as ReturnType<typeof statSync>;
    });

    const result = await handler();
    expect(result.deleted).toEqual(['old-run']);
    expect(result.retained).toBe(1);
  });

  it('records errors when stat fails and continues', async () => {
    vi.mocked(readdirSync).mockReturnValue([
      'broken' as unknown as ReturnType<typeof readdirSync>[0],
      'good-old' as unknown as ReturnType<typeof readdirSync>[0],
    ]);
    vi.mocked(statSync).mockImplementation((path) => {
      if (String(path).includes('broken')) {
        throw new Error('Permission denied');
      }
      return {
        isDirectory: () => true,
        mtimeMs: Date.now() - 35 * 24 * 60 * 60 * 1000,
      } as ReturnType<typeof statSync>;
    });

    const result = await handler();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('broken');
    expect(result.deleted).toEqual(['good-old']);
  });

  it('handles unreadable EFS mount gracefully', async () => {
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const result = await handler();
    expect(result.deleted).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('/workspace');
  });
});
