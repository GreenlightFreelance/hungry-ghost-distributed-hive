// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { ECSClient, StopTaskCommand } from '@aws-sdk/client-ecs';
import { getRunMeta, putRunMeta } from '../shared/dynamo.js';
import {
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
  getPathParam,
  response,
} from '../shared/types.js';

const CLUSTER_ARN = process.env.ECS_CLUSTER_ARN || '';

let ecsClient: ECSClient | null = null;

export function setECSClient(client: ECSClient): void {
  ecsClient = client;
}

function getECS(): ECSClient {
  if (!ecsClient) ecsClient = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return ecsClient;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const runId = getPathParam(event, 'id');
  if (!runId) {
    return response(400, { error: 'Missing run id' });
  }

  const meta = await getRunMeta(runId);
  if (!meta) {
    return response(404, { error: 'Run not found' });
  }

  const runData = meta.data;
  if (runData.status === 'completed' || runData.status === 'cancelled') {
    return response(409, { error: `Run is already ${runData.status}` });
  }

  // Stop the ECS task if we have a task ARN
  if (runData.taskArn) {
    await getECS().send(
      new StopTaskCommand({
        cluster: CLUSTER_ARN,
        task: runData.taskArn as string,
        reason: 'Cancelled by user',
      })
    );
  }

  // Update run status in DynamoDB
  await putRunMeta(runId, {
    ...runData,
    status: 'cancelled',
    completedAt: new Date().toISOString(),
  });

  return response(200, { runId, status: 'cancelled' });
}
