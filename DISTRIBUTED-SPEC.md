# Distributed Hive — AWS On-Demand Architecture Specification

## 1. Overview

Distributed Hive converts the existing Hive AI agent orchestrator from a local CLI tool into an **on-demand AWS-hosted service**. Instead of running permanently, compute spins up per-request and tears down when done — paying only for actual usage.

**Core principle:** Each incoming requirement triggers an ephemeral Hive instance on AWS. The instance runs the full agent lifecycle (Tech Lead analysis → story breakdown → agent spawning → implementation → PR merge), then terminates.

### 1.1 Goals

- **Zero idle cost** — no permanently running servers
- **Web-accessible** — submit requirements and monitor progress from a browser
- **Preserve core logic** — scheduler, manager loop, escalation flow, agent hierarchy remain intact
- **Multi-tenant capable** — multiple users can submit concurrent requirements
- **Minimal code changes** — wrap existing Hive in infrastructure, don't rewrite orchestration logic

### 1.2 Non-Goals

- Real-time collaborative editing (not an IDE)
- Multi-region deployment (single region is sufficient for v1)
- Custom LLM hosting (uses Anthropic/OpenAI APIs as-is)

---

## 2. Architecture

### 2.1 High-Level Flow

```
User → CloudFront → S3 (React dashboard)
    ↕ WebSocket (API Gateway v2)
    ↕
API Gateway (REST) → Lambda (API handlers)
    ↓
    ├── Submit Requirement → SQS → ECS Fargate Task (Hive instance)
    ├── Get Status         → DynamoDB (read state)
    ├── List Stories        → DynamoDB (read state)
    └── Cancel Run          → ECS (stop task)

ECS Fargate Task (Hive Instance):
    ├── Runs full hive lifecycle (tmux + claude CLI + git)
    ├── Writes state to DynamoDB via state-sync adapter
    ├── Pushes progress events to WebSocket via EventBridge
    └── Terminates on completion
```

