// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ConnectionRecord, WebSocketEvent } from './ws-handler.js';
import { WebSocketHandler } from './ws-handler.js';

// Mock DynamoDB client
class MockDynamoDBClient {
  items: Map<string, Record<string, unknown>> = new Map();
  deletedKeys: Array<{ connectionId: string; runId: string }> = [];
  queryResults: Record<string, unknown>[][] = [];

  async send(command: unknown): Promise<unknown> {
    const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
    const name = cmd.constructor.name;

    if (name === 'PutItemCommand') {
      const item = this.unmarshallItem(cmd.input.Item as Record<string, { S?: string; N?: string }>);
      const key = `${item.connectionId}#${item.runId}`;
      this.items.set(key, item);
      return {};
    }

    if (name === 'DeleteItemCommand') {
      const key = this.unmarshallItem(cmd.input.Key as Record<string, { S?: string; N?: string }>);
      this.deletedKeys.push({ connectionId: key.connectionId as string, runId: key.runId as string });
      const mapKey = `${key.connectionId}#${key.runId}`;
      this.items.delete(mapKey);
      return {};
    }

    if (name === 'QueryCommand') {
      const items = this.queryResults.shift() || [];
      return {
        Items: items.map(item => this.marshallItem(item)),
      };
    }

    return {};
  }

  private unmarshallItem(item: Record<string, { S?: string; N?: string }>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (value.S !== undefined) result[key] = value.S;
      else if (value.N !== undefined) result[key] = Number(value.N);
    }
    return result;
  }

  private marshallItem(item: Record<string, unknown>): Record<string, { S?: string; N?: string }> {
    const result: Record<string, { S?: string; N?: string }> = {};
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'string') result[key] = { S: value };
      else if (typeof value === 'number') result[key] = { N: String(value) };
    }
    return result;
  }

  reset(): void {
    this.items.clear();
    this.deletedKeys = [];
    this.queryResults = [];
  }
}

function makeEvent(routeKey: string, connectionId: string, body?: string): WebSocketEvent {
  return {
    requestContext: {
      connectionId,
      routeKey,
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      stage: 'prod',
    },
    body,
  };
}

describe('WebSocketHandler', () => {
  let mockDynamo: MockDynamoDBClient;
  let handler: WebSocketHandler;

  beforeEach(() => {
    mockDynamo = new MockDynamoDBClient();
    handler = new WebSocketHandler(mockDynamo as any, 'test-connections');
  });

  describe('$connect', () => {
    it('should return 200 on connect', async () => {
      const event = makeEvent('$connect', 'conn-1');
      const response = await handler.handle(event);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('$disconnect', () => {
    it('should remove all subscriptions for a connection', async () => {
      // Set up existing subscriptions to be returned by query
      mockDynamo.queryResults.push([
        { connectionId: 'conn-1', runId: 'run-a', connectedAt: '2026-01-01T00:00:00Z', ttl: 999999 },
        { connectionId: 'conn-1', runId: 'run-b', connectedAt: '2026-01-01T00:00:00Z', ttl: 999999 },
      ]);

      const event = makeEvent('$disconnect', 'conn-1');
      const response = await handler.handle(event);

      expect(response.statusCode).toBe(200);
      expect(mockDynamo.deletedKeys).toHaveLength(2);
      expect(mockDynamo.deletedKeys[0]).toEqual({ connectionId: 'conn-1', runId: 'run-a' });
      expect(mockDynamo.deletedKeys[1]).toEqual({ connectionId: 'conn-1', runId: 'run-b' });
    });

    it('should handle disconnect with no subscriptions', async () => {
      mockDynamo.queryResults.push([]);

      const event = makeEvent('$disconnect', 'conn-2');
      const response = await handler.handle(event);

      expect(response.statusCode).toBe(200);
      expect(mockDynamo.deletedKeys).toHaveLength(0);
    });
  });

  describe('subscribe', () => {
    it('should store connection-runId mapping in DynamoDB', async () => {
      const event = makeEvent(
        'subscribe',
        'conn-1',
        JSON.stringify({ action: 'subscribe', runId: 'run-123' })
      );

      const response = await handler.handle(event);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBeDefined();
      const body = JSON.parse(response.body!);
      expect(body.subscribed).toBe('run-123');

      // Verify item was stored
      const stored = mockDynamo.items.get('conn-1#run-123');
      expect(stored).toBeDefined();
      expect(stored!.connectionId).toBe('conn-1');
      expect(stored!.runId).toBe('run-123');
      expect(stored!.connectedAt).toBeDefined();
      expect(stored!.ttl).toBeGreaterThan(0);
    });

    it('should return 400 when body is missing', async () => {
      const event = makeEvent('subscribe', 'conn-1');
      const response = await handler.handle(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body!);
      expect(body.error).toContain('Missing request body');
    });

    it('should return 400 when body is invalid JSON', async () => {
      const event = makeEvent('subscribe', 'conn-1', 'not-json');
      const response = await handler.handle(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body!);
      expect(body.error).toContain('Invalid JSON');
    });

    it('should return 400 when runId is missing', async () => {
      const event = makeEvent('subscribe', 'conn-1', JSON.stringify({ action: 'subscribe' }));
      const response = await handler.handle(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body!);
      expect(body.error).toContain('Missing runId');
    });
  });

  describe('unknown route', () => {
    it('should return 400 for unknown routes', async () => {
      const event = makeEvent('unknown', 'conn-1');
      const response = await handler.handle(event);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body!);
      expect(body.error).toContain('Unknown route');
    });
  });

  describe('getSubscriptionsByRunId', () => {
    it('should query connections by runId using GSI', async () => {
      const expected: ConnectionRecord[] = [
        { connectionId: 'conn-1', runId: 'run-1', connectedAt: '2026-01-01T00:00:00Z', ttl: 999999 },
        { connectionId: 'conn-2', runId: 'run-1', connectedAt: '2026-01-01T00:00:00Z', ttl: 999999 },
      ];
      mockDynamo.queryResults.push(expected as unknown as Record<string, unknown>[]);

      const results = await handler.getSubscriptionsByRunId('run-1');

      expect(results).toHaveLength(2);
      expect(results[0].connectionId).toBe('conn-1');
      expect(results[1].connectionId).toBe('conn-2');
    });
  });
});
