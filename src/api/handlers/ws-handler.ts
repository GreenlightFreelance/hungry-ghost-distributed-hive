// Licensed under the Hungry Ghost Hive License. See LICENSE.

import {
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'distributed-hive-connections';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const TTL_24_HOURS = 24 * 60 * 60;

export interface WebSocketEvent {
  requestContext: {
    connectionId: string;
    routeKey: string;
    domainName: string;
    stage: string;
  };
  body?: string;
}

export interface WebSocketResponse {
  statusCode: number;
  body?: string;
}

interface SubscribePayload {
  action: 'subscribe';
  runId: string;
}

export interface ConnectionRecord {
  connectionId: string;
  runId: string;
  connectedAt: string;
  ttl: number;
}

export class WebSocketHandler {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(client?: DynamoDBClient, tableName?: string) {
    this.client = client || new DynamoDBClient({ region: AWS_REGION });
    this.tableName = tableName || CONNECTIONS_TABLE;
  }

  async handle(event: WebSocketEvent): Promise<WebSocketResponse> {
    const { routeKey, connectionId } = event.requestContext;

    switch (routeKey) {
      case '$connect':
        return this.handleConnect(connectionId);
      case '$disconnect':
        return this.handleDisconnect(connectionId);
      case 'subscribe':
        return this.handleSubscribe(connectionId, event.body);
      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown route: ${routeKey}` }) };
    }
  }

  private async handleConnect(_connectionId: string): Promise<WebSocketResponse> {
    // Connection established - no record stored until client subscribes to a runId
    return { statusCode: 200 };
  }

  private async handleDisconnect(connectionId: string): Promise<WebSocketResponse> {
    // Query all subscriptions for this connection and delete them
    const subscriptions = await this.getConnectionSubscriptions(connectionId);

    for (const sub of subscriptions) {
      await this.client.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall({ connectionId: sub.connectionId, runId: sub.runId }),
        })
      );
    }

    return { statusCode: 200 };
  }

  private async handleSubscribe(
    connectionId: string,
    body?: string
  ): Promise<WebSocketResponse> {
    if (!body) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
    }

    let payload: SubscribePayload;
    try {
      payload = JSON.parse(body) as SubscribePayload;
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    if (!payload.runId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing runId' }) };
    }

    const record: ConnectionRecord = {
      connectionId,
      runId: payload.runId,
      connectedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + TTL_24_HOURS,
    };

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(record, { removeUndefinedValues: true }),
      })
    );

    return { statusCode: 200, body: JSON.stringify({ subscribed: payload.runId }) };
  }

  async getConnectionSubscriptions(connectionId: string): Promise<ConnectionRecord[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'connectionId = :cid',
        ExpressionAttributeValues: marshall({ ':cid': connectionId }),
      })
    );

    return (result.Items || []).map(item => unmarshall(item) as ConnectionRecord);
  }

  async getSubscriptionsByRunId(runId: string): Promise<ConnectionRecord[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'runId-index',
        KeyConditionExpression: 'runId = :rid',
        ExpressionAttributeValues: marshall({ ':rid': runId }),
      })
    );

    return (result.Items || []).map(item => unmarshall(item) as ConnectionRecord);
  }
}

// Lambda handler export
const handler = new WebSocketHandler();

export const lambdaHandler = async (event: WebSocketEvent): Promise<WebSocketResponse> => {
  return handler.handle(event);
};
