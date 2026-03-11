// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventBridgeEvent } from './ws-broadcaster.js';
import { WebSocketBroadcaster } from './ws-broadcaster.js';

// Mock API Gateway Management API client
class MockApiGatewayClient {
  sentMessages: Array<{ connectionId: string; data: string }> = [];
  goneConnections: Set<string> = new Set();
  errorConnections: Set<string> = new Set();

  async send(command: unknown): Promise<unknown> {
    const cmd = command as { input: { ConnectionId: string; Data: Uint8Array } };
    const connectionId = cmd.input.ConnectionId;
    const data = new TextDecoder().decode(cmd.input.Data);

    if (this.goneConnections.has(connectionId)) {
      throw new GoneException({ message: 'Gone', $metadata: {} });
    }

    if (this.errorConnections.has(connectionId)) {
      throw new Error('Connection error');
    }

    this.sentMessages.push({ connectionId, data });
    return {};
  }

  reset(): void {
    this.sentMessages = [];
    this.goneConnections.clear();
    this.errorConnections.clear();
  }
}

// Mock DynamoDB client for connections queries
class MockDynamoDBClient {
  queryResults: Record<string, unknown>[][] = [];
  deletedKeys: Array<{ connectionId: string; runId: string }> = [];

  async send(command: unknown): Promise<unknown> {
    const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
    const name = cmd.constructor.name;

    if (name === 'QueryCommand') {
      const items = this.queryResults.shift() || [];
      return {
        Items: items.map(item => this.marshallItem(item)),
      };
    }

    if (name === 'DeleteItemCommand') {
      const key = this.unmarshallItem(cmd.input.Key as Record<string, { S?: string; N?: string }>);
      this.deletedKeys.push({
        connectionId: key.connectionId as string,
        runId: key.runId as string,
      });
      return {};
    }

    return {};
  }

  private marshallItem(item: Record<string, unknown>): Record<string, { S?: string; N?: string }> {
    const result: Record<string, { S?: string; N?: string }> = {};
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'string') result[key] = { S: value };
      else if (typeof value === 'number') result[key] = { N: String(value) };
    }
    return result;
  }

  private unmarshallItem(
    item: Record<string, { S?: string; N?: string }>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (value.S !== undefined) result[key] = value.S;
      else if (value.N !== undefined) result[key] = Number(value.N);
    }
    return result;
  }

  reset(): void {
    this.queryResults = [];
    this.deletedKeys = [];
  }
}

function makeEvent(
  detailType: string,
  runId: string,
  data: Record<string, unknown> = {}
): EventBridgeEvent {
  return {
    source: 'distributed-hive',
    'detail-type': detailType,
    detail: {
      runId,
      entityType: 'story',
      entityId: 'STR-001',
      status: 'in_progress',
      data,
    },
  };
}

describe('WebSocketBroadcaster', () => {
  let mockDynamo: MockDynamoDBClient;
  let mockApiGw: MockApiGatewayClient;
  let broadcaster: WebSocketBroadcaster;

  beforeEach(() => {
    mockDynamo = new MockDynamoDBClient();
    mockApiGw = new MockApiGatewayClient();
    broadcaster = new WebSocketBroadcaster(mockDynamo as any, mockApiGw as any, 'test-connections');
  });

  describe('handle', () => {
    it('should broadcast story_update to all subscribed connections', async () => {
      mockDynamo.queryResults.push([
        { connectionId: 'conn-1', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
        { connectionId: 'conn-2', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
      ]);

      const event = makeEvent('story_update', 'run-1', { title: 'Test Story' });
      const result = await broadcaster.handle(event);

      expect(result.sent).toBe(2);
      expect(result.stale).toBe(0);
      expect(result.errors).toBe(0);

      expect(mockApiGw.sentMessages).toHaveLength(2);
      const msg1 = JSON.parse(mockApiGw.sentMessages[0].data);
      expect(msg1.type).toBe('story_update');
      expect(msg1.runId).toBe('run-1');
      expect(msg1.data).toEqual({ title: 'Test Story' });
      expect(msg1.timestamp).toBeDefined();
    });

    it('should broadcast agent_update events', async () => {
      mockDynamo.queryResults.push([
        { connectionId: 'conn-1', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
      ]);

      const event = makeEvent('agent_update', 'run-1', { agentType: 'senior' });
      const result = await broadcaster.handle(event);

      expect(result.sent).toBe(1);
      const msg = JSON.parse(mockApiGw.sentMessages[0].data);
      expect(msg.type).toBe('agent_update');
    });

    it('should broadcast run_complete events', async () => {
      mockDynamo.queryResults.push([
        { connectionId: 'conn-1', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
      ]);

      const event = makeEvent('run_complete', 'run-1', { totalStories: 5, mergedStories: 5 });
      const result = await broadcaster.handle(event);

      expect(result.sent).toBe(1);
      const msg = JSON.parse(mockApiGw.sentMessages[0].data);
      expect(msg.type).toBe('run_complete');
      expect(msg.status).toBe('in_progress');
    });

    it('should handle no subscribed connections gracefully', async () => {
      mockDynamo.queryResults.push([]);

      const event = makeEvent('story_update', 'run-no-subs');
      const result = await broadcaster.handle(event);

      expect(result.sent).toBe(0);
      expect(result.stale).toBe(0);
      expect(result.errors).toBe(0);
    });
  });

  describe('stale connection cleanup', () => {
    it('should remove stale connections (GoneException) and count them', async () => {
      mockDynamo.queryResults.push([
        { connectionId: 'conn-stale', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
        { connectionId: 'conn-active', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
      ]);
      mockApiGw.goneConnections.add('conn-stale');

      const event = makeEvent('story_update', 'run-1');
      const result = await broadcaster.handle(event);

      expect(result.sent).toBe(1);
      expect(result.stale).toBe(1);
      expect(result.errors).toBe(0);

      // Verify stale connection was deleted from DynamoDB
      expect(mockDynamo.deletedKeys).toHaveLength(1);
      expect(mockDynamo.deletedKeys[0]).toEqual({ connectionId: 'conn-stale', runId: 'run-1' });
    });
  });

  describe('error handling', () => {
    it('should count non-Gone errors without removing connections', async () => {
      mockDynamo.queryResults.push([
        { connectionId: 'conn-err', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
        { connectionId: 'conn-ok', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
      ]);
      mockApiGw.errorConnections.add('conn-err');

      const event = makeEvent('story_update', 'run-1');
      const result = await broadcaster.handle(event);

      expect(result.sent).toBe(1);
      expect(result.stale).toBe(0);
      expect(result.errors).toBe(1);

      // Should NOT have deleted the errored connection
      expect(mockDynamo.deletedKeys).toHaveLength(0);
    });
  });

  describe('message format', () => {
    it('should include all required fields in broadcast message', async () => {
      mockDynamo.queryResults.push([
        { connectionId: 'conn-1', runId: 'run-1', connectedAt: '2026-01-01', ttl: 999999 },
      ]);

      const event = makeEvent('escalation', 'run-1', { reason: 'Need help' });
      event.detail.entityType = 'escalation';
      event.detail.entityId = 'ESC-001';
      event.detail.status = 'pending';

      await broadcaster.handle(event);

      const msg = JSON.parse(mockApiGw.sentMessages[0].data);
      expect(msg).toMatchObject({
        type: 'escalation',
        runId: 'run-1',
        entityType: 'escalation',
        entityId: 'ESC-001',
        status: 'pending',
        data: { reason: 'Need help' },
      });
      expect(msg.timestamp).toBeDefined();
    });
  });
});
