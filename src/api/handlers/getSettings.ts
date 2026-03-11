// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getSettings } from '../shared/dynamo.js';
import {
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
  response,
} from '../shared/types.js';

export async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const settings = await getSettings();

  if (!settings) {
    return response(200, { settings: {} });
  }

  // Redact sensitive ARN values
  const redacted = { ...settings };
  if (redacted.anthropicKeyArn) redacted.anthropicKeyArn = '***redacted***';
  if (redacted.githubTokenArn) redacted.githubTokenArn = '***redacted***';

  // Remove DynamoDB key attributes from response
  delete redacted.PK;
  delete redacted.SK;

  return response(200, { settings: redacted });
}
