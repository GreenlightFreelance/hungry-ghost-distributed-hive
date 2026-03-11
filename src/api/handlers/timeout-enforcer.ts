// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { ECSClient, StopTaskCommand } from '@aws-sdk/client-ecs';
import { listAllRuns, putRunMeta } from '../shared/dynamo.js';

const MAX_RUN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

let ecsClient: ECSClient | null = null;

export function setECSClient(client: ECSClient): void {
  ecsClient = client;
}

function getECS(): ECSClient {
  if (!ecsClient) ecsClient = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return ecsClient;
}

export interface TimeoutResult {
  timedOut: string[];
  checked: number;
}

export async function handler(): Promise<TimeoutResult> {
  const runs = await listAllRuns();
  const now = Date.now();
  const timedOut: string[] = [];

  for (const run of runs) {
    const data = run.data as Record<string, unknown>;
    const status = data.status as string;

    if (status !== 'running' && status !== 'pending') continue;

    const createdAt = data.createdAt as string;
    if (!createdAt) continue;

    const elapsed = now - new Date(createdAt).getTime();
    if (elapsed <= MAX_RUN_DURATION_MS) continue;

    const runId = (run.PK as string).replace('RUN#', '');
    const taskArn = data.taskArn as string | undefined;

    // Stop the ECS task if it has one
    const clusterArn = process.env.ECS_CLUSTER_ARN || '';
    if (taskArn && clusterArn) {
      try {
        await getECS().send(
          new StopTaskCommand({
            cluster: clusterArn,
            task: taskArn,
            reason: 'Run exceeded maximum duration of 24 hours',
          })
        );
      } catch (error) {
        console.error(`Failed to stop task ${taskArn}:`, error);
      }
    }

    // Update run status
    await putRunMeta(runId, {
      ...data,
      status: 'failed',
      failureReason: 'Run exceeded maximum duration of 24 hours',
      completedAt: new Date().toISOString(),
    });

    timedOut.push(runId);
    console.log(`Timed out run ${runId} (elapsed: ${Math.round(elapsed / 3600000)}h)`);
  }

  console.log(`Checked ${runs.length} runs, timed out ${timedOut.length}`);
  return { timedOut, checked: runs.length };
}
