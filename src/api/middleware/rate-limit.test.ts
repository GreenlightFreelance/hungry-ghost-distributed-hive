// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setRateLimitDynamoClient, withRateLimit } from './rate-limit.js';

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
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    setRateLimitDynamoClient({ send: mockSend } as never);
  });

  it('allows request when under limit and adds rate limit headers', async () => {
    // GetItem returns no existing counter
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // PutItem succeeds
    mockSend.mockResolvedValueOnce({});

    const handler = withRateLimit(successHandler, { maxRequests: 10, windowSeconds: 60 });
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['X-RateLimit-Limit']).toBe('10');
    expect(successHandler).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledTimes(2); // GetItem + PutItem
  });

  it('returns 429 when rate limit exceeded', async () => {
    // GetItem returns count at limit
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: { S: 'RATELIMIT#127.0.0.1' },
        SK: { S: 'WINDOW#0' },
        requestCount: { N: '100' },
      },
    });

    const handler = withRateLimit(successHandler, { maxRequests: 100, windowSeconds: 60 });
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(429);
    expect(JSON.parse(result.body).error).toBe('Rate limit exceeded');
    expect(result.headers?.['X-RateLimit-Remaining']).toBe('0');
    expect(result.headers?.['Retry-After']).toBeDefined();
    expect(successHandler).not.toHaveBeenCalled();
  });

  it('increments counter on each request', async () => {
    // GetItem returns existing counter
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: { S: 'RATELIMIT#127.0.0.1' },
        SK: { S: 'WINDOW#0' },
        requestCount: { N: '5' },
      },
    });
    // PutItem succeeds
    mockSend.mockResolvedValueOnce({});

    const handler = withRateLimit(successHandler, { maxRequests: 10, windowSeconds: 60 });
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['X-RateLimit-Remaining']).toBe('4');
  });

  it('fails open when DynamoDB errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const handler = withRateLimit(successHandler, { maxRequests: 10, windowSeconds: 60 });
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('uses x-forwarded-for when sourceIp unavailable', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({});

    const handler = withRateLimit(successHandler);
    const event = makeEvent({
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
      requestContext: {
        identity: {},
      } as APIGatewayProxyEvent['requestContext'],
    });

    await handler(event);
    expect(successHandler).toHaveBeenCalledOnce();

    // Verify the PK uses the first x-forwarded-for IP
    const putCall = mockSend.mock.calls[1][0];
    const item = putCall.input?.Item;
    expect(item?.PK?.S).toContain('10.0.0.1');
  });

  it('can compose with other middleware', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({});

    const handler = withRateLimit(successHandler, { maxRequests: 5, windowSeconds: 30 });
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['X-RateLimit-Limit']).toBe('5');
  });
});
