// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the dynamo module
vi.mock('../shared/dynamo.js', () => ({
  queryByRunId: vi.fn(),
  getRunMeta: vi.fn(),
  putRunMeta: vi.fn(),
  putStateItem: vi.fn(),
  listAllRuns: vi.fn(),
  getSettings: vi.fn(),
  putSettings: vi.fn(),
  getDynamoClient: vi.fn(),
  setDynamoClient: vi.fn(),
}));

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: () => 'test12345678',
}));

// Mock SQS
const mockSQSSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn().mockImplementation(() => ({ send: mockSQSSend })),
  SendMessageCommand: vi.fn().mockImplementation(input => input),
}));

// Mock ECS
const mockECSSend = vi.fn().mockResolvedValue({
  tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123456789:task/test-task-id' }],
});
vi.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: vi.fn().mockImplementation(() => ({ send: mockECSSend })),
  RunTaskCommand: vi.fn().mockImplementation(input => input),
  StopTaskCommand: vi.fn().mockImplementation(input => input),
}));

import {
  getRunMeta,
  getSettings,
  listAllRuns,
  putRunMeta,
  putSettings,
  putStateItem,
  queryByRunId,
} from '../shared/dynamo.js';
import { handler as cancelRun, setECSClient as setCancelECSClient } from './cancelRun.js';
import { handler as createRun, setECSClient, setSQSClient } from './createRun.js';
import { handler as getAgents } from './getAgents.js';
import { handler as getLogs } from './getLogs.js';
import { handler as getPRs } from './getPRs.js';
import { handler as getRunHandler } from './getRun.js';
import { handler as getSettingsHandler } from './getSettings.js';
import { handler as getStories } from './getStories.js';
import { handler as listRunsHandler } from './listRuns.js';
import { handler as sendMessage } from './sendMessage.js';
import { handler as updateSettingsHandler } from './updateSettings.js';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
    ...overrides,
  };
}

describe('createRun handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSQSClient({ send: mockSQSSend } as never);
    setECSClient({ send: mockECSSend } as never);
  });

  it('returns 400 when body is missing', async () => {
    const result = await createRun(makeEvent());
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('Missing required fields');
  });

  it('returns 400 when required fields are missing', async () => {
    const result = await createRun(makeEvent({ body: JSON.stringify({ title: 'test' }) }));
    expect(result.statusCode).toBe(400);
  });

  it('creates a run successfully', async () => {
    const event = makeEvent({
      body: JSON.stringify({
        title: 'Test Run',
        description: 'A test requirement',
        repositories: [{ url: 'https://github.com/org/repo', teamName: 'team-a' }],
      }),
    });

    const result = await createRun(event);
    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body);
    expect(body.runId).toBe('run-test12345678');
    expect(body.status).toBe('pending');
    expect(body.taskArn).toBe('arn:aws:ecs:us-east-1:123456789:task/test-task-id');

    expect(putRunMeta).toHaveBeenCalled();
    expect(mockSQSSend).toHaveBeenCalled();
    expect(mockECSSend).toHaveBeenCalled();
  });
});

