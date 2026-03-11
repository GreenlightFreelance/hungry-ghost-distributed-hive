// Licensed under the Hungry Ghost Hive License. See LICENSE.

import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { getAWSConfig } from './aws-config.js';

export interface StateItem {
  PK: string; // "RUN#run-abc123"
  SK: string; // "STORY#STR-001" | "AGENT#senior-1" | "LOG#12345"
  type: string; // "story" | "agent" | "pr" | "escalation" | "log" | "meta"
  data: Record<string, unknown>;
  updatedAt: string;
  ttl: number;
}

export interface DynamoClientConfig {
  tableName: string;
  region?: string;
  endpoint?: string;
}

const TTL_30_DAYS = 30 * 24 * 60 * 60;

export class DynamoClient {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(config: DynamoClientConfig) {
    this.tableName = config.tableName;
    const awsConfig = getAWSConfig(config.region);
    this.client = new DynamoDBClient({
      ...awsConfig,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
  }

  async batchWriteItems(items: StateItem[]): Promise<void> {
    // DynamoDB batch write supports max 25 items per request
    const chunks = this.chunkArray(items, 25);

    for (const chunk of chunks) {
      const request = {
        RequestItems: {
          [this.tableName]: chunk.map(item => ({
            PutRequest: {
              Item: marshall(item, { removeUndefinedValues: true }),
            },
          })),
        },
      };

      await this.client.send(new BatchWriteItemCommand(request));
    }
  }

  async queryByRunId(runId: string, skPrefix?: string): Promise<StateItem[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
        ExpressionAttributeValues: marshall({
          ':pk': `RUN#${runId}`,
          ...(skPrefix ? { ':sk': skPrefix } : {}),
        }),
      })
    );

    return (result.Items || []).map(item => unmarshall(item) as StateItem);
  }

  static createStateItem(
    runId: string,
    sk: string,
    type: string,
    data: Record<string, unknown>
  ): StateItem {
    return {
      PK: `RUN#${runId}`,
      SK: sk,
      type,
      data,
      updatedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + TTL_30_DAYS,
    };
  }

  async markInboundMessageDelivered(runId: string, sk: string): Promise<void> {
    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: `RUN#${runId}`, SK: sk }),
        UpdateExpression: 'SET #status = :delivered, deliveredAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: marshall({
          ':delivered': 'delivered',
          ':now': new Date().toISOString(),
        }),
      })
    );
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
