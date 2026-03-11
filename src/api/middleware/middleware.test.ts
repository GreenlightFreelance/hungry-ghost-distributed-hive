// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withAuth } from './auth.js';
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