### 2.2 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS Cloud                            │
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │CloudFront│───▶│  S3 Bucket   │    │  Secrets Manager │  │
│  │  (CDN)   │    │ (React App)  │    │  (API keys)      │  │
│  └──────────┘    └──────────────┘    └──────────────────┘  │
│                                              │              │
│  ┌──────────────────────────────┐            │              │
│  │    API Gateway (REST + WS)   │            │              │
│  └──────┬───────────────┬───────┘            │              │
│         │               │                    │              │
│  ┌──────▼──────┐ ┌──────▼──────┐             │              │
│  │  Lambda     │ │  Lambda     │             │              │
│  │  (API)      │ │  (WS mgr)  │             │              │
│  └──────┬──────┘ └──────▲──────┘             │              │
│         │               │                    │              │
│  ┌──────▼──────┐ ┌──────┴──────┐             │              │
│  │    SQS      │ │ EventBridge │             │              │
│  │  (job queue)│ │ (events)    │             │              │
│  └──────┬──────┘ └──────▲──────┘             │              │
│         │               │                    │              │
│  ┌──────▼───────────────┴────────────────────▼──────────┐  │
│  │                 ECS Fargate Task                      │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  Docker Container (Hive Instance)               │  │  │
│  │  │                                                 │  │  │
│  │  │  ┌────────┐ ┌───────┐ ┌──────┐ ┌────────────┐ │  │  │
│  │  │  │ Hive   │ │ tmux  │ │ git  │ │ Claude CLI │ │  │  │
│  │  │  │ CLI    │ │       │ │      │ │ / Codex    │ │  │  │
│  │  │  └────────┘ └───────┘ └──────┘ └────────────┘ │  │  │
│  │  │                                                 │  │  │
│  │  │  ┌──────────────┐  ┌─────────────────────────┐ │  │  │
│  │  │  │ SQLite (local│  │ State Sync Adapter      │ │  │  │
│  │  │  │ .hive/hive.db│──│ (DynamoDB writer)       │ │  │  │
│  │  │  └──────────────┘  └─────────────────────────┘ │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                        │                              │  │
│  │  ┌─────────────────────▼──────────────────────────┐   │  │
│  │  │              EFS (shared storage)               │   │  │
│  │  │  /repos    /hive-state    /agent-logs           │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              DynamoDB                                │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │   │
│  │  │ Runs     │ │ Stories  │ │ Agent Logs           │ │   │
│  │  │ (status) │ │ (state)  │ │ (events)             │ │   │
│  │  └──────────┘ └──────────┘ └──────────────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              CloudWatch                              │   │
│  │  Logs • Metrics • Alarms                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Key Design Decision: Keep Hive Intact

Rather than rewriting Hive's internals, the distributed version **wraps the existing Hive CLI** inside a Docker container. Hive continues to use tmux, SQLite, and git worktrees locally within the container. A **state-sync adapter** mirrors state changes to DynamoDB for the web dashboard to read.

This preserves:
- The scheduler's topological sorting and capacity planning
- The manager daemon's stuck detection and escalation logic
- All CLI runtime builders (Claude, Codex, Gemini)
- Agent state detectors and screen parsing
- Git worktree isolation per agent

---

## 3. Infrastructure Components

### 3.1 Web Frontend (S3 + CloudFront)

**Purpose:** Browser-based UI for submitting requirements and monitoring progress.

**Stack:** React + TypeScript + Tailwind CSS

**Pages:**
| Page | Description |
|------|-------------|
| `/` | Dashboard — active runs, recent completions |
| `/submit` | New requirement form (title, description, repo URLs, config overrides) |
| `/run/:id` | Live run view — agents, stories, activity log (WebSocket-powered) |
| `/run/:id/stories` | Story breakdown with status, assignee, PR links |
| `/history` | Past runs with cost tracking |
| `/settings` | API keys, GitHub tokens, default config |

**Hosting:**
- S3 bucket with static website hosting
- CloudFront distribution with HTTPS (ACM certificate)
- Route 53 for custom domain (optional)
- Cost: ~$1-5/month

### 3.2 API Layer (API Gateway + Lambda)

**Purpose:** REST API for CRUD operations + WebSocket API for real-time updates.

#### REST Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/api/runs` | `createRun` | Submit new requirement, enqueue Fargate task |
| GET | `/api/runs` | `listRuns` | List all runs with status |
| GET | `/api/runs/:id` | `getRun` | Get run details |
| DELETE | `/api/runs/:id` | `cancelRun` | Stop ECS task, mark cancelled |
| GET | `/api/runs/:id/stories` | `getStories` | List stories for a run |
| GET | `/api/runs/:id/agents` | `getAgents` | List agents for a run |
| GET | `/api/runs/:id/logs` | `getLogs` | Get agent activity logs |
| GET | `/api/runs/:id/prs` | `getPRs` | List PRs created by agents |
| POST | `/api/runs/:id/message` | `sendMessage` | Send message to Tech Lead |
| PUT | `/api/settings` | `updateSettings` | Update user config/secrets |
| GET | `/api/settings` | `getSettings` | Get current config (redacted secrets) |

#### WebSocket API

| Action | Direction | Description |
|--------|-----------|-------------|
| `subscribe` | Client → Server | Subscribe to run updates |
| `story_update` | Server → Client | Story status changed |
| `agent_update` | Server → Client | Agent spawned/completed/stuck |
| `log_entry` | Server → Client | New activity log entry |
| `pr_created` | Server → Client | PR submitted |
| `run_complete` | Server → Client | All stories merged, run done |
| `escalation` | Server → Client | Agent needs human input |

**Implementation:**
- API Gateway HTTP API (cheaper than REST API)
- Lambda functions (Node.js 20, TypeScript)
- WebSocket connections managed via API Gateway v2
- Connection IDs stored in DynamoDB for broadcasting
- Cost: ~$1-3/month at moderate usage

### 3.3 Job Queue (SQS)

**Purpose:** Decouple API from compute. Ensures runs are processed even if ECS is temporarily at capacity.

**Queue configuration:**
```
Queue: distributed-hive-runs
Type: Standard (order doesn't matter)
Visibility Timeout: 900s (15 min — time to start ECS task)
Message Retention: 14 days
Dead Letter Queue: distributed-hive-runs-dlq (after 3 failures)
```

**Message schema:**
```json
{
  "runId": "run-abc123",
  "requirement": {
    "title": "Add user authentication",
    "description": "Implement OAuth2 login with GitHub..."
  },
  "repos": [
    {
      "url": "https://github.com/org/service-a",
      "teamName": "service-a"
    }
  ],
  "config": {
    "models": { "tech_lead": { "model": "claude-opus-4-6" } },
    "scaling": { "junior_max_complexity": 3 }
  },
  "secrets": {
    "anthropicKeyArn": "arn:aws:secretsmanager:...",
    "githubTokenArn": "arn:aws:secretsmanager:..."
  },
  "userId": "user-xyz",
  "callbackUrl": "wss://api.distributed-hive.com/ws"
}
```

**Cost:** ~$0.01/month (pennies per million requests)

### 3.4 Compute (ECS Fargate)

**Purpose:** Run the full Hive lifecycle in an isolated container per requirement.

#### Docker Image

```dockerfile
FROM node:20-slim

# System dependencies
RUN apt-get update && apt-get install -y \
    tmux \
    git \
    curl \
    jq \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh

# Install Hive
COPY . /opt/hive
WORKDIR /opt/hive
RUN npm ci && npm run build

# Entry point script
COPY infra/entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

ENTRYPOINT ["/opt/entrypoint.sh"]
```

#### Entrypoint Script (`infra/entrypoint.sh`)

```bash
#!/bin/bash
set -euo pipefail

# 1. Fetch secrets from AWS Secrets Manager
export ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
  --secret-id "$ANTHROPIC_KEY_ARN" --query SecretString --output text)
export GITHUB_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "$GITHUB_TOKEN_ARN" --query SecretString --output text)

# 2. Configure git
git config --global user.name "Distributed Hive"
git config --global user.email "hive@distributed-hive.com"
echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
git config --global credential.helper store

# 3. Initialize hive workspace
mkdir -p /workspace && cd /workspace
hive init

# 4. Clone repos from the run config
for repo in $(echo "$REPO_URLS" | jq -r '.[]'); do
  hive add-repo "$repo"
done

# 5. Apply user config overrides
if [ -n "${HIVE_CONFIG_OVERRIDE:-}" ]; then
  echo "$HIVE_CONFIG_OVERRIDE" > .hive/hive.config.yaml
fi

# 6. Start state sync adapter (background)
node /opt/hive/dist/adapters/state-sync.js \
  --run-id "$RUN_ID" \
  --table "$DYNAMODB_TABLE" \
  --event-bus "$EVENTBRIDGE_BUS" &

# 7. Submit requirement and run
hive req "$REQUIREMENT_TITLE" --description "$REQUIREMENT_DESCRIPTION"
hive assign

# 8. Start manager daemon (foreground — keeps container alive)
hive manager start --no-daemon --verbose

# Manager exits when all stories are merged or max runtime exceeded
echo "Run complete. Shutting down."
```

#### Task Definition

```json
{
  "family": "distributed-hive",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "4096",
  "memory": "16384",
  "ephemeralStorage": { "sizeInGiB": 100 },
  "executionRoleArn": "arn:aws:iam::role/hive-execution-role",
  "taskRoleArn": "arn:aws:iam::role/hive-task-role",
  "containerDefinitions": [
    {
      "name": "hive",
      "image": "ECR_REPO_URI:latest",
      "essential": true,
      "environment": [
        { "name": "RUN_ID", "value": "injected-at-runtime" },
        { "name": "DYNAMODB_TABLE", "value": "distributed-hive-state" },
        { "name": "EVENTBRIDGE_BUS", "value": "distributed-hive-events" }
      ],
      "secrets": [
        { "name": "ANTHROPIC_KEY_ARN", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "GITHUB_TOKEN_ARN", "valueFrom": "arn:aws:secretsmanager:..." }
      ],
      "mountPoints": [
        {
          "sourceVolume": "hive-efs",
          "containerPath": "/workspace",
          "readOnly": false
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/distributed-hive",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "hive"
        }
      }
    }
  ],
  "volumes": [
    {
      "name": "hive-efs",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-xxxx",
        "rootDirectory": "/",
        "transitEncryption": "ENABLED"
      }
    }
  ]
}
```

#### Sizing

| Tier | vCPU | Memory | Ephemeral Storage | Use Case |
|------|------|--------|-------------------|----------|
| Small | 2 | 8 GB | 50 GB | 1-3 stories, single team |
| Medium | 4 | 16 GB | 100 GB | 4-10 stories, 2-3 teams |
| Large | 8 | 32 GB | 200 GB | 10+ stories, multi-team |

**Cost per run:**
- Small: ~$0.10/hour → $0.20-0.80 per run (2-8 hours)
- Medium: ~$0.20/hour → $0.40-1.60 per run
- Large: ~$0.40/hour → $0.80-3.20 per run

### 3.5 State Sync Adapter

**Purpose:** Bridge between Hive's local SQLite and DynamoDB, enabling the web dashboard to read live state without modifying Hive's core.

**How it works:**
1. Polls `.hive/hive.db` every 5 seconds (watches file mtime, same as dashboard)
2. Diffs stories, agents, PRs, escalations, and logs against last known state
3. Writes changes to DynamoDB
4. Emits events to EventBridge for WebSocket broadcasting

```typescript
// src/adapters/state-sync.ts

interface StateSyncConfig {
  runId: string;
  dbPath: string;          // .hive/hive.db
  dynamoTable: string;     // distributed-hive-state
  eventBusName: string;    // distributed-hive-events
  pollIntervalMs: number;  // 5000
}

// DynamoDB item structure
interface StateItem {
  PK: string;        // "RUN#run-abc123"
  SK: string;        // "STORY#STR-001" | "AGENT#senior-1" | "LOG#12345"
  type: string;      // "story" | "agent" | "pr" | "escalation" | "log"
  data: Record<string, any>;  // Full row from SQLite
  updatedAt: string; // ISO timestamp
  ttl: number;       // Auto-delete after 30 days
}

// EventBridge event structure
interface HiveEvent {
  source: "distributed-hive";
  detailType: "story_update" | "agent_update" | "pr_created" | "run_complete";
  detail: {
    runId: string;
    entityType: string;
    entityId: string;
    status: string;
    data: Record<string, any>;
  };
}
```

**DynamoDB table design:**

```
Table: distributed-hive-state
Partition Key: PK (String)  — "RUN#<runId>"
Sort Key: SK (String)       — "META" | "STORY#<id>" | "AGENT#<id>" | "PR#<id>" | "LOG#<ts>#<id>"

GSI1: userId-index
  PK: GSI1PK (String) — "USER#<userId>"
  SK: GSI1SK (String)  — "RUN#<runId>"

GSI2: status-index
  PK: GSI2PK (String) — "STATUS#<status>"
  SK: GSI2SK (String)  — "RUN#<runId>"
```

**Cost:** DynamoDB on-demand ~$1-5/month at moderate usage.

### 3.6 Event Broadcasting (EventBridge + Lambda)

**Purpose:** Push real-time updates to connected WebSocket clients.

**Flow:**
```
State Sync Adapter
  → EventBridge (distributed-hive-events bus)
    → Rule: match source = "distributed-hive"
      → Lambda (ws-broadcaster)
        → API Gateway WebSocket → Connected clients
```

**WebSocket broadcaster Lambda:**
```typescript
// Reads connection IDs from DynamoDB connections table
// Filters by runId subscription
// Posts to each connection via API Gateway Management API
```

**Cost:** EventBridge ~$1/million events, Lambda invocations negligible.

### 3.7 Shared Storage (EFS)

**Purpose:** Persist git repos and hive state across container restarts (if a task fails and retries).

**Mount structure:**
```
/efs/
├── runs/
│   ├── run-abc123/
│   │   ├── .hive/          # Hive workspace state
│   │   └── repos/          # Git repos and worktrees
│   └── run-def456/
└── shared/
    └── repo-cache/         # Pre-cloned repos for faster startup
```

**Configuration:**
- Throughput mode: Bursting (sufficient for git operations)
- Performance mode: General Purpose
- Lifecycle policy: Transition to IA after 7 days
- Auto-cleanup: Lambda cron deletes runs older than 30 days

**Cost:** ~$5-20/month depending on storage used.

### 3.8 Secrets Management

**Purpose:** Securely store API keys and tokens.

**Secrets stored:**
| Secret | Description |
|--------|-------------|
| `hive/anthropic-api-key` | Anthropic API key for Claude |
| `hive/openai-api-key` | OpenAI API key for Codex/GPT |
| `hive/github-token` | GitHub PAT for PR operations |
| `hive/jira-credentials` | Jira OAuth credentials (optional) |

**Per-user secrets:** For multi-tenant, each user stores their own API keys. Secrets are namespaced: `hive/<userId>/anthropic-api-key`.

**Cost:** $0.40/secret/month + $0.05 per 10,000 API calls ≈ $2/month.

### 3.9 Monitoring (CloudWatch)

**Metrics:**
| Metric | Description | Alarm Threshold |
|--------|-------------|-----------------|
| `RunDuration` | Time from submit to completion | > 8 hours |
| `ActiveTasks` | Currently running Fargate tasks | > 10 (cost control) |
| `AgentStuckCount` | Agents stuck per run | > 3 |
| `StoriesCompleted` | Stories merged per run | Informational |
| `EscalationCount` | Human escalations per run | > 0 (notify user) |
| `EstimatedCost` | Fargate + API cost per run | > $50 (alert) |

**Logs:**
- Container stdout/stderr → CloudWatch Logs
- State sync events → CloudWatch Logs
- API Gateway access logs → CloudWatch Logs
- Retention: 30 days

**Cost:** ~$3-10/month.

---

## 4. State Sync Adapter — Detailed Design

The state sync adapter is the **only new component** that bridges Hive's local execution with AWS infrastructure. It runs as a sidecar process inside the Fargate container.

### 4.1 Sync Strategy

```
┌─────────────────────────────────────────────┐
│            Hive (unchanged)                 │
│                                             │
│  Scheduler → SQLite ← Manager              │
│               │                             │
│         (file on disk)                      │
│               │                             │
│  ┌────────────▼────────────────┐            │
│  │    State Sync Adapter       │            │
│  │                             │            │
│  │  1. Watch hive.db mtime     │            │
│  │  2. Read all tables         │            │
│  │  3. Diff against last snap  │            │
│  │  4. Write deltas to Dynamo  │            │
│  │  5. Emit events to EB       │            │
│  │  6. Check for inbound msgs  │            │
│  └──────────┬──────────────────┘            │
│             │                               │
└─────────────┼───────────────────────────────┘
              │
    ┌─────────▼─────────┐    ┌──────────────┐
    │    DynamoDB        │    │ EventBridge  │
    │  (state store)     │    │ (events)     │
    └───────────────────┘    └──────────────┘
```

### 4.2 Inbound Messages (User → Agent)

When a user sends a message via the web UI (e.g., answering an escalation):

1. API Lambda writes message to DynamoDB with `SK = "INBOUND_MSG#<timestamp>"`
2. State sync adapter polls for inbound messages every 5 seconds
3. On new message: writes it into Hive's SQLite `messages` table
4. Hive's manager picks it up on next poll cycle and forwards to the agent

### 4.3 Run Lifecycle Events

| Event | Trigger | Action |
|-------|---------|--------|
| `run_started` | Entrypoint begins | Write RUN meta to DynamoDB |
| `stories_created` | Tech Lead finishes analysis | Sync all stories |
| `agent_spawned` | Scheduler assigns story | Sync agent record |
| `story_progress` | Agent logs progress | Sync story + logs |
| `pr_created` | Agent submits PR | Sync PR record |
| `escalation` | Agent can't proceed | Sync escalation, notify user |
| `story_merged` | QA approves, PR merged | Sync story status |
| `run_complete` | All stories merged | Write completion, emit event |
| `run_failed` | Unrecoverable error | Write failure reason, emit event |

### 4.4 Completion Detection

The state sync adapter monitors for run completion:

```typescript
function isRunComplete(db: Database): boolean {
  const requirement = db.getRequirement(runId);
  if (!requirement) return false;

  const stories = db.getStoriesByRequirement(requirement.id);
  if (stories.length === 0) return false;

  // All stories must be in a terminal state
  const terminalStatuses = ['merged', 'cancelled', 'rejected'];
  return stories.every(s => terminalStatuses.includes(s.status));
}
```

When complete:
1. Write final state snapshot to DynamoDB
2. Emit `run_complete` event
3. Export agent logs to S3 for long-term storage
4. Signal the entrypoint script to exit (kills the Fargate task)

---

## 5. Web Dashboard — Detailed Design

### 5.1 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | React 18 + TypeScript | Industry standard, large ecosystem |
| Styling | Tailwind CSS | Rapid UI development |
| State | Zustand | Lightweight, WebSocket-friendly |
| Routing | React Router v6 | Standard SPA routing |
| Build | Vite | Fast builds, good DX |
| Auth | Cognito (optional) or API key | Simple auth for v1 |

### 5.2 Dashboard Views

#### Run List View (`/`)
```
┌─────────────────────────────────────────────────────┐
│  Distributed Hive                    [+ New Run]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Active Runs                                        │
│  ┌───────────────────────────────────────────────┐  │
│  │ ● Add OAuth login          3/5 stories done   │  │
│  │   service-a, service-b     2 agents active     │  │
│  │   Started 45 min ago       ~$2.30 est. cost    │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Recent Completed                                   │
│  ┌───────────────────────────────────────────────┐  │
│  │ ✓ Fix pagination bug       2/2 stories merged │  │
│  │   service-a                Completed 2h ago    │  │
│  │   Duration: 35 min         Cost: $0.85         │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

#### Live Run View (`/run/:id`)
```
┌─────────────────────────────────────────────────────┐
│  ← Back    Add OAuth login              [Cancel]    │
├──────────────────────┬──────────────────────────────┤
│  Stories             │  Activity Feed               │
│  ─────────           │  ────────────                │
│  ✓ STR-001 (3pts)   │  14:32 Senior started        │
│    Create OAuth flow │        STR-002               │
│    PR: #142 merged   │  14:30 Junior completed      │
│                      │        STR-001, PR #142      │
│  ● STR-002 (5pts)   │  14:28 QA approved PR #141   │
│    Add token refresh │  14:15 Tech Lead created     │
│    Agent: senior-1   │        5 stories             │
│                      │  14:14 Run started           │
│  ○ STR-003 (2pts)   │                              │
│    Add logout button │                              │
│    Waiting on STR-001│                              │
├──────────────────────┤                              │
│  Agents              │                              │
│  ──────              │                              │
│  🟢 tech-lead (done) │                              │
│  🟢 senior-1 (working)│                             │
│  🟡 junior-1 (waiting)│                             │
│  ⚪ qa-1 (idle)      │                              │
├──────────────────────┴──────────────────────────────┤
│  Escalations                                        │
│  ⚠ STR-004: "Ambiguous requirement - which OAuth    │
│    provider?" [Reply]                               │
└─────────────────────────────────────────────────────┘
```

#### Submit Run View (`/submit`)
```
┌─────────────────────────────────────────────────────┐
│  New Run                                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Requirement Title                                  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Add user authentication with OAuth2           │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Description                                        │
│  ┌───────────────────────────────────────────────┐  │
│  │ Implement OAuth2 login flow with GitHub as    │  │
│  │ the identity provider. Include token refresh, │  │
│  │ logout, and protected route middleware...     │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Repositories                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │ https://github.com/org/backend-api       [x]  │  │
│  │ https://github.com/org/frontend-app      [x]  │  │
│  │ [+ Add repository]                            │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ▸ Advanced Options                                 │
│    Model: Claude Opus 4.6                           │
│    Safety: Unsafe (auto-approve)                    │
│    Size: Medium (4 vCPU, 16GB)                      │
│                                                     │
│  [Submit Run]                                       │
└─────────────────────────────────────────────────────┘
```

### 5.3 WebSocket Integration

```typescript
// src/web/hooks/useRunUpdates.ts
function useRunUpdates(runId: string) {
  const ws = useRef<WebSocket>();

  useEffect(() => {
    ws.current = new WebSocket(`wss://api.distributed-hive.com/ws`);

    ws.current.onopen = () => {
      ws.current.send(JSON.stringify({
        action: "subscribe",
        runId
      }));
    };

    ws.current.onmessage = (event) => {
      const update = JSON.parse(event.data);
      switch (update.type) {
        case "story_update":
          updateStory(update.data);
          break;
        case "agent_update":
          updateAgent(update.data);
          break;
        case "escalation":
          showEscalation(update.data);
          break;
        case "run_complete":
          markComplete(update.data);
          break;
      }
    };

    return () => ws.current?.close();
  }, [runId]);
}
```

---

## 6. Security

### 6.1 IAM Roles

**ECS Task Execution Role** (`hive-execution-role`):
```json
{
  "Effect": "Allow",
  "Action": [
    "ecr:GetAuthorizationToken",
    "ecr:BatchGetImage",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "secretsmanager:GetSecretValue"
  ],
  "Resource": "*"
}
```

**ECS Task Role** (`hive-task-role`):
```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:GetItem",
    "dynamodb:Query",
    "events:PutEvents",
    "s3:PutObject",
    "s3:GetObject",
    "elasticfilesystem:ClientMount",
    "elasticfilesystem:ClientWrite"
  ],
  "Resource": [
    "arn:aws:dynamodb:*:*:table/distributed-hive-*",
    "arn:aws:events:*:*:event-bus/distributed-hive-*",
    "arn:aws:s3:::distributed-hive-*",
    "arn:aws:elasticfilesystem:*:*:file-system/fs-*"
  ]
}
```

**API Lambda Role** (`hive-api-role`):
```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:PutItem",
    "dynamodb:GetItem",
    "dynamodb:Query",
    "dynamodb:Scan",
    "sqs:SendMessage",
    "ecs:RunTask",
    "ecs:StopTask",
    "ecs:DescribeTasks",
    "execute-api:ManageConnections"
  ],
  "Resource": "*"
}
```

### 6.2 Network Security

```
VPC: distributed-hive-vpc (10.0.0.0/16)
├── Public Subnet (10.0.1.0/24)
│   └── NAT Gateway (for Fargate outbound internet)
├── Private Subnet (10.0.2.0/24)
│   └── ECS Fargate Tasks
│   └── EFS Mount Targets
└── Security Groups:
    ├── sg-fargate: Outbound 443 (HTTPS), 22 (git SSH)
    ├── sg-efs: Inbound 2049 (NFS) from sg-fargate
    └── sg-lambda: Outbound 443 (DynamoDB, API Gateway)
