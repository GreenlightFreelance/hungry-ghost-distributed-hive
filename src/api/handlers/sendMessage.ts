// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getRunMeta, putStateItem } from '../shared/dynamo.js';
import {
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
  type SendMessageRequest,
  getPathParam,
  parseBody,
  response,
} from '../shared/types.js';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const runId = getPathParam(event, 'id');
  if (!runId) {
    return response(400, { error: 'Missing run id' });
  }

  const body = parseBody<SendMessageRequest>(event);
  if (!body || !body.message) {
    return response(400, { error: 'Missing required field: message' });
  }

  const meta = await getRunMeta(runId);
  if (!meta) {
    return response(404, { error: 'Run not found' });
  }

  if (meta.data.status !== 'running') {
    return response(409, { error: 'Can only send messages to running runs' });
  }

  const messageId = `msg-${Date.now()}`;
  await putStateItem(runId, `INBOUND_MSG#${messageId}`, 'inbound_msg', {
    id: messageId,
    message: body.message,
    sender: body.sender || 'user',
    timestamp: new Date().toISOString(),
  });

  return response(201, { messageId, status: 'sent' });
}
