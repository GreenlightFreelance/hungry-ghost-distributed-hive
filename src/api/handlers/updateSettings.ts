// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getSettings, putSettings } from '../shared/dynamo.js';
import {
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
  type UpdateSettingsRequest,
  parseBody,
  response,
} from '../shared/types.js';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseBody<UpdateSettingsRequest>(event);
  if (!body) {
    return response(400, { error: 'Missing request body' });
  }

  const existing = (await getSettings()) || {};

  const updated = {
    ...existing,
    ...(body.anthropicKeyArn !== undefined && { anthropicKeyArn: body.anthropicKeyArn }),
    ...(body.githubTokenArn !== undefined && { githubTokenArn: body.githubTokenArn }),
    ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
    ...(body.defaultSizeTier !== undefined && { defaultSizeTier: body.defaultSizeTier }),
    ...(body.maxConcurrentRuns !== undefined && { maxConcurrentRuns: body.maxConcurrentRuns }),
  };

  await putSettings(updated);

  return response(200, { settings: redactSecrets(updated) });
}

function redactSecrets(settings: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...settings };
  if (redacted.anthropicKeyArn) redacted.anthropicKeyArn = '***redacted***';
  if (redacted.githubTokenArn) redacted.githubTokenArn = '***redacted***';
  return redacted;
}
