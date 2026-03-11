// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaHandler } from '../shared/types.js';
import { response } from '../shared/types.js';

export interface RateLimitConfig {
  /** Maximum requests allowed within the window. */
  maxRequests: number;
  /** Time window in seconds. */
  windowSeconds: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 100,
  windowSeconds: 60,
};

/**
 * In-memory sliding-window rate limiter keyed by source IP.
 * Suitable for Lambda with provisioned concurrency or low-traffic APIs.
 * For high-traffic, replace with DynamoDB-backed counters.
 */
const windowMap = new Map<string, { count: number; resetAt: number }>();

function getClientKey(event: APIGatewayProxyEvent): string {
  return (
    event.requestContext?.identity?.sourceIp ||
    event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function withRateLimit(
  handler: LambdaHandler,
  config?: Partial<RateLimitConfig>
): LambdaHandler {
  const { maxRequests, windowSeconds } = { ...DEFAULT_CONFIG, ...config };

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const key = getClientKey(event);
    const now = Date.now();
    const entry = windowMap.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return response(429, { error: 'Rate limit exceeded', retryAfter });
      }
      entry.count++;
    } else {
      windowMap.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    }

    return handler(event);
  };
}
