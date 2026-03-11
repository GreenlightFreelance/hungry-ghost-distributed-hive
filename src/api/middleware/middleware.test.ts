// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withAuth } from './auth.js';
import { withRateLimit } from './rate-limit.js';
import { withValidation } from './validation.js';

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
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
    ...overrides,
  };
}

const successHandler = vi.fn().mockResolvedValue({ statusCode: 200, body: '{}', headers: {} });

describe('withAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  it('returns 401 when API_KEY env var is not configured', async () => {
    delete process.env.API_KEY;
    const handler = withAuth(successHandler);
    const result = await handler(makeEvent({ headers: { 'x-api-key': 'some-key' } }));
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('Authentication not configured');
    expect(successHandler).not.toHaveBeenCalled();
  });

  it('returns 401 when x-api-key header is missing', async () => {
    process.env.API_KEY = 'secret-key';
    const handler = withAuth(successHandler);
    const result = await handler(makeEvent());
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('Unauthorized');
    expect(successHandler).not.toHaveBeenCalled();
  });

  it('returns 401 when x-api-key header does not match', async () => {
    process.env.API_KEY = 'secret-key';
    const handler = withAuth(successHandler);
    const result = await handler(makeEvent({ headers: { 'x-api-key': 'wrong-key' } }));
    expect(result.statusCode).toBe(401);
    expect(successHandler).not.toHaveBeenCalled();
  });

  it('passes through when x-api-key header matches (lowercase)', async () => {
    process.env.API_KEY = 'secret-key';
    const handler = withAuth(successHandler);
    const result = await handler(makeEvent({ headers: { 'x-api-key': 'secret-key' } }));
    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('passes through when X-Api-Key header matches (mixed case)', async () => {
    process.env.API_KEY = 'secret-key';
    const handler = withAuth(successHandler);
    const result = await handler(makeEvent({ headers: { 'X-Api-Key': 'secret-key' } }));
    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });
});

describe('withValidation middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through GET requests without body validation', async () => {
    const handler = withValidation(successHandler);
    const result = await handler(makeEvent({ httpMethod: 'GET' }));
    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('returns 415 for POST without Content-Type: application/json', async () => {
    const handler = withValidation(successHandler);
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{"foo":"bar"}',
      })
    );
    expect(result.statusCode).toBe(415);
    expect(JSON.parse(result.body).error).toContain('application/json');
    expect(successHandler).not.toHaveBeenCalled();
  });

  it('returns 415 for POST with no Content-Type header', async () => {
    const handler = withValidation(successHandler);
    const result = await handler(makeEvent({ httpMethod: 'POST', body: '{"foo":"bar"}' }));
    expect(result.statusCode).toBe(415);
    expect(successHandler).not.toHaveBeenCalled();
  });

  it('returns 400 for POST with invalid JSON body', async () => {
    const handler = withValidation(successHandler);
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json{',
      })
    );
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Invalid JSON');
    expect(successHandler).not.toHaveBeenCalled();
  });

  it('passes through POST with valid JSON body and correct Content-Type', async () => {
    const handler = withValidation(successHandler);
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"title":"test"}',
      })
    );
    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('passes through POST with no body and correct Content-Type', async () => {
    const handler = withValidation(successHandler);
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        headers: { 'content-type': 'application/json' },
        body: null,
      })
    );
    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('passes through PUT with valid body', async () => {
    const handler = withValidation(successHandler);
    const result = await handler(
      makeEvent({
        httpMethod: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{"key":"value"}',
      })
    );
    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('can compose withAuth and withValidation', async () => {
    process.env.API_KEY = 'test-key';
    const handler = withAuth(withValidation(successHandler));

    // Missing API key
    const r1 = await handler(
      makeEvent({
        httpMethod: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    );
    expect(r1.statusCode).toBe(401);

    // Valid API key, valid body
    const r2 = await handler(
      makeEvent({
        httpMethod: 'POST',
        headers: { 'x-api-key': 'test-key', 'content-type': 'application/json' },
        body: '{}',
      })
    );
    expect(r2.statusCode).toBe(200);

    delete process.env.API_KEY;
  });
});

describe('withRateLimit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through requests under the limit', async () => {
    const handler = withRateLimit(successHandler, { windowMs: 60_000, maxRequests: 5 });
    const event = makeEvent({
      httpMethod: 'POST',
      resource: '/api/runs',
      requestContext: {
        identity: { sourceIp: '1.2.3.4' },
      } as APIGatewayProxyEvent['requestContext'],
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(successHandler).toHaveBeenCalledOnce();
  });

  it('returns 429 when rate limit exceeded', async () => {
    const handler = withRateLimit(successHandler, { windowMs: 60_000, maxRequests: 2 });
    const event = makeEvent({
      httpMethod: 'POST',
      resource: '/api/runs',
      requestContext: {
        identity: { sourceIp: '10.0.0.1' },
      } as APIGatewayProxyEvent['requestContext'],
    });

    await handler(event);
    await handler(event);
    const result = await handler(event);

    expect(result.statusCode).toBe(429);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('includes rate limit headers on 429', async () => {
    const handler = withRateLimit(successHandler, { windowMs: 60_000, maxRequests: 1 });
    const event = makeEvent({
      httpMethod: 'GET',
      resource: '/api/runs',
      requestContext: {
        identity: { sourceIp: '10.0.0.2' },
      } as APIGatewayProxyEvent['requestContext'],
    });

    await handler(event);
    const result = await handler(event);

    expect(result.statusCode).toBe(429);
    expect(result.headers?.['Retry-After']).toBeDefined();
    expect(result.headers?.['X-RateLimit-Limit']).toBe('1');
    expect(result.headers?.['X-RateLimit-Remaining']).toBe('0');
  });

  it('tracks different clients independently', async () => {
    const handler = withRateLimit(successHandler, { windowMs: 60_000, maxRequests: 1 });

    const event1 = makeEvent({
      httpMethod: 'GET',
      resource: '/api/runs',
      requestContext: {
        identity: { sourceIp: '10.0.0.3' },
      } as APIGatewayProxyEvent['requestContext'],
    });
    const event2 = makeEvent({
      httpMethod: 'GET',
      resource: '/api/runs',
      requestContext: {
        identity: { sourceIp: '10.0.0.4' },
      } as APIGatewayProxyEvent['requestContext'],
    });

    await handler(event1);
    const r1 = await handler(event1);
    const r2 = await handler(event2);

    expect(r1.statusCode).toBe(429);
    expect(r2.statusCode).toBe(200);
  });
});