```

### 6.3 Secret Handling

- API keys never stored in DynamoDB or logs
- Secrets injected via ECS task definition `secrets` block
- Secrets Manager auto-rotation supported
- CloudWatch logs scrubbed of key patterns via subscription filter

### 6.4 Container Isolation

- Each run gets its own Fargate task (process and network isolation)
- EFS access scoped to `/runs/<runId>/` via IAM access points
- No cross-run filesystem access
- Container runs as non-root user

---

## 7. Cost Model

### 7.1 Fixed Monthly Costs (Always On)

| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| CloudFront | Standard distribution | $1 |
| S3 | Static website bucket | $0.50 |
| API Gateway | HTTP API + WebSocket | $1-3 |
| DynamoDB | On-demand, ~1GB storage | $1-5 |
| EFS | 10GB with IA lifecycle | $3-5 |
| Secrets Manager | 4 secrets | $1.60 |
| CloudWatch | Logs + metrics | $3-5 |
| NAT Gateway | Single AZ | $32 |
| ECR | Docker image storage | $1 |
| **Total fixed** | | **~$45-55/month** |

> **Note:** NAT Gateway is the largest fixed cost. For lower costs, use a NAT instance ($3-5/month) or VPC endpoints instead.

### 7.2 Per-Run Variable Costs

| Component | Rate | Typical Run | Heavy Run |
|-----------|------|-------------|-----------|
| Fargate (4 vCPU, 16GB) | $0.20/hour | $0.60 (3h) | $1.60 (8h) |
| DynamoDB writes | $1.25/million | $0.01 | $0.05 |
| EventBridge events | $1/million | $0.001 | $0.01 |
| CloudWatch logs | $0.50/GB | $0.05 | $0.20 |
| EFS storage | $0.30/GB-month | $0.03 | $0.10 |
| **Total per run** | | **~$0.70** | **~$2.00** |

### 7.3 LLM API Costs (Dominant, Same Whether Local or Cloud)

| Model | Input | Output | Typical Story Cost |
|-------|-------|--------|-------------------|
| Claude Opus 4.6 | $15/M tokens | $75/M tokens | $5-30 |
| Claude Sonnet 4.6 | $3/M tokens | $15/M tokens | $1-5 |
| Claude Haiku 4.5 | $0.80/M tokens | $4/M tokens | $0.20-1 |
| GPT-5.2 Codex | $2/M tokens | $8/M tokens | $0.50-3 |

### 7.4 Monthly Cost Projections

| Usage Level | Runs/Month | AWS Infra | LLM API | Total |
|-------------|-----------|-----------|---------|-------|
| Light | 5 | ~$50 | $25-75 | **$75-125** |
| Moderate | 20 | ~$60 | $100-300 | **$160-360** |
| Heavy | 50 | ~$85 | $250-750 | **$335-835** |

### 7.5 Cost Optimization Options

| Optimization | Savings | Trade-off |
|--------------|---------|-----------|
| Use Fargate Spot | 70% on compute | Tasks can be interrupted |
| Use NAT instance instead of NAT Gateway | ~$28/month | Manual management |
| Use Sonnet instead of Opus for juniors | 80% on junior LLM costs | Slightly lower quality |
| Cache repo clones on EFS | ~30% faster startup | Storage cost |
| DynamoDB reserved capacity | 50% on DynamoDB | Commitment |

---

## 8. Implementation Phases

### Phase 1: Container & Entrypoint (Week 1)
**Goal:** Run Hive in a Docker container that processes a requirement end-to-end.

**Deliverables:**
- [ ] Dockerfile with tmux, git, Claude CLI, Hive pre-installed
- [ ] Entrypoint script that initializes workspace, clones repos, runs Hive
- [ ] Docker Compose file for local testing
- [ ] Environment variable injection for API keys
- [ ] Test: submit a requirement locally in Docker, verify PRs are created

**Files:**
```
infra/
├── Dockerfile
├── entrypoint.sh
├── docker-compose.yml
└── docker-compose.test.yml
```

### Phase 2: State Sync Adapter (Week 2)
**Goal:** Mirror Hive's SQLite state to DynamoDB in real-time.

**Deliverables:**
- [ ] State sync adapter (TypeScript, runs as sidecar process)
- [ ] DynamoDB table creation (CloudFormation/CDK)
- [ ] EventBridge event bus + rules
- [ ] Inbound message relay (DynamoDB → SQLite)
- [ ] Run completion detection and cleanup
- [ ] Test: run Hive in Docker, verify state appears in DynamoDB

**Files:**
```
src/adapters/
├── state-sync.ts
├── dynamo-client.ts
├── event-emitter.ts
└── state-sync.test.ts
infra/cdk/
├── dynamo-stack.ts
└── eventbridge-stack.ts
```

### Phase 3: API Layer (Week 3)
**Goal:** REST API for submitting runs and querying state.

**Deliverables:**
- [ ] Lambda functions for all API endpoints
- [ ] API Gateway HTTP API configuration
- [ ] SQS queue for run requests
- [ ] Lambda consumer that launches Fargate tasks
- [ ] WebSocket API for real-time updates
- [ ] WebSocket broadcaster Lambda (EventBridge → connected clients)
- [ ] Test: submit run via API, verify Fargate task starts

**Files:**
```
src/api/
├── handlers/
│   ├── create-run.ts
│   ├── get-run.ts
│   ├── list-runs.ts
│   ├── cancel-run.ts
│   ├── get-stories.ts
│   ├── send-message.ts
│   └── ws-handler.ts
├── middleware/
│   ├── auth.ts
│   └── validation.ts
└── shared/
    ├── dynamo.ts
    └── types.ts
