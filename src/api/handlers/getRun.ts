// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getRunMeta, queryByRunId } from '../shared/dynamo.js';
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

  const meta = await getRunMeta(runId);
  if (!meta) {
    return response(404, { error: 'Run not found' });
  }

  // Fetch associated stories and agents for a complete view
  const [stories, agents] = await Promise.all([
    queryByRunId(runId, 'STORY#'),
    queryByRunId(runId, 'AGENT#'),
  ]);

  return response(200, {
    ...meta.data,
    stories: stories.map(s => s.data),
    agents: agents.map(a => a.data),
  });
}
