import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
const execFileAsync = promisify(execFile);

// Load .env file from project root
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
  console.log('[env] Loaded .env file');
}

const GITHUB_CLIENT_ID = process.env.VITE_GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const PORT = 3001;
const HIVE_BIN = process.env.HIVE_BIN || 'hive';
// The hive project root (where .hive/ lives)
const HIVE_ROOT = process.env.HIVE_ROOT || path.resolve(process.cwd(), '../..');
const HIVE_DB = path.join(HIVE_ROOT, '.hive', 'hive.db');
// Container workspace (bind-mounted from docker-compose)
const CONTAINER_WORKSPACE = path.resolve(process.cwd(), 'workspace');
const CONTAINER_HIVE_DB = path.join(CONTAINER_WORKSPACE, '.hive', 'hive.db');

// In-memory store for runs
const runs = new Map();

// ─── Hive CLI helpers ───

function addLog(run, message) {
  run.logs.push({ timestamp: new Date().toISOString(), message });
  console.log(`[${run.id}] ${message}`);
}

async function runHive(args, run) {
  addLog(run, `$ hive ${args.join(' ')}`);
  try {
    const { stdout, stderr } = await execFileAsync(HIVE_BIN, args, {
      cwd: HIVE_ROOT,
      timeout: 120_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    if (stdout.trim()) addLog(run, stdout.trim().slice(0, 500));
    if (stderr.trim()) addLog(run, `[stderr] ${stderr.trim().slice(0, 300)}`);
    return stdout;
  } catch (err) {
    addLog(run, `[error] ${err.message.slice(0, 500)}`);
    throw err;
  }
}

// Poll hive.db using sqlite3 CLI and update the run object
function startPolling(run) {
  if (!fs.existsSync(HIVE_DB)) {
    addLog(run, `Warning: hive.db not found at ${HIVE_DB}, polling skipped`);
    return;
  }

  addLog(run, 'Started polling hive.db for updates');

  async function queryDb(sql) {
    const { stdout } = await execFileAsync('sqlite3', ['-json', HIVE_DB, sql], { timeout: 5000 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  }

  // Track last seen log ID to only fetch new entries
  let lastLogId = 0;

  const SKIP_EVENTS = new Set(['PR_SYNC_SKIPPED', 'WORKTREE_REMOVAL_FAILED']);
  const MILESTONE_EVENTS = new Set([
    'REQUIREMENT_RECEIVED', 'PLANNING_STARTED', 'AGENT_SPAWNED',
    'STORY_ASSIGNED', 'APPROACH_POSTED', 'STORY_PROGRESS_UPDATE',
    'PR_SUBMITTED', 'PR_REVIEW_STARTED', 'PR_APPROVED', 'PR_REJECTED',
    'PR_MERGED', 'PR_CLOSED', 'STORY_MERGED', 'STORY_QA_FAILED',
    'TEAM_SCALED_UP', 'TEAM_SCALED_DOWN',
    'ESCALATION_CREATED', 'ESCALATION_RESOLVED',
    'AGENT_TERMINATED',
  ]);

  const poll = async () => {
    if (run.status === 'cancelled') {
      clearInterval(interval);
      return;
    }
    try {
      const [stories, agents, newLogs, escalations, reqs, storyDeps] = await Promise.all([
        queryDb('SELECT id, title, description, acceptance_criteria, status, team_id, pr_url, branch_name, story_points, complexity_score, assigned_agent_id, created_at, updated_at FROM stories ORDER BY id'),
        queryDb('SELECT id, type, status, current_story_id, team_id, model FROM agents ORDER BY id'),
        queryDb(`SELECT id, agent_id, story_id, event_type, message, metadata, timestamp FROM agent_logs WHERE id > ${lastLogId} ORDER BY id`),
        queryDb('SELECT id, story_id, from_agent_id, reason, status, resolution, created_at FROM escalations ORDER BY created_at DESC LIMIT 20'),
        queryDb('SELECT id, title, status, feature_branch FROM requirements ORDER BY created_at DESC LIMIT 5'),
        queryDb('SELECT story_id, depends_on_story_id FROM story_dependencies').catch(() => []),
      ]);

      // Build dependency lookup: storyId -> [dependsOnIds]
      const depMap = {};
      for (const d of storyDeps) {
        if (!depMap[d.story_id]) depMap[d.story_id] = [];
        depMap[d.story_id].push(d.depends_on_story_id);
      }

      run.stories = stories.map(s => ({
        id: s.id,
        title: s.title,
        description: s.description,
        acceptanceCriteria: s.acceptance_criteria,
        status: s.status,
        points: s.story_points,
        complexityScore: s.complexity_score,
        teamId: s.team_id,
        prUrl: s.pr_url,
        branchName: s.branch_name,
        assignedAgentId: s.assigned_agent_id,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        dependencies: depMap[s.id] || [],
      }));

      run.agents = agents.map(a => ({
        id: a.id,
        role: a.type.replace('_', ' '),
        name: `${a.type} ${a.id.slice(0, 8)}`,
        type: a.type,
        status: a.status,
        currentStory: a.current_story_id || undefined,
        storyId: a.current_story_id,
        teamId: a.team_id,
        model: a.model,
      }));

      run.escalations = escalations.map(e => ({
        id: e.id,
        storyId: e.story_id,
        fromAgentId: e.from_agent_id,
        reason: e.reason,
        status: e.status,
        resolution: e.resolution,
        createdAt: e.created_at,
      }));

      run.requirements = reqs.map(r => ({
        id: r.id,
        title: r.title,
        status: r.status,
        featureBranch: r.feature_branch,
      }));

      // Append meaningful agent_logs as activity feed entries
      for (const log of newLogs) {
        if (SKIP_EVENTS.has(log.event_type)) continue;
        lastLogId = Math.max(lastLogId, log.id);
        const entry = {
          timestamp: log.timestamp,
          message: log.message || log.event_type,
          eventType: log.event_type,
          agentId: log.agent_id,
          storyId: log.story_id,
          isMilestone: MILESTONE_EVENTS.has(log.event_type),
        };
        // Parse metadata for extra context
        if (log.metadata) {
          try {
            entry.metadata = JSON.parse(log.metadata);
          } catch { /* ignore */ }
        }
        run.logs.push(entry);
      }
      // Update lastLogId even for skipped events
      if (newLogs.length > 0) {
        lastLogId = Math.max(lastLogId, newLogs[newLogs.length - 1].id);
      }

      // Check if all stories are done/merged
      const allDone = stories.length > 0 && stories.every(s => ['done', 'merged'].includes(s.status));
      if (allDone && run.status === 'running') {
        run.status = 'completed';
        addLog(run, 'All stories completed!');
      }
    } catch {
      // DB might be locked, retry next tick
    }
  };

  const interval = setInterval(poll, 3000);
  poll();
  run._pollInterval = interval;
}

const PROJECT_ROOT = path.resolve(process.cwd());

async function orchestrateRun(run) {
  try {
    const containerName = `hive-run-${run.id}`;
    const repoUrlsJson = JSON.stringify(run.repositories);

    addLog(run, `Starting Hive container: ${containerName}`);

    // Build the image first (if not already built)
    addLog(run, 'Building Hive Docker image...');
    try {
      await execFileAsync('docker', ['compose', '-f', 'docker-compose.local.yml', 'build', 'hive'], {
        cwd: PROJECT_ROOT,
        timeout: 300_000,
        env: { ...process.env, DOCKER_BUILDKIT: '1' },
      });
      addLog(run, 'Docker image built successfully');
    } catch (err) {
      addLog(run, `[warn] Build failed (may already exist): ${err.message.slice(0, 200)}`);
    }

    // Start the full stack with run-specific env vars
    const env = {
      ...process.env,
      RUN_ID: run.id,
      REPO_URLS: repoUrlsJson,
      REQUIREMENT_TITLE: run.title,
      REQUIREMENT_DESCRIPTION: run.description || '',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    };

    addLog(run, 'Starting LocalStack + Hive containers...');
    const compose = spawn('docker', [
      'compose', '-f', 'docker-compose.local.yml',
      'up', '--no-build', '-d',
    ], {
      cwd: PROJECT_ROOT,
      env,
    });

    compose.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) addLog(run, msg);
    });
    compose.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) addLog(run, msg);
    });

    await new Promise((resolve, reject) => {
      compose.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`docker compose exited with code ${code}`));
      });
    });

    addLog(run, 'Containers started — monitoring workspace hive.db');

    // Poll the container's hive.db via bind-mounted workspace
    startContainerPolling(run);

  } catch (err) {
    run.status = 'failed';
    addLog(run, `Orchestration failed: ${err.message}`);

    // Fallback: try local hive execution
    addLog(run, 'Falling back to local hive execution...');
    try {
      startPolling(run);
      const args = ['req', run.title, '--target-branch', 'main'];
      if (run.title) args.push('--title', run.title);
      runHive(args, run).catch(() => {});
    } catch {
      addLog(run, 'Local fallback also failed');
    }
  }
}