infra/cdk/
├── api-stack.ts
├── ecs-stack.ts
└── sqs-stack.ts
```

### Phase 4: Web Dashboard (Week 4-5)
**Goal:** Browser-based UI for managing runs.

**Deliverables:**
- [ ] React app with Vite + TypeScript + Tailwind
- [ ] Run list view with status indicators
- [ ] Submit run form with repo picker and config options
- [ ] Live run view with stories, agents, activity feed
- [ ] Escalation response UI
- [ ] WebSocket integration for real-time updates
- [ ] S3 + CloudFront deployment
- [ ] Test: full end-to-end flow from browser

**Files:**
```
web/
├── src/
│   ├── App.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── SubmitRun.tsx
│   │   ├── RunView.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── StoryList.tsx
│   │   ├── AgentStatus.tsx
│   │   ├── ActivityFeed.tsx
│   │   ├── EscalationPanel.tsx
│   │   └── CostTracker.tsx
│   ├── hooks/
│   │   ├── useRunUpdates.ts
│   │   └── useApi.ts
│   └── stores/
│       └── runStore.ts
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

### Phase 5: Infrastructure as Code (Week 5-6)
**Goal:** Fully automated deployment with CDK.

**Deliverables:**
- [ ] CDK app with all stacks (VPC, ECS, DynamoDB, API, S3/CloudFront)
- [ ] CI/CD pipeline (GitHub Actions → ECR push → CDK deploy)
- [ ] CloudWatch dashboards and alarms
- [ ] Cost alerts and budgets
- [ ] EFS cleanup Lambda (cron: delete old runs)
- [ ] Test: deploy from scratch to new AWS account

