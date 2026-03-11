// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { parseBody, response } from '../shared/types.js';

const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_USER_URL = 'https://api.github.com/user';

interface AuthGithubRequest {
  code: string;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

/** Override point for testing */
export let fetchFn: typeof fetch = globalThis.fetch;

export function setFetchFn(fn: typeof fetch): void {
  fetchFn = fn;
}

/**
 * Exchanges a GitHub OAuth authorization code for an access token,
 * fetches the user profile, and returns both to the client.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody<AuthGithubRequest>(event);
  if (!body?.code) {
    return response(400, { error: 'Missing required field: code' });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return response(500, { error: 'GitHub OAuth not configured' });
  }

  // Exchange authorization code for access token
  const tokenResponse = await fetchFn(GITHUB_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: body.code,
    }),
  });

  if (!tokenResponse.ok) {
    return response(502, { error: 'Failed to exchange code with GitHub' });
  }

  const tokenData = (await tokenResponse.json()) as Record<string, string>;

  if (tokenData.error) {
    return response(401, { error: tokenData.error_description || 'GitHub authorization failed' });
  }

  if (!tokenData.access_token) {
    return response(502, { error: 'No access token received from GitHub' });
  }

  // Fetch user profile
  const userResponse = await fetchFn(GITHUB_API_USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tokenData.access_token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!userResponse.ok) {
    return response(502, { error: 'Failed to fetch GitHub user profile' });
  }

  const userData = (await userResponse.json()) as GitHubUser;

  return response(200, {
    token: tokenData.access_token,
    user: {
      login: userData.login,
      avatarUrl: userData.avatar_url,
      name: userData.name,
    },
  });
}