describe('listRuns handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty list when no runs', async () => {
    vi.mocked(listAllRuns).mockResolvedValue([]);
    const result = await listRunsHandler(makeEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).runs).toEqual([]);
  });

  it('returns runs sorted by createdAt descending', async () => {
    vi.mocked(listAllRuns).mockResolvedValue([
      {
        PK: 'RUN#run-1',
        SK: 'META',
        type: 'meta',
        data: { id: 'run-1', createdAt: '2026-01-01T00:00:00Z' },
        updatedAt: '',
        ttl: 0,
      },
      {
        PK: 'RUN#run-2',
        SK: 'META',
        type: 'meta',
        data: { id: 'run-2', createdAt: '2026-01-02T00:00:00Z' },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await listRunsHandler(makeEvent());
    const body = JSON.parse(result.body);
    expect(body.runs[0].id).toBe('run-2');
    expect(body.runs[1].id).toBe('run-1');
  });
});

describe('getRun handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when id is missing', async () => {
    const result = await getRunHandler(makeEvent());
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when run not found', async () => {
    vi.mocked(getRunMeta).mockResolvedValue(null);
    const result = await getRunHandler(makeEvent({ pathParameters: { id: 'nonexistent' } }));
    expect(result.statusCode).toBe(404);
  });

  it('returns run with stories and agents', async () => {
    vi.mocked(getRunMeta).mockResolvedValue({
      PK: 'RUN#run-1',
      SK: 'META',
      type: 'meta',
      data: { id: 'run-1', title: 'Test', status: 'running' },
      updatedAt: '',
      ttl: 0,
    });
    vi.mocked(queryByRunId).mockImplementation(async (_runId, prefix) => {
      if (prefix === 'STORY#')
        return [
          {
            PK: 'RUN#run-1',
            SK: 'STORY#STR-001',
            type: 'story',
            data: { id: 'STR-001', title: 'Story 1' },
            updatedAt: '',
            ttl: 0,
          },
        ];
      if (prefix === 'AGENT#')
        return [
          {
            PK: 'RUN#run-1',
            SK: 'AGENT#agent-1',
            type: 'agent',
            data: { id: 'agent-1', role: 'senior' },
            updatedAt: '',
            ttl: 0,
          },
        ];
      return [];
    });

    const result = await getRunHandler(makeEvent({ pathParameters: { id: 'run-1' } }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.id).toBe('run-1');
    expect(body.stories).toHaveLength(1);
    expect(body.agents).toHaveLength(1);
  });
});

describe('cancelRun handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCancelECSClient({ send: mockECSSend } as never);
  });

  it('returns 400 when id is missing', async () => {
    const result = await cancelRun(makeEvent());
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when run not found', async () => {
    vi.mocked(getRunMeta).mockResolvedValue(null);
    const result = await cancelRun(makeEvent({ pathParameters: { id: 'nonexistent' } }));
    expect(result.statusCode).toBe(404);
  });

  it('returns 409 when run is already completed', async () => {
    vi.mocked(getRunMeta).mockResolvedValue({
      PK: 'RUN#run-1',
      SK: 'META',
      type: 'meta',
      data: { status: 'completed' },
      updatedAt: '',
      ttl: 0,
    });
    const result = await cancelRun(makeEvent({ pathParameters: { id: 'run-1' } }));
    expect(result.statusCode).toBe(409);
  });

  it('cancels a running run', async () => {
    vi.mocked(getRunMeta).mockResolvedValue({
      PK: 'RUN#run-1',
      SK: 'META',
      type: 'meta',
      data: { status: 'running', taskArn: 'arn:aws:ecs:task/123' },
      updatedAt: '',
      ttl: 0,
    });

    const result = await cancelRun(makeEvent({ pathParameters: { id: 'run-1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).status).toBe('cancelled');
    expect(mockECSSend).toHaveBeenCalled();
    expect(putRunMeta).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'cancelled' })
    );
  });
});

