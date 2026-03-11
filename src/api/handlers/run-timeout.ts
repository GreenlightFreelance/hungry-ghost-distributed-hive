// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ECSClient, StopTaskCommand } from '@aws-sdk/client-ecs';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

let ddbClient: DynamoDBDocumentClient | null = null;
let ecsClient: ECSClient | null = null;

export function setDDBClient(client: DynamoDBDocumentClient): void {
  ddbClient = client;
}
export function setECSClient(client: ECSClient): void {
  ecsClient = client;
}

function getDDB(): DynamoDBDocumentClient {
  if (!ddbClient) {
    ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION || 'af-south-1' })
    );
  }
  return ddbClient;
}

function getECS(): ECSClient {
  if (!ecsClient) {
    ecsClient = new ECSClient({ region: process.env.AWS_REGION || 'af-south-1' });
  }
  return ecsClient;
}

/**
 * Scheduled Lambda: finds running tasks older than maxRunHours and stops them.
 * Triggered by EventBridge cron rule every 15 minutes.
 */
export async function handler(): Promise<{ cancelled: string[] }> {
  const maxRunHours = parseInt(process.env.MAX_RUN_HOURS || '24', 10);
  const tableName = process.env.DYNAMODB_TABLE || 'distributed-hive-state';
  const clusterArn = process.env.ECS_CLUSTER_ARN || '';
  const cutoff = new Date(Date.now() - maxRunHours * 60 * 60 * 1000).toISOString();
  const cancelled: string[] = [];

  // Query runs with status = "running" using GSI2 (status-index)
  const result = await getDDB().send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'status-index',
      KeyConditionExpression: 'GSI2PK = :status AND GSI2SK < :cutoff',
      ExpressionAttributeValues: {
        ':status': 'STATUS#running',
        ':cutoff': cutoff,
      },
    })
  );

  for (const item of result.Items || []) {
    const runId = item.id as string;
    const taskArn = item.taskArn as string | undefined;

    // Stop the ECS task if we have a taskArn
    if (taskArn && clusterArn) {
      try {
        await getECS().send(
          new StopTaskCommand({
            cluster: clusterArn,
            task: taskArn,
            reason: `Run exceeded maximum duration of ${maxRunHours} hours`,
          })
        );
      } catch (err) {
        console.error(`Failed to stop task ${taskArn} for run ${runId}:`, err);
      }
    }

    // Update run status to cancelled
    await getDDB().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `RUN#${runId}`, SK: 'META' },
        UpdateExpression: 'SET #status = :cancelled, completedAt = :now, cancelReason = :reason',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':cancelled': 'cancelled',
          ':now': new Date().toISOString(),
          ':reason': `Timed out after ${maxRunHours} hours`,
        },
      })
    );

    cancelled.push(runId);
    console.log(`Cancelled timed-out run: ${runId} (created: ${item.createdAt})`);
  }

  console.log(`Run timeout check complete. Cancelled ${cancelled.length} runs.`);
  return { cancelled };
}
