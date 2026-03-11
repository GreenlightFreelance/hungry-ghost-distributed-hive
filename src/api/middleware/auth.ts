// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaHandler } from '../shared/types.js';
import { response } from '../shared/types.js';

const GITHUB_API_USER_URL = 'https://api.github.com/user';

/** Override point for testing */
export let fetchFn: typeof fetch = globalThis.fetch;

export function setFetchFn(fn: typeof fetch): void {
  fetchFn = fn;
}

/**
 * Wraps a Lambda handler with authentication.
 *
 * Supports two auth methods:
 * 1. API key: validates `x-api-key` header against `API_KEY` env var
 * 2. GitHub OAuth: validates `Authorization: Bearer <token>` by calling GitHub API
 *
 * If either method succeeds, the request proceeds.
 */
export function withAuth(handler: LambdaHandler): LambdaHandler {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Method 1: API key auth
    const apiKey = process.env.API_KEY;
    const providedKey = event.headers?.['x-api-key'] || event.headers?.['X-Api-Key'];

    if (apiKey && providedKey && providedKey === apiKey) {
      return handler(event);
    }

    // Method 2: GitHub OAuth Bearer token
    const authHeader = event.headers?.['authorization'] || event.headers?.['Authorization'];

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      try {
        const userResponse = await fetchFn(GITHUB_API_USER_URL, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });

        if (userResponse.ok) {
          const userData = (await userResponse.json()) as { login: string };
          // Attach user info to request context for downstream handlers
          if (!event.requestContext.authorizer) {
            (event.requestContext as unknown as Record<string, unknown>).authorizer = {};
          }
          (event.requestContext.authorizer as Record<string, string>).principalId = userData.login;
          return handler(event);
        }
      } catch {
        // Token validation failed, fall through to unauthorized
      }
    }

    // No valid auth provided
    if (!apiKey && !authHeader) {
      return response(401, { error: 'Authentication not configured' });
    }

    return response(401, { error: 'Unauthorized' });
  };
}