// Poll the container's hive.db (bind-mounted at ./workspace/.hive/hive.db)
function startContainerPolling(run) {
  addLog(run, `Polling container hive.db at ${CONTAINER_HIVE_DB}`);

  async function queryContainerDb(sql) {
    const { stdout } = await execFileAsync('sqlite3', ['-json', CONTAINER_HIVE_DB, sql], { timeout: 5000 });
    return stdout.trim() ? JSON.parse(stdout) : [];
  }

  let lastLogId = 0;
  let lastTmuxLines = new Map(); // track last seen tmux output per session
  const SKIP_EVENTS = new Set(['PR_SYNC_SKIPPED', 'WORKTREE_REMOVAL_FAILED']);

  // Capture tmux output from agent sessions in the container
  async function captureTmuxUpdates() {
    try {
      const { stdout: sessionsOut } = await execFileAsync('docker', [
        'exec', 'hive-local', 'tmux', 'list-sessions', '-F', '#{session_name}',
      ], { timeout: 5000 });

      const sessions = sessionsOut.trim().split('\n').filter(Boolean);
      for (const session of sessions) {
        try {
          const { stdout: paneOut } = await execFileAsync('docker', [
            'exec', 'hive-local', 'tmux', 'capture-pane', '-t', session, '-p', '-S', '-20',
          ], { timeout: 5000 });

          const lines = paneOut.trim().split('\n').filter(l => l.trim());
          const lastSeen = lastTmuxLines.get(session) || '';

          // Find new lines since last check
          const lastIdx = lines.findIndex(l => l === lastSeen);
          const newLines = lastIdx >= 0 ? lines.slice(lastIdx + 1) : lines.slice(-5);

          if (newLines.length > 0) {
            lastTmuxLines.set(session, lines[lines.length - 1]);
            // Filter out noise (prompts, empty lines, escape codes)
            const meaningful = newLines
              .map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
              .filter(l => l && !l.startsWith('$') && !l.startsWith('root@') && !l.startsWith('hive@')
                && !l.startsWith('❯') && !l.startsWith('⏵') && !l.includes('bypass permissions')
                && !l.includes('Auto-update failed') && !l.includes('Claude in Chrom')
                && !l.includes('shift+t') && !l.startsWith('────') && l.length > 5);

            for (const line of meaningful.slice(-3)) { // max 3 lines per poll
              run.logs.push({
                timestamp: new Date().toISOString(),
                message: line.slice(0, 200),
                eventType: 'AGENT_OUTPUT',
                agentId: session,
                isMilestone: false,
              });
            }
          }
        } catch { /* session may have ended */ }
      }
    } catch { /* no tmux sessions yet */ }
  }

  const poll = async () => {
    if (run.status === 'cancelled') {
      clearInterval(interval);
      return;
    }
    if (!fs.existsSync(CONTAINER_HIVE_DB)) return; // not ready yet

    try {
      const [stories, agents, newLogs, escalations, storyDeps] = await Promise.all([
        queryContainerDb('SELECT id, title, description, acceptance_criteria, status, team_id, pr_url, branch_name, story_points, complexity_score, assigned_agent_id, created_at, updated_at FROM stories ORDER BY id'),
        queryContainerDb('SELECT id, type, status, current_story_id, team_id, model FROM agents ORDER BY id'),
        queryContainerDb(`SELECT id, agent_id, story_id, event_type, message, metadata, timestamp FROM agent_logs WHERE id > ${lastLogId} ORDER BY id`),
        queryContainerDb('SELECT id, story_id, from_agent_id, reason, status, resolution, created_at FROM escalations ORDER BY created_at DESC LIMIT 20'),
        queryContainerDb('SELECT story_id, depends_on_story_id FROM story_dependencies').catch(() => []),
      ]);

      const depMap = {};
      for (const d of storyDeps) {
        if (!depMap[d.story_id]) depMap[d.story_id] = [];
        depMap[d.story_id].push(d.depends_on_story_id);
      }

      run.stories = stories.map(s => ({
        id: s.id,
        title: s.title,
        description: s.description,
        acceptanceCriteria: s.acceptance_criteria,
        status: s.status,
        points: s.story_points,
        complexityScore: s.complexity_score,
        teamId: s.team_id,
        prUrl: s.pr_url,
        branchName: s.branch_name,
        assignedAgentId: s.assigned_agent_id,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        dependencies: depMap[s.id] || [],
      }));

      run.agents = agents.map(a => ({
        id: a.id,
        role: a.type.replace('_', ' '),
        name: `${a.type} ${a.id.slice(0, 8)}`,
        type: a.type,
        status: a.status,
        currentStory: a.current_story_id || undefined,
        storyId: a.current_story_id,
        teamId: a.team_id,
        model: a.model,
      }));

      run.escalations = escalations.map(e => ({
        id: e.id, storyId: e.story_id, fromAgentId: e.from_agent_id,
        reason: e.reason, status: e.status, resolution: e.resolution, createdAt: e.created_at,
      }));

      for (const log of newLogs) {
        if (SKIP_EVENTS.has(log.event_type)) continue;
        lastLogId = Math.max(lastLogId, log.id);
        run.logs.push({
          timestamp: log.timestamp, message: log.message || log.event_type,
          eventType: log.event_type, agentId: log.agent_id,
          storyId: log.story_id, isMilestone: true,
        });
      }
      if (newLogs.length > 0) lastLogId = Math.max(lastLogId, newLogs[newLogs.length - 1].id);

      const allDone = stories.length > 0 && stories.every(s => ['done', 'merged'].includes(s.status));
      if (allDone && run.status === 'running') {
        run.status = 'completed';
        addLog(run, 'All stories completed!');
      }
    } catch {
      // DB not ready or locked, retry
    }

    // Also capture live tmux output
    await captureTmuxUpdates();
  };

  const interval = setInterval(poll, 3000);
  poll();
  run._pollInterval = interval;
}