**Files:**
```
infra/cdk/
├── bin/app.ts
├── lib/
│   ├── vpc-stack.ts
│   ├── ecs-stack.ts
│   ├── api-stack.ts
│   ├── storage-stack.ts
│   ├── monitoring-stack.ts
│   └── frontend-stack.ts
├── cdk.json
└── tsconfig.json
.github/workflows/
├── deploy.yml
└── docker-build.yml
```

### Phase 6: Hardening & Multi-Tenancy (Week 6-7)
**Goal:** Production readiness.

**Deliverables:**
- [ ] Authentication (Cognito user pool or API key auth)
- [ ] Per-user secret isolation
- [ ] EFS access points per user
- [ ] Rate limiting and cost caps
- [ ] Fargate Spot integration with fallback to on-demand
- [ ] Graceful shutdown on Spot interruption
- [ ] Run timeout enforcement (max 24 hours)
- [ ] Error recovery: failed tasks auto-retry from EFS checkpoint
- [ ] Load testing: 10 concurrent runs

---

## 9. Failure Modes & Recovery

### 9.1 Fargate Task Crash

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| OOM kill | ECS task stopped event | Retry with larger memory tier |
| Claude CLI crash | Manager detects dead tmux session | Manager restarts agent with `--resume` |
| Network timeout | Git/API call fails | Agent retries (built into Hive) |
| Spot interruption | SIGTERM → 120s grace | Save state to EFS, retry on-demand |
| Unhandled exception | Process exit code ≠ 0 | SQS redelivers (up to 3 retries) |

