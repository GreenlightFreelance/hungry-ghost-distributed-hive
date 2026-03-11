// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getAWSConfig } from './aws-config.js';

export type HiveDetailType =
  | 'story_update'
  | 'agent_update'
  | 'pr_created'
  | 'escalation'
  | 'log_entry'
  | 'run_complete';

export interface HiveEventDetail {
  runId: string;
  entityType: string;
  entityId: string;
  status: string;
  data: Record<string, unknown>;
}

export interface EventEmitterConfig {
  eventBusName: string;
  region?: string;
  endpoint?: string;
}

export class EventEmitter {
  private client: EventBridgeClient;
  private eventBusName: string;

  constructor(config: EventEmitterConfig) {
    this.eventBusName = config.eventBusName;
    const awsConfig = getAWSConfig(config.region);
    this.client = new EventBridgeClient({
      ...awsConfig,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
  }

  async emit(detailType: HiveDetailType, detail: HiveEventDetail): Promise<void> {
    await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'distributed-hive',
            DetailType: detailType,
            Detail: JSON.stringify(detail),
            EventBusName: this.eventBusName,
          },
        ],
      })
    );
  }

  async emitBatch(
    events: Array<{ detailType: HiveDetailType; detail: HiveEventDetail }>
  ): Promise<void> {
    // EventBridge supports max 10 entries per PutEvents call
    const chunks = this.chunkArray(events, 10);

    for (const chunk of chunks) {
      await this.client.send(
        new PutEventsCommand({
          Entries: chunk.map(event => ({
            Source: 'distributed-hive',
            DetailType: event.detailType,
            Detail: JSON.stringify(event.detail),
            EventBusName: this.eventBusName,
          })),
        })
      );
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