// Poll DynamoDB in LocalStack for state updates (unused for now, kept for cloud mode)
function startDynamoPolling(run) {
  const LOCALSTACK = 'http://localhost:4566';
  const TABLE = 'distributed-hive-state';

  addLog(run, 'Started polling DynamoDB for state updates');

  const poll = async () => {
    if (run.status === 'cancelled') {
      clearInterval(interval);
      return;
    }
    try {
      // Query DynamoDB via LocalStack AWS CLI
      const { stdout } = await execFileAsync('aws', [
        'dynamodb', 'scan',
        '--table-name', TABLE,
        '--endpoint-url', LOCALSTACK,
        '--region', 'us-east-1',
        '--output', 'json',
      ], {
        timeout: 5000,
        env: { ...process.env, AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test' },
      });

      const data = JSON.parse(stdout);
      if (data.Items) {
        const stories = [];
        const agents = [];
        const logs = [];

        for (const item of data.Items) {
          const type = item.sk?.S || '';
          if (type.startsWith('STORY#')) {
            stories.push({
              id: item.story_id?.S || type.replace('STORY#', ''),
              title: item.title?.S || '',
              status: item.status?.S || 'todo',
              teamId: item.team_id?.S,
              prUrl: item.pr_url?.S,
              branchName: item.branch_name?.S,
            });
          } else if (type.startsWith('AGENT#')) {
            agents.push({
              id: item.agent_id?.S || type.replace('AGENT#', ''),
              name: `${item.type?.S || 'agent'} ${(item.agent_id?.S || '').slice(0, 8)}`,
              type: item.type?.S,
              status: item.status?.S || 'idle',
              storyId: item.current_story_id?.S,
              teamId: item.team_id?.S,
              model: item.model?.S,
            });
          } else if (type.startsWith('LOG#')) {
            logs.push({
              timestamp: item.timestamp?.S || new Date().toISOString(),
              message: item.message?.S || '',
              eventType: item.event_type?.S,
              agentId: item.agent_id?.S,
              storyId: item.story_id?.S,
              isMilestone: true,
            });
          }
        }

        if (stories.length) run.stories = stories;
        if (agents.length) run.agents = agents;
        // Append new logs (deduplicate by checking last known count)
        if (logs.length > run.logs.length) {
          run.logs = [...run.logs, ...logs.slice(run.logs.length)];
        }

        const allDone = stories.length > 0 && stories.every(s => ['done', 'merged'].includes(s.status));
        if (allDone && run.status === 'running') {
          run.status = 'completed';
          addLog(run, 'All stories completed!');
        }
      }
    } catch {
      // DynamoDB not ready yet or scan failed — will retry
    }
  };

  const interval = setInterval(poll, 5000);
  poll();
  run._pollInterval = interval;
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Normalize: strip /api prefix so both /api/runs and /runs work
  const rawPath = url.pathname;
  const path = rawPath.startsWith('/api/') ? rawPath : `/api${rawPath}`;
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, (key, val) => key.startsWith('_') ? undefined : val));
  };

  // POST /api/auth/github
  if (req.method === 'POST' && path === '/api/auth/github') {
    const { code } = await readBody(req);
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return json(401, { error: tokenData.error_description });

    const userRes = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();
    // Store token server-side so it can be passed to the container
    process.env.GITHUB_TOKEN = tokenData.access_token;
    console.log(`[auth] GitHub token stored for ${user.login}`);
    return json(200, { token: tokenData.access_token, user: { login: user.login, avatarUrl: user.avatar_url, name: user.name } });
  }

  // POST /api/runs — create a run
  if (req.method === 'POST' && path === '/api/runs') {
    // Capture GitHub token from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const ghToken = authHeader.slice(7);
      if (ghToken && ghToken !== 'undefined') {
        process.env.GITHUB_TOKEN = ghToken;
        console.log(`[auth] GitHub token captured from run request`);
      }
    }
    const body = await readBody(req);
    const id = `run-${crypto.randomBytes(4).toString('hex')}`;
    const run = {
      id,
      title: body.title || 'Untitled',
      description: body.description || '',
      repositories: body.repositories || [],
      model: body.model || 'Claude Opus 4.6',
      sizeTier: body.sizeTier || 'medium',
      status: 'running',
      stories: [],
      agents: [],
      logs: [{ timestamp: new Date().toISOString(), message: 'Run created' }],
      createdAt: new Date().toISOString(),
    };
    runs.set(id, run);
    console.log(`[RUN CREATED] ${id}: "${run.title}" with ${run.repositories.length} repos`);

    // Fire-and-forget: orchestrate the hive run
    orchestrateRun(run).catch(err => {
      addLog(run, `[fatal] ${err.message}`);
      run.status = 'failed';
    });

    return json(200, { id });
  }

  // GET /api/runs — list runs
  if (req.method === 'GET' && path === '/api/runs') {
    return json(200, Array.from(runs.values()));
  }

  // GET /api/runs/:id
  const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
  if (req.method === 'GET' && runMatch) {
    const run = runs.get(runMatch[1]);
    if (!run) return json(404, { error: 'Run not found' });
    return json(200, run);
  }

  // GET /api/runs/:id/stories
  const storiesMatch = path.match(/^\/api\/runs\/([^/]+)\/stories$/);
  if (req.method === 'GET' && storiesMatch) {
    const run = runs.get(storiesMatch[1]);
    if (!run) return json(404, { error: 'Run not found' });
    return json(200, run.stories);
  }

  // GET /api/runs/:id/agents
  const agentsMatch = path.match(/^\/api\/runs\/([^/]+)\/agents$/);
  if (req.method === 'GET' && agentsMatch) {
    const run = runs.get(agentsMatch[1]);
    if (!run) return json(404, { error: 'Run not found' });
    return json(200, run.agents);
  }

  // GET /api/runs/:id/logs
  const logsMatch = path.match(/^\/api\/runs\/([^/]+)\/logs$/);
  if (req.method === 'GET' && logsMatch) {
    const run = runs.get(logsMatch[1]);
    if (!run) return json(404, { error: 'Run not found' });
    return json(200, run.logs);
  }

  // GET /api/runs/:id/escalations
  const escalationsMatch = path.match(/^\/api\/runs\/([^/]+)\/escalations$/);
  if (req.method === 'GET' && escalationsMatch) {
    const run = runs.get(escalationsMatch[1]);
    if (!run) return json(404, { error: 'Run not found' });
    return json(200, run.escalations || []);
  }

  // DELETE /api/runs/:id — cancel
  const deleteMatch = path.match(/^\/api\/runs\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const run = runs.get(deleteMatch[1]);
    if (!run) return json(404, { error: 'Run not found' });
    run.status = 'cancelled';
    if (run._pollInterval) clearInterval(run._pollInterval);
    return json(200, { status: 'cancelled' });
  }

  json(404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`Local API running on http://localhost:${PORT}`));
