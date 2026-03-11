// Licensed under the Hungry Ghost Hive License. See LICENSE.

import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { StateItem } from '../../adapters/dynamo-client.js';

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'distributed-hive-state';
const SETTINGS_TABLE = process.env.SETTINGS_TABLE || 'distributed-hive-settings';
const TTL_30_DAYS = 30 * 24 * 60 * 60;

let clientInstance: DynamoDBClient | null = null;

export function getDynamoClient(): DynamoDBClient {
  if (!clientInstance) {
    clientInstance = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}),
    });
  }
  return clientInstance;
}

export function setDynamoClient(client: DynamoDBClient): void {
  clientInstance = client;
}

export async function queryByRunId(runId: string, skPrefix?: string): Promise<StateItem[]> {
  const client = getDynamoClient();
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: skPrefix ? 'PK = :pk AND begins_with(SK, :sk)' : 'PK = :pk',
      ExpressionAttributeValues: marshall({
        ':pk': `RUN#${runId}`,
        ...(skPrefix ? { ':sk': skPrefix } : {}),
      }),
    })
  );
  return (result.Items || []).map(item => unmarshall(item) as StateItem);
}

export async function getRunMeta(runId: string): Promise<StateItem | null> {
  const client = getDynamoClient();
  const result = await client.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `RUN#${runId}`, SK: 'META' }),
    })
  );
  return result.Item ? (unmarshall(result.Item) as StateItem) : null;
}

export async function putRunMeta(runId: string, data: Record<string, unknown>): Promise<void> {
  const client = getDynamoClient();
  const item: StateItem = {
    PK: `RUN#${runId}`,
    SK: 'META',
    type: 'meta',
    data,
    updatedAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + TTL_30_DAYS,
  };
  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
    })
  );
}

export async function putStateItem(
  runId: string,
  sk: string,
  type: string,
  data: Record<string, unknown>
): Promise<void> {
  const client = getDynamoClient();
  const item: StateItem = {
    PK: `RUN#${runId}`,
    SK: sk,
    type,
    data,
    updatedAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + TTL_30_DAYS,
  };
  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
    })
  );
}

export async function listAllRuns(): Promise<StateItem[]> {
  const client = getDynamoClient();
  const result = await client.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: marshall({ ':sk': 'META' }),
    })
  );
  return (result.Items || []).map(item => unmarshall(item) as StateItem);
}

export async function deleteRunItem(runId: string, sk: string): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ PK: `RUN#${runId}`, SK: sk }),
    })
  );
}

export async function getSettings(): Promise<Record<string, unknown> | null> {
  const client = getDynamoClient();
  const result = await client.send(
    new GetItemCommand({
      TableName: SETTINGS_TABLE,
      Key: marshall({ PK: 'SETTINGS', SK: 'GLOBAL' }),
    })
  );
  return result.Item ? (unmarshall(result.Item) as Record<string, unknown>) : null;
}

export async function putSettings(settings: Record<string, unknown>): Promise<void> {
  const client = getDynamoClient();
  await client.send(
    new PutItemCommand({
      TableName: SETTINGS_TABLE,
      Item: marshall(
        { PK: 'SETTINGS', SK: 'GLOBAL', ...settings, updatedAt: new Date().toISOString() },
        { removeUndefinedValues: true }
      ),
    })
  );
}
