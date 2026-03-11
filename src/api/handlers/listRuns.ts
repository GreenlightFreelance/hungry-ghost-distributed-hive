// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { listAllRuns } from '../shared/dynamo.js';
import {
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
  response,
} from '../shared/types.js';

export async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const items = await listAllRuns();
  const runs = items
    .map(item => item.data)
    .sort((a, b) => {
      const aTime = (a.createdAt as string) || '';
      const bTime = (b.createdAt as string) || '';
      return bTime.localeCompare(aTime);
    });

  return response(200, { runs });
}
