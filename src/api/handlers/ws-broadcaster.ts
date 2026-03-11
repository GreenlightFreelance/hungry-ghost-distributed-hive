// Licensed under the Hungry Ghost Hive License. See LICENSE.

import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DeleteItemCommand, DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

import type { ConnectionRecord } from './ws-handler.js';

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'distributed-hive-connections';
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

export interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: {
    runId: string;
    entityType: string;
    entityId: string;
    status: string;
    data: Record<string, unknown>;
  };
}

export interface BroadcastResult {
  sent: number;
  stale: number;
  errors: number;
}

export class WebSocketBroadcaster {
  private dynamo: DynamoDBClient;
  private tableName: string;
  private apiClient: ApiGatewayManagementApiClient;

  constructor(
    dynamo?: DynamoDBClient,
    apiClient?: ApiGatewayManagementApiClient,
    tableName?: string
  ) {
    this.dynamo = dynamo || new DynamoDBClient({ region: AWS_REGION });
    this.tableName = tableName || CONNECTIONS_TABLE;
    this.apiClient =
      apiClient ||
      new ApiGatewayManagementApiClient({
        region: AWS_REGION,
        endpoint: WEBSOCKET_ENDPOINT,
      });
  }

  async handle(event: EventBridgeEvent): Promise<BroadcastResult> {
    const { runId } = event.detail;
    const detailType = event['detail-type'];

    const connections = await this.getSubscribedConnections(runId);

    const message = JSON.stringify({
      type: detailType,
      runId,
      data: event.detail.data,
      entityType: event.detail.entityType,
      entityId: event.detail.entityId,
      status: event.detail.status,
      timestamp: new Date().toISOString(),
    });

    const result: BroadcastResult = { sent: 0, stale: 0, errors: 0 };

    const postPromises = connections.map(conn => this.postToConnection(conn, message, result));
    await Promise.all(postPromises);

    return result;
  }

  private async postToConnection(
    conn: ConnectionRecord,
    message: string,
    result: BroadcastResult
  ): Promise<void> {
    try {
      await this.apiClient.send(
        new PostToConnectionCommand({
          ConnectionId: conn.connectionId,
          Data: new TextEncoder().encode(message),
        })
      );
      result.sent++;
    } catch (error: unknown) {
      if (error instanceof GoneException) {
        // Connection is stale - clean up
        await this.removeConnection(conn.connectionId, conn.runId);
        result.stale++;
      } else {
        result.errors++;
      }
    }
  }

  private async getSubscribedConnections(runId: string): Promise<ConnectionRecord[]> {
    const queryResult = await this.dynamo.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'runId-index',
        KeyConditionExpression: 'runId = :rid',
        ExpressionAttributeValues: marshall({ ':rid': runId }),
      })
    );

    return (queryResult.Items || []).map(item => unmarshall(item) as ConnectionRecord);
  }

  private async removeConnection(connectionId: string, runId: string): Promise<void> {
    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({ connectionId, runId }),
      })
    );
  }
}

// Lambda handler export
const broadcaster = new WebSocketBroadcaster();

export const lambdaHandler = async (event: EventBridgeEvent): Promise<BroadcastResult> => {
  return broadcaster.handle(event);
};
