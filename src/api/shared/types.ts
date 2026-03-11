// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export type { APIGatewayProxyEvent, APIGatewayProxyResult };

export type LambdaHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

export interface CreateRunRequest {
  title: string;
  description: string;
  repositories: Array<{ url: string; teamName: string }>;
  config?: {
    models?: Record<string, { model: string }>;
    scaling?: Record<string, unknown>;
  };
  sizeTier?: 'small' | 'medium' | 'large';
  model?: string;
}

export interface SendMessageRequest {
  message: string;
  sender?: string;
}

export interface UpdateSettingsRequest {
  anthropicKeyArn?: string;
  githubTokenArn?: string;
  defaultModel?: string;
  defaultSizeTier?: 'small' | 'medium' | 'large';
  maxConcurrentRuns?: number;
}

export interface RunRecord {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  repositories: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCost?: number;
  actualCost?: number;
  sizeTier: 'small' | 'medium' | 'large';
  model: string;
  taskArn?: string;
  userId?: string;
}

export function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

export function getPathParam(event: APIGatewayProxyEvent, name: string): string | undefined {
  return event.pathParameters?.[name];
}

export function parseBody<T>(event: APIGatewayProxyEvent): T | null {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body) as T;
  } catch {
    return null;
  }
}
