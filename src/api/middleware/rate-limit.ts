// Licensed under the Hungry Ghost Hive License. See LICENSE.

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaHandler } from '../shared/types.js';
import { response } from '../shared/types.js';

const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE || 'distributed-hive-state';

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 100,
  windowSeconds: 60,
};

let dynamoClient: DynamoDBClient | null = null;

export function setRateLimitDynamoClient(client: DynamoDBClient): void {
  dynamoClient = client;
}

function getDynamo(): DynamoDBClient {
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return dynamoClient;
}

function getClientIdentifier(event: APIGatewayProxyEvent): string {
  return (
    event.requestContext?.identity?.sourceIp ||
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function withRateLimit(handler: LambdaHandler, config?: Partial<RateLimitConfig>): LambdaHandler {
  const { maxRequests, windowSeconds } = { ...DEFAULT_CONFIG, ...config };

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const clientId = getClientIdentifier(event);
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSeconds);
    const pk = `RATELIMIT#${clientId}`;
    const sk = `WINDOW#${windowStart}`;

    try {
      const result = await getDynamo().send(
        new GetItemCommand({
          TableName: RATE_LIMIT_TABLE,
          Key: marshall({ PK: pk, SK: sk }),
        })
      );

      const item = result.Item ? unmarshall(result.Item) : null;
      const currentCount = (item?.requestCount as number) || 0;

      if (currentCount >= maxRequests) {
        const retryAfter = windowStart + windowSeconds - now;
        return {
          ...response(429, { error: 'Rate limit exceeded', retryAfter }),
          headers: {
            ...response(429, {}).headers,
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(windowStart + windowSeconds),
          },
        };
      }

      // Increment counter
      await getDynamo().send(
        new PutItemCommand({
          TableName: RATE_LIMIT_TABLE,
          Item: marshall(
            {
              PK: pk,
              SK: sk,
              requestCount: currentCount + 1,
              ttl: windowStart + windowSeconds + 60,
            },
            { removeUndefinedValues: true }
          ),
        })
      );

      const result2 = await handler(event);
      return {
        ...result2,
        headers: {
          ...result2.headers,
          'X-RateLimit-Limit': String(maxRequests),
          'X-RateLimit-Remaining': String(maxRequests - currentCount - 1),
          'X-RateLimit-Reset': String(windowStart + windowSeconds),
        },
      };
    } catch (error) {
      // If rate limiting fails, allow the request through (fail-open)
      console.error('Rate limit check failed, allowing request:', error);
      return handler(event);
    }
  };
}
