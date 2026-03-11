// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaHandler } from '../shared/types.js';
import { response } from '../shared/types.js';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Wraps a Lambda handler with request validation:
 * - For POST/PUT/PATCH: requires Content-Type: application/json header
 * - For POST/PUT/PATCH with a body: validates that the body is valid JSON
 */
export function withValidation(handler: LambdaHandler): LambdaHandler {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const method = event.httpMethod?.toUpperCase();

    if (method && METHODS_WITH_BODY.has(method)) {
      const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

      if (!contentType.includes('application/json')) {
        return response(415, { error: 'Content-Type must be application/json' });
      }

      if (event.body) {
        try {
          JSON.parse(event.body);
        } catch {
          return response(400, { error: 'Invalid JSON in request body' });
        }
      }
    }

    return handler(event);
  };
}
