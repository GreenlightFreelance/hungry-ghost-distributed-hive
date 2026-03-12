import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Story } from '../types';

const statusColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  draft:       { bg: '#374151', border: '#4b5563', text: '#9ca3af', glow: 'none' },
  estimated:   { bg: '#374151', border: '#4b5563', text: '#9ca3af', glow: 'none' },
  planned:     { bg: '#1e293b', border: '#475569', text: '#cbd5e1', glow: 'none' },
  todo:        { bg: '#1e293b', border: '#475569', text: '#cbd5e1', glow: 'none' },
  in_progress: { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd', glow: '0 0 12px rgba(59,130,246,0.3)' },
  review:      { bg: '#422006', border: '#f59e0b', text: '#fcd34d', glow: '0 0 12px rgba(245,158,11,0.3)' },
  qa:          { bg: '#422006', border: '#f59e0b', text: '#fcd34d', glow: '0 0 12px rgba(245,158,11,0.3)' },
  qa_failed:   { bg: '#450a0a', border: '#ef4444', text: '#fca5a5', glow: '0 0 12px rgba(239,68,68,0.3)' },
  pr_submitted:{ bg: '#2e1065', border: '#a855f7', text: '#d8b4fe', glow: '0 0 12px rgba(168,85,247,0.3)' },
  merged:      { bg: '#052e16', border: '#22c55e', text: '#86efac', glow: '0 0 12px rgba(34,197,94,0.3)' },
  done:        { bg: '#052e16', border: '#22c55e', text: '#86efac', glow: '0 0 12px rgba(34,197,94,0.3)' },
};

const statusLabels: Record<string, string> = {
  draft: 'Draft', estimated: 'Estimated', planned: 'Planned', todo: 'To Do',
  in_progress: 'In Progress', review: 'Review', qa: 'QA', qa_failed: 'QA Failed',
  pr_submitted: 'PR Submitted', merged: 'Merged', done: 'Done',
};

interface StoryNodeData {
  story: Story;
  [key: string]: unknown;
}

function StoryNode({ data }: { data: StoryNodeData }) {
  const story = data.story;
  const colors = statusColors[story.status] ?? statusColors.draft!;

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: colors.border, border: 'none', width: 8, height: 8 }} />
      <div
        style={{
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          borderRadius: 12,
          padding: '12px 16px',
          minWidth: 200,
          maxWidth: 260,
          boxShadow: colors.glow,
          transition: 'box-shadow 0.3s, border-color 0.3s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#6b7280', letterSpacing: '0.02em' }}>
            {story.id}
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: colors.text,
              background: `${colors.border}33`,
              padding: '2px 8px',
              borderRadius: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {statusLabels[story.status] || story.status}
          </span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', lineHeight: 1.3, marginBottom: 8 }}>
          {story.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10 }}>
          {story.points != null && (
            <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {story.points} pts
            </span>
          )}
          {story.assignedAgentId && (
            <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
              {story.assignedAgentId}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: colors.border, border: 'none', width: 8, height: 8 }} />
    </>
  );
}

const nodeTypes: NodeTypes = {
  story: StoryNode as unknown as NodeTypes['story'],
};

function layoutNodes(stories: Story[]): { nodes: Node[]; edges: Edge[] } {
  const storyMap = new Map(stories.map(s => [s.id, s]));

  // Build adjacency: who depends on whom
  const dependents = new Map<string, string[]>(); // storyId -> stories that depend on it
  const dependsOn = new Map<string, string[]>();   // storyId -> stories it depends on

  for (const story of stories) {
    const deps = story.dependencies || [];
    dependsOn.set(story.id, deps);
    for (const dep of deps) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(story.id);
    }
  }

  // Topological layering using Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const s of stories) inDegree.set(s.id, (dependsOn.get(s.id) || []).length);

  const layers: string[][] = [];
  let queue = stories.filter(s => (inDegree.get(s.id) || 0) === 0).map(s => s.id);
  const visited = new Set<string>();

  while (queue.length > 0) {
    layers.push([...queue]);
    const nextQueue: string[] = [];
    for (const id of queue) {
      visited.add(id);
      for (const dep of (dependents.get(id) || [])) {
        const newDeg = (inDegree.get(dep) || 1) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0 && !visited.has(dep)) nextQueue.push(dep);
      }
    }
    queue = nextQueue;
  }

  // Add any remaining stories not in layers (circular deps or orphans)
  for (const s of stories) {
    if (!visited.has(s.id)) {
      if (layers.length === 0) layers.push([]);
      layers[layers.length - 1]!.push(s.id);
    }
  }

  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 100;
  const X_GAP = 80;
  const Y_GAP = 30;

  const nodes: Node[] = [];
  for (let col = 0; col < layers.length; col++) {
    const layer = layers[col]!;
    const totalHeight = layer.length * NODE_HEIGHT + (layer.length - 1) * Y_GAP;
    const startY = -totalHeight / 2;

    for (let row = 0; row < layer.length; row++) {
      const storyId = layer[row]!;
      const story = storyMap.get(storyId);
      if (!story) continue;

      nodes.push({
        id: storyId,
        type: 'story',
        position: {
          x: col * (NODE_WIDTH + X_GAP),
          y: startY + row * (NODE_HEIGHT + Y_GAP),
        },
        data: { story },
      });
    }
  }

  const edges: Edge[] = [];
  for (const story of stories) {
    for (const dep of (story.dependencies || [])) {
      if (storyMap.has(dep)) {
        const depStory = storyMap.get(dep)!;
        const depDone = depStory.status === 'merged' || depStory.status === 'done';
        edges.push({
          id: `${dep}->${story.id}`,
          source: dep,
          target: story.id,
          animated: !depDone,
          style: {
            stroke: depDone ? '#22c55e' : '#6b7280',
            strokeWidth: 2,
          },
        });
      }
    }
  }

  return { nodes, edges };
}

interface DependencyGraphProps {
  stories: Story[];
}

export function DependencyGraph({ stories }: DependencyGraphProps) {
  const hasDependencies = stories.some(s => s.dependencies && s.dependencies.length > 0);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutNodes(stories),
    [stories]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onInit = useCallback((instance: { fitView: () => void }) => {
    setTimeout(() => instance.fitView(), 50);
  }, []);

  if (stories.length === 0) {
    return (
      <div className="card rounded-xl border p-8 text-center">
        <p className="text-muted text-sm">No stories to visualize.</p>
      </div>
    );
  }

  if (!hasDependencies && stories.length <= 1) {
    return (
      <div className="card rounded-xl border p-6 text-center">
        <p className="text-muted text-sm">No dependencies between stories.</p>
      </div>
    );
  }

  return (
    <div className="card rounded-xl border overflow-hidden" style={{ height: Math.min(500, Math.max(300, stories.length * 80 + 100)) }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'var(--color-page-bg)' }}
      >
        <Background color="var(--color-card-border)" gap={20} size={1} />
        <Controls
          showInteractive={false}
          style={{
            background: 'var(--color-card)',
            borderColor: 'var(--color-card-border)',
            borderRadius: 8,
          }}
        />
      </ReactFlow>
    </div>
  );
}
