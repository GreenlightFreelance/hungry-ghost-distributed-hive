// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { nanoid } from 'nanoid';
import { putRunMeta } from '../shared/dynamo.js';
import {
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
  type CreateRunRequest,
  parseBody,
  response,
} from '../shared/types.js';

const QUEUE_URL = process.env.SQS_QUEUE_URL || '';
const CLUSTER_ARN = process.env.ECS_CLUSTER_ARN || '';
const TASK_DEFINITION = process.env.ECS_TASK_DEFINITION || 'distributed-hive';
const SUBNETS = (process.env.ECS_SUBNETS || '').split(',').filter(Boolean);
const SECURITY_GROUPS = (process.env.ECS_SECURITY_GROUPS || '').split(',').filter(Boolean);
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || 'distributed-hive-state';
const EVENTBRIDGE_BUS = process.env.EVENTBRIDGE_BUS || 'distributed-hive-events';

let sqsClient: SQSClient | null = null;
let ecsClient: ECSClient | null = null;

export function setSQSClient(client: SQSClient): void {
  sqsClient = client;
}
export function setECSClient(client: ECSClient): void {
  ecsClient = client;
}

function getSQS(): SQSClient {
  if (!sqsClient) sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return sqsClient;
}

function getECS(): ECSClient {
  if (!ecsClient) ecsClient = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return ecsClient;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody<CreateRunRequest>(event);
  if (!body || !body.title || !body.description || !body.repositories?.length) {
    return response(400, { error: 'Missing required fields: title, description, repositories' });
  }

  const runId = `run-${nanoid(12)}`;
  const now = new Date().toISOString();

  const runRecord = {
    id: runId,
    title: body.title,
    description: body.description,
    status: 'pending' as const,
    repositories: body.repositories.map(r => r.url),
    createdAt: now,
    sizeTier: body.sizeTier || 'medium',
    model: body.model || 'claude-opus-4-6',
  };

  // Write initial run metadata to DynamoDB
  await putRunMeta(runId, runRecord);

  // Enqueue SQS message
  const sqsMessage = {
    runId,
    requirement: { title: body.title, description: body.description },
    repos: body.repositories,
    config: body.config || {},
    userId: event.requestContext?.authorizer?.principalId || 'anonymous',
  };

  await getSQS().send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify(sqsMessage),
      MessageGroupId: undefined,
    })
  );

  // Launch Fargate task
  const taskResult = await getECS().send(
    new RunTaskCommand({
      cluster: CLUSTER_ARN,
      taskDefinition: TASK_DEFINITION,
      capacityProviderStrategy: [
        { capacityProvider: 'FARGATE_SPOT', weight: 3, base: 0 },
        { capacityProvider: 'FARGATE', weight: 1, base: 1 },
      ],
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: SUBNETS,
          securityGroups: SECURITY_GROUPS,
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'hive',
            environment: [
              { name: 'RUN_ID', value: runId },
              { name: 'DYNAMODB_TABLE', value: DYNAMODB_TABLE },
              { name: 'EVENTBRIDGE_BUS', value: EVENTBRIDGE_BUS },
              { name: 'REQUIREMENT_TITLE', value: body.title },
              { name: 'REQUIREMENT_DESCRIPTION', value: body.description },
              { name: 'REPO_URLS', value: JSON.stringify(body.repositories.map(r => r.url)) },
            ],
          },
        ],
      },
    })
  );

  const taskArn = taskResult.tasks?.[0]?.taskArn;
  if (taskArn) {
    await putRunMeta(runId, { ...runRecord, taskArn });
  }

  return response(201, { runId, status: 'pending', taskArn: taskArn || null });
}
