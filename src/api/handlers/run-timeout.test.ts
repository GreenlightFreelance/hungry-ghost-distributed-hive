// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler, setDDBClient, setECSClient } from './run-timeout.js';

const mockSend = vi.fn();

const mockDDB = { send: mockSend } as any;
const mockECS = { send: vi.fn().mockResolvedValue({}) } as any;

describe('run-timeout handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DYNAMODB_TABLE = 'test-table';
    process.env.ECS_CLUSTER_ARN = 'arn:aws:ecs:us-east-1:123456789012:cluster/test';
    process.env.MAX_RUN_HOURS = '24';
    setDDBClient(mockDDB);
    setECSClient(mockECS);
  });

  afterEach(() => {
    delete process.env.DYNAMODB_TABLE;
    delete process.env.ECS_CLUSTER_ARN;
    delete process.env.MAX_RUN_HOURS;
  });

  it('returns empty array when no timed-out runs exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler();
    expect(result.cancelled).toEqual([]);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('cancels runs that exceed the timeout', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mockSend
      .mockResolvedValueOnce({
        Items: [
          {
            id: 'run-123',
            taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test/abc',
            createdAt: oldDate,
          },
        ],
      })
      .mockResolvedValue({}); // UpdateCommand

    const result = await handler();
    expect(result.cancelled).toEqual(['run-123']);
    expect(mockECS.send).toHaveBeenCalledOnce();
  });

  it('handles runs without taskArn gracefully', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mockSend
      .mockResolvedValueOnce({
        Items: [{ id: 'run-456', createdAt: oldDate }],
      })
      .mockResolvedValue({});

    const result = await handler();
    expect(result.cancelled).toEqual(['run-456']);
    expect(mockECS.send).not.toHaveBeenCalled();
  });

  it('continues cancelling other runs if one ECS stop fails', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { id: 'run-1', taskArn: 'task-1', createdAt: oldDate },
          { id: 'run-2', taskArn: 'task-2', createdAt: oldDate },
        ],
      })
      .mockResolvedValue({});

    mockECS.send.mockRejectedValueOnce(new Error('Task not found')).mockResolvedValueOnce({});

    const result = await handler();
    expect(result.cancelled).toEqual(['run-1', 'run-2']);
  });
});
