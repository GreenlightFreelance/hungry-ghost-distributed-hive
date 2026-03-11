// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { queryByRunId } from '../shared/dynamo.js';
import {
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
  getPathParam,
  response,
} from '../shared/types.js';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const runId = getPathParam(event, 'id');
  if (!runId) {
    return response(400, { error: 'Missing run id' });
  }

  const items = await queryByRunId(runId, 'PR#');
  const prs = items.map(item => item.data);

  return response(200, { prs });
}