describe('getStories handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when id is missing', async () => {
    const result = await getStories(makeEvent());
    expect(result.statusCode).toBe(400);
  });

  it('returns stories for a run', async () => {
    vi.mocked(queryByRunId).mockResolvedValue([
      {
        PK: 'RUN#run-1',
        SK: 'STORY#STR-001',
        type: 'story',
        data: { id: 'STR-001', title: 'Story 1', status: 'in_progress' },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await getStories(makeEvent({ pathParameters: { id: 'run-1' } }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.stories).toHaveLength(1);
    expect(body.stories[0].id).toBe('STR-001');
  });
});

describe('getAgents handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns agents for a run', async () => {
    vi.mocked(queryByRunId).mockResolvedValue([
      {
        PK: 'RUN#run-1',
        SK: 'AGENT#agent-1',
        type: 'agent',
        data: { id: 'agent-1', role: 'senior', status: 'working' },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await getAgents(makeEvent({ pathParameters: { id: 'run-1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).agents).toHaveLength(1);
  });
});

describe('getLogs handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns logs for a run', async () => {
    vi.mocked(queryByRunId).mockResolvedValue([
      {
        PK: 'RUN#run-1',
        SK: 'LOG#2026-01-01#1',
        type: 'log',
        data: { id: 1, message: 'Started', event_type: 'info' },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await getLogs(makeEvent({ pathParameters: { id: 'run-1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).logs).toHaveLength(1);
  });
});

describe('getPRs handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns PRs for a run', async () => {
    vi.mocked(queryByRunId).mockResolvedValue([
      {
        PK: 'RUN#run-1',
        SK: 'PR#pr-1',
        type: 'pr',
        data: { id: 'pr-1', url: 'https://github.com/org/repo/pull/1', status: 'open' },
        updatedAt: '',
        ttl: 0,
      },
    ]);

    const result = await getPRs(makeEvent({ pathParameters: { id: 'run-1' } }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).prs).toHaveLength(1);
  });
});

describe('sendMessage handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when id is missing', async () => {
    const result = await sendMessage(makeEvent());
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when message is missing', async () => {
    const result = await sendMessage(
      makeEvent({ pathParameters: { id: 'run-1' }, body: JSON.stringify({}) })
    );
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when run not found', async () => {
    vi.mocked(getRunMeta).mockResolvedValue(null);
    const result = await sendMessage(
      makeEvent({ pathParameters: { id: 'run-1' }, body: JSON.stringify({ message: 'hello' }) })
    );
    expect(result.statusCode).toBe(404);
  });

  it('returns 409 when run is not running', async () => {
    vi.mocked(getRunMeta).mockResolvedValue({
      PK: 'RUN#run-1',
      SK: 'META',
      type: 'meta',
      data: { status: 'completed' },
      updatedAt: '',
      ttl: 0,
    });
    const result = await sendMessage(
      makeEvent({ pathParameters: { id: 'run-1' }, body: JSON.stringify({ message: 'hello' }) })
    );
    expect(result.statusCode).toBe(409);
  });

  it('sends a message to a running run', async () => {
    vi.mocked(getRunMeta).mockResolvedValue({
      PK: 'RUN#run-1',
      SK: 'META',
      type: 'meta',
      data: { status: 'running' },
      updatedAt: '',
      ttl: 0,
    });

    const result = await sendMessage(
      makeEvent({ pathParameters: { id: 'run-1' }, body: JSON.stringify({ message: 'hello' }) })
    );
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).status).toBe('sent');
    expect(putStateItem).toHaveBeenCalledWith(
      'run-1',
      expect.stringContaining('INBOUND_MSG#'),
      'inbound_msg',
      expect.objectContaining({ message: 'hello' })
    );
  });
});

describe('updateSettings handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when body is missing', async () => {
    const result = await updateSettingsHandler(makeEvent());
    expect(result.statusCode).toBe(400);
  });

  it('updates settings and redacts secrets', async () => {
    vi.mocked(getSettings).mockResolvedValue({ defaultModel: 'claude-opus-4-6' });

    const result = await updateSettingsHandler(
      makeEvent({
        body: JSON.stringify({
          defaultModel: 'claude-sonnet-4-6',
          anthropicKeyArn: 'arn:aws:secretsmanager:us-east-1:123:secret:key',
        }),
      })
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.settings.defaultModel).toBe('claude-sonnet-4-6');
    expect(body.settings.anthropicKeyArn).toBe('***redacted***');
    expect(putSettings).toHaveBeenCalled();
  });
});

describe('getSettings handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty settings when none exist', async () => {
    vi.mocked(getSettings).mockResolvedValue(null);
    const result = await getSettingsHandler(makeEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).settings).toEqual({});
  });

  it('returns settings with redacted secrets', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      PK: 'SETTINGS',
      SK: 'GLOBAL',
      defaultModel: 'claude-opus-4-6',
      anthropicKeyArn: 'arn:aws:secretsmanager:us-east-1:123:secret:key',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const result = await getSettingsHandler(makeEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.settings.defaultModel).toBe('claude-opus-4-6');
    expect(body.settings.anthropicKeyArn).toBe('***redacted***');
    expect(body.settings.PK).toBeUndefined();
    expect(body.settings.SK).toBeUndefined();
  });
});
