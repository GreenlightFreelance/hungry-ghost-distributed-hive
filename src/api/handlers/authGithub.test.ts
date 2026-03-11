// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler, setFetchFn } from './authGithub.js';

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    body: body ? JSON.stringify(body) : null,
    headers: { 'content-type': 'application/json' },
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    path: '/api/auth/github',
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  };
}

describe('authGithub handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GITHUB_CLIENT_ID: 'test-client-id',
      GITHUB_CLIENT_SECRET: 'test-client-secret',
    };
  });

  it('returns 400 when code is missing', async () => {
    const result = await handler(makeEvent({}));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('code');
  });

  it('returns 400 when body is null', async () => {
    const result = await handler(makeEvent(null));
    expect(result.statusCode).toBe(400);
  });

  it('returns 500 when GitHub OAuth not configured', async () => {
    delete process.env.GITHUB_CLIENT_ID;
    const result = await handler(makeEvent({ code: 'test-code' }));
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).error).toContain('not configured');
  });

  it('returns 502 when GitHub token exchange fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    setFetchFn(mockFetch as unknown as typeof fetch);

    const result = await handler(makeEvent({ code: 'test-code' }));
    expect(result.statusCode).toBe(502);
  });

  it('returns 401 when GitHub returns error in token response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 'bad_verification_code', error_description: 'The code is invalid' }),
    });
    setFetchFn(mockFetch as unknown as typeof fetch);

    const result = await handler(makeEvent({ code: 'bad-code' }));
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBe('The code is invalid');
  });

  it('exchanges code and returns user data on success', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'gho_abc123', token_type: 'bearer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ login: 'testuser', avatar_url: 'https://avatar.url', name: 'Test User' }),
      });
    setFetchFn(mockFetch as unknown as typeof fetch);

    const result = await handler(makeEvent({ code: 'valid-code' }));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.token).toBe('gho_abc123');
    expect(body.user.login).toBe('testuser');
    expect(body.user.avatarUrl).toBe('https://avatar.url');
    expect(body.user.name).toBe('Test User');

    // Verify the token exchange request
    const tokenCall = mockFetch.mock.calls[0];
    expect(tokenCall[0]).toContain('oauth/access_token');
    const tokenBody = JSON.parse(tokenCall[1].body);
    expect(tokenBody.client_id).toBe('test-client-id');
    expect(tokenBody.code).toBe('valid-code');
  });

  it('returns 502 when user profile fetch fails', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'gho_abc123' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      });
    setFetchFn(mockFetch as unknown as typeof fetch);

    const result = await handler(makeEvent({ code: 'valid-code' }));
    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body).error).toContain('user profile');
  });
});
