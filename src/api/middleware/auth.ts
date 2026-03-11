// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaHandler } from '../shared/types.js';
import { response } from '../shared/types.js';

/**
 * Wraps a Lambda handler with API key authentication.
 *
 * V1 auth: validates the `x-api-key` header against the `API_KEY` environment variable.
 * If the header is missing or does not match, returns 401.
 */
export function withAuth(handler: LambdaHandler): LambdaHandler {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      // If no API_KEY is configured, deny all requests
      return response(401, { error: 'Authentication not configured' });
    }

    const providedKey = event.headers?.['x-api-key'] || event.headers?.['X-Api-Key'];

    if (!providedKey || providedKey !== apiKey) {
      return response(401, { error: 'Unauthorized' });
    }

    return handler(event);
  };
}
