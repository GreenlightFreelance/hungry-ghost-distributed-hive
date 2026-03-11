// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/dynamo.js', () => ({
  listAllRuns: vi.fn(),
  putRunMeta: vi.fn(),
}));

const mockECSSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: mockECSSend })),
  StopTaskCommand: vi.fn().mockImplementation(input => input),
}));

import { listAllRuns, putRunMeta } from '../shared/dynamo.js';
import { handler, setECSClient } from './timeout-enforcer.js';

describe('timeout-enforcer handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ECS_CLUSTER_ARN = 'arn:aws:ecs:us-east-1:123:cluster/distributed-hive';
    setECSClient({ send: mockECSSend } as never);
  });

  it('does nothing when no runs exist', async () => {
    vi.mocked(listAllRuns).mockResolvedValue([]);
    const result = await handler();
    expect(result.timedOut).toEqual([]);
    expect(result.checked).toBe(0);
  });

  it('skips completed/cancelled/failed runs', async () => {
    vi.mocked(listAllRuns).mockResolvedValue([
      {
        PK: 'RUN#run-1',
        SK: 'META',
        type: 'meta',
        data: { status: 'completed', createdAt: '2020-01-01T00:00:00Z' },
        updatedAt: '',
        ttl: 0,
      },
      {
        PK: 'RUN#run-2',
        SK: 'META',
        type: 'meta',
        data: { status: 'failed', createdAt: '2020-01-01T00:00:00Z' },
        updatedAt: '',
        ttl: 0,
      },
      {
        PK: 'RUN#run-3',
        SK: 'META',
        type: 'meta',
        data: { status: 'cancelled', createdAt: '2020-01-01T00:00:00Z' },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await handler();
    expect(result.timedOut).toEqual([]);
    expect(result.checked).toBe(3);
    expect(mockECSSend).not.toHaveBeenCalled();
    expect(putRunMeta).not.toHaveBeenCalled();
  });

  it('does not timeout runs under 24 hours', async () => {
    const recentTime = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12h ago
    vi.mocked(listAllRuns).mockResolvedValue([
      {
        PK: 'RUN#run-1',
        SK: 'META',
        type: 'meta',
        data: { status: 'running', createdAt: recentTime, taskArn: 'arn:task/1' },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await handler();
    expect(result.timedOut).toEqual([]);
    expect(mockECSSend).not.toHaveBeenCalled();
  });

  it('times out runs exceeding 24 hours and stops ECS task', async () => {
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    vi.mocked(listAllRuns).mockResolvedValue([
      {
        PK: 'RUN#run-old',
        SK: 'META',
        type: 'meta',
        data: {
          status: 'running',
          createdAt: oldTime,
          taskArn: 'arn:aws:ecs:task/old-task',
        },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await handler();
    expect(result.timedOut).toEqual(['run-old']);
    expect(mockECSSend).toHaveBeenCalledWith(
      expect.objectContaining({
        cluster: 'arn:aws:ecs:us-east-1:123:cluster/distributed-hive',
        task: 'arn:aws:ecs:task/old-task',
        reason: 'Run exceeded maximum duration of 24 hours',
      })
    );
    expect(putRunMeta).toHaveBeenCalledWith(
      'run-old',
      expect.objectContaining({
        status: 'failed',
        failureReason: 'Run exceeded maximum duration of 24 hours',
      })
    );
  });

  it('times out pending runs exceeding 24 hours', async () => {
    const oldTime = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(); // 30h ago
    vi.mocked(listAllRuns).mockResolvedValue([
      {
        PK: 'RUN#run-stuck',
        SK: 'META',
        type: 'meta',
        data: { status: 'pending', createdAt: oldTime },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await handler();
    expect(result.timedOut).toEqual(['run-stuck']);
    expect(putRunMeta).toHaveBeenCalledWith(
      'run-stuck',
      expect.objectContaining({ status: 'failed' })
    );
    // No ECS stop call since no taskArn
    expect(mockECSSend).not.toHaveBeenCalled();
  });

  it('handles mixed runs: only times out expired ones', async () => {
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const recentTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    vi.mocked(listAllRuns).mockResolvedValue([
      {
        PK: 'RUN#run-old',
        SK: 'META',
        type: 'meta',
        data: { status: 'running', createdAt: oldTime, taskArn: 'arn:task/old' },
        updatedAt: '',
        ttl: 0,
      },
      {
        PK: 'RUN#run-new',
        SK: 'META',
        type: 'meta',
        data: { status: 'running', createdAt: recentTime },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await handler();
    expect(result.timedOut).toEqual(['run-old']);
    expect(result.checked).toBe(2);
  });

  it('continues processing when ECS stop fails', async () => {
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mockECSSend.mockRejectedValueOnce(new Error('Task not found'));

    vi.mocked(listAllRuns).mockResolvedValue([
      {
        PK: 'RUN#run-gone',
        SK: 'META',
        type: 'meta',
        data: { status: 'running', createdAt: oldTime, taskArn: 'arn:task/gone' },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await handler();
    expect(result.timedOut).toEqual(['run-gone']);
    // Still updates DynamoDB even if ECS stop fails
    expect(putRunMeta).toHaveBeenCalled();
  });
});
