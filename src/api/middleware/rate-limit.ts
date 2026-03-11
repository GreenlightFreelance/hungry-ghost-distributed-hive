// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaHandler } from '../shared/types.js';
import { response } from '../shared/types.js';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  'POST /api/runs': { windowMs: 60_000, maxRequests: 5 },
  'DELETE /api/runs/{id}': { windowMs: 60_000, maxRequests: 10 },
  'POST /api/runs/{id}/message': { windowMs: 60_000, maxRequests: 20 },
  'PUT /api/settings': { windowMs: 60_000, maxRequests: 10 },
  default: { windowMs: 60_000, maxRequests: 100 },
};

// In-memory sliding window counters (per Lambda instance)
const windows = new Map<string, { count: number; resetAt: number }>();

function getClientId(event: APIGatewayProxyEvent): string {
  return (
    event.requestContext?.identity?.sourceIp ||
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function getRouteKey(event: APIGatewayProxyEvent): string {
  const method = event.httpMethod || event.requestContext?.httpMethod || 'GET';
  const resource = event.resource || event.path || '/';
  return `${method} ${resource}`;
}

/**
 * Rate limiting middleware using in-memory sliding window.
 * Each Lambda instance maintains its own counters (naturally distributed).
 * For stricter global limits, replace with DynamoDB-backed counters.
 */
export function withRateLimit(handler: LambdaHandler, configOverride?: RateLimitConfig): LambdaHandler {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const routeKey = getRouteKey(event);
    const config = configOverride || DEFAULT_LIMITS[routeKey] || DEFAULT_LIMITS.default;
    const clientId = getClientId(event);
    const windowKey = `${clientId}:${routeKey}`;

    const now = Date.now();
    const entry = windows.get(windowKey);

    if (entry && now < entry.resetAt) {
      if (entry.count >= config.maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return {
          ...response(429, { error: 'Too many requests', retryAfterSeconds: retryAfter }),
          headers: {
            ...response(429, {}).headers,
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(config.maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
          },
        };
      }
      entry.count++;
    } else {
      windows.set(windowKey, { count: 1, resetAt: now + config.windowMs });
    }

    // Clean up expired entries periodically
    if (windows.size > 10_000) {
      for (const [key, val] of windows) {
        if (now >= val.resetAt) windows.delete(key);
      }
    }

    return handler(event);
  };
}