### 9.2 State Sync Failure

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| DynamoDB throttle | SDK error | Exponential backoff (built-in) |
| Adapter crash | No heartbeat in DynamoDB | Entrypoint restarts adapter |
| Stale data | Dashboard shows old state | Manual refresh triggers full re-sync |

### 9.3 API Failures

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| Lambda timeout | API Gateway 504 | Client retry with backoff |
| WebSocket disconnect | Client heartbeat | Auto-reconnect + state catch-up |
| SQS message lost | DLQ monitoring | CloudWatch alarm, manual resubmit |

### 9.4 Data Loss Prevention

- EFS provides durable storage for in-progress work
- DynamoDB has point-in-time recovery enabled
- S3 stores completed run logs with versioning
- SQLite backup (.db.bak) mechanism preserved inside container

---

## 10. Future Enhancements (Post-MVP)

| Enhancement | Description | Complexity |
|-------------|-------------|------------|
| **GitHub App** | Install as GitHub App for automatic repo access | Medium |
| **Slack integration** | Notifications and escalation responses via Slack | Low |
| **Run templates** | Save and reuse requirement + config combinations | Low |
| **Cost budgets** | Set per-run or monthly LLM spending limits | Medium |
| **Agent streaming** | Stream agent terminal output to browser (ttyd-style) | High |
| **Multi-region** | Deploy to multiple regions for lower latency | High |
| **Custom models** | Support self-hosted LLMs (Bedrock, SageMaker) | Medium |
| **Run comparison** | Compare two runs (A/B testing different models) | Medium |
| **Webhook triggers** | Start runs from GitHub issues or Jira tickets | Low |
| **Team sharing** | Multiple users collaborate on same runs | High |

---

## 11. Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Keep Hive intact vs. rewrite | **Keep intact** | 90% less work; proven orchestration logic |
| SQLite vs. replace with RDS | **Keep SQLite + sync adapter** | No core changes needed; DynamoDB for reads |
| ECS Fargate vs. EC2 | **Fargate** | No server management; per-second billing |
| DynamoDB vs. RDS for state | **DynamoDB** | Serverless, pay-per-use, good for key-value reads |
| React vs. Next.js | **React (SPA)** | No SSR needed; simpler deployment to S3 |
| CDK vs. Terraform vs. SAM | **CDK** | TypeScript consistency; good ECS/Lambda support |
| WebSocket vs. polling | **WebSocket** | Real-time UX; minimal cost |
| Cognito vs. custom auth | **API key for v1** | Simpler; Cognito for multi-tenant later |
| NAT Gateway vs. NAT instance | **NAT Gateway** | Reliable; switch to NAT instance if cost matters |
| Single vs. multi container | **Single container** | Simpler; Hive expects all tools co-located |
