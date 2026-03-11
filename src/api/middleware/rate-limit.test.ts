// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRateLimit } from './rate-limit.js';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      identity: { sourceIp: '127.0.0.1' },
    } as APIGatewayProxyEvent['requestContext'],
    resource: '',
    ...overrides,
  };
}

const successHandler = vi.fn().mockResolvedValue({ statusCode: 200, body: '{}', headers: {} });

describe('withRateLimit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows requests under the limit', async () => {
    const handler = withRateLimit(successHandler, { maxRequests: 5, windowSeconds: 60 });
    const event = makeEvent();

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const handler = withRateLimit(successHandler, { maxRequests: 3, windowSeconds: 60 });
    const event = makeEvent();

    // Use up the limit
    await handler(event);
    await handler(event);
    await handler(event);

    // This should be rejected
    const result = await handler(event);
    expect(result.statusCode).toBe(429);
    expect(JSON.parse(result.body).error).toBe('Rate limit exceeded');
    expect(JSON.parse(result.body).retryAfter).toBeGreaterThan(0);
  });

  it('uses different rate limit windows per IP', async () => {
    const handler = withRateLimit(successHandler, { maxRequests: 1, windowSeconds: 60 });

    const event1 = makeEvent({
      requestContext: {
        identity: { sourceIp: '10.0.0.1' },
      } as APIGatewayProxyEvent['requestContext'],
    });
    const event2 = makeEvent({
      requestContext: {
        identity: { sourceIp: '10.0.0.2' },
      } as APIGatewayProxyEvent['requestContext'],
    });

    await handler(event1);
    // Different IP should still be allowed
    const result = await handler(event2);
    expect(result.statusCode).toBe(200);
  });

  it('falls back to X-Forwarded-For when sourceIp is missing', async () => {
    const handler = withRateLimit(successHandler, { maxRequests: 1, windowSeconds: 60 });

    const event = makeEvent({
      requestContext: { identity: {} } as APIGatewayProxyEvent['requestContext'],
      headers: { 'X-Forwarded-For': '192.168.1.1, 10.0.0.1' },
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });
});
