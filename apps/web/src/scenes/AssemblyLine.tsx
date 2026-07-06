import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import type {
  PipelineStageId,
  StageConfig,
  StageRunStatus,
  UIState,
  WorkItem,
} from '../types.js';
import { PIPELINE_STAGE_ORDER } from '../types.js';
import { iso } from './iso.js';
import type { SceneId } from './useSceneRouter.js';
import { Workstation } from './workshop/Workstation.jsx';
import { Belt } from './line/Belt.jsx';
import { GateArch } from './line/GateArch.jsx';
import { defaultPipeline, STAGE_META } from './line/layout.js';
import { LineRoom } from './line/LineRoom.jsx';
import { RequestIntakeForm } from './line/RequestIntakeForm.jsx';
import { Station } from './line/Station.jsx';
import { StationConfigPanel } from './line/StationConfigPanel.jsx';
import { WorkItemBox } from './line/WorkItemBox.jsx';
import { WorkItemPanel } from './line/WorkItemPanel.jsx';

/**
 * Per-project assembly hall: the six pipeline stations along one long
 * belt, live work items gliding between them, and docked panels for
 * configuring stations, feeding the line, and approving held items.
 *
 * Scene geometry sits in a translated group so the long hall centers in
 * the 1600×900 stage; the HTML panels dock in the empty screen-left
 * region outside that transform.
 */
export function AssemblyLine({
  state,
  projectId,
  navigate,
}: {
  state: UIState;
  projectId: string;
  navigate: (s: SceneId, param?: string) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [selectedStage, setSelectedStage] = useState<PipelineStageId | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const project = state.projects.find((p) => p.id === projectId);
  const config =
    state.pipelines?.find((p) => p.projectId === projectId) ?? defaultPipeline(projectId);
  const items = (state.workItems ?? []).filter((it) => it.projectId === projectId);
  const selectedItem = items.find((it) => it.id === selectedItemId);

  const saveMutation = useMutation({
    mutationFn: (stages: Record<PipelineStageId, StageConfig>) =>
      api.savePipeline(projectId, { stages }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });
  const createMutation = useMutation({
    mutationFn: (body: { request: string; title?: string }) => api.createWorkItem(projectId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });
  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'retry' | 'cancel' }) =>
      action === 'approve'
        ? api.approveWorkItem(id)
        : action === 'retry'
          ? api.retryWorkItem(id)
          : api.cancelWorkItem(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  if (!project) {
    // The project can vanish underneath us (deleted in another tab; the WS
    // push removes it) — degrade to a friendly fallback instead of crashing.
    return (
      <svg viewBox="0 0 1600 900" style={svgStyle} role="img" aria-label="machine not found">
        <text x={800} y={430} textAnchor="middle" fontSize={16} fill="#c8a888">
          this machine was dismantled
        </text>
        <BackButton navigate={navigate} />
      </svg>
    );
  }

  const label = project.alias ?? basename(project.path);
  const stageActivity = deriveStageActivity(items);
  const anythingRunning = items.some((it) => it.status === 'running');

  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" style={svgStyle} role="img" aria-label={`${label} assembly line`}>
      <defs>
        <radialGradient id="lineLampGlow" cx="0.55" cy="0.4" r="0.6">
          <stop offset="0%" stopColor="#ffd28a" stopOpacity={0.2} />
          <stop offset="55%" stopColor="#ffd28a" stopOpacity={0.05} />
          <stop offset="100%" stopColor="#ffd28a" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="lineFloorShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a2818" />
          <stop offset="100%" stopColor="#241810" />
        </linearGradient>
      </defs>

      <g transform="translate(-40, 30)">
        <LineRoom />

        {/* Stations behind the belt; independent footprints, any order. */}
        {PIPELINE_STAGE_ORDER.map((stage) => (
          <Station
            key={stage}
            stage={stage}
            config={config.stages[stage]}
            activity={stageActivity[stage]}
            selected={selectedStage === stage}
            onSelect={() => {
              setSelectedItemId(null);
              setSelectedStage((current) => (current === stage ? null : stage));
            }}
          />
        ))}

        <Belt moving={anythingRunning} />

        {/* Approval gates across the belt, before the stages they guard. */}
        {PIPELINE_STAGE_ORDER.map((stage, i) =>
          config.stages[stage].gate === 'approval' && config.stages[stage].enabled ? (
            <GateArch
              key={stage}
              stageIndex={i}
              held={items.some((it) => it.status === 'waiting-approval' && it.currentStage === stage)}
            />
          ) : null,
        )}

        {items.map((item) => (
          <WorkItemBox
            key={item.id}
            item={item}
            selected={selectedItemId === item.id}
            onSelect={() => {
              setSelectedStage(null);
              setSelectedItemId((current) => (current === item.id ? null : item.id));
            }}
          />
        ))}

        {items.length === 0 ? (
          <text {...textAt(7, 1.4, 0.3)} textAnchor="middle" fontSize={13} fill="#c8a888" opacity={0.7} fontStyle="italic">
            the line is idle — feed it a work request
          </text>
        ) : null}
      </g>

      <text x={560} y={52} fontSize={18} fill="#f0d8b8" fontFamily="monospace">
        {label} — assembly line
      </text>
      <BackButton navigate={navigate} />

      {selectedStage ? (
        <StationConfigPanel
          key={selectedStage}
          stage={selectedStage}
          config={config.stages[selectedStage]}
          isPending={saveMutation.isPending}
          error={saveMutation.error}
          onSave={(next) => saveMutation.mutate({ ...config.stages, [selectedStage]: next })}
          onClose={() => setSelectedStage(null)}
        />
      ) : selectedItem ? (
        <WorkItemPanel
          item={selectedItem}
          isPending={actionMutation.isPending}
          error={actionMutation.error}
          onApprove={() => actionMutation.mutate({ id: selectedItem.id, action: 'approve' })}
          onRetry={() => actionMutation.mutate({ id: selectedItem.id, action: 'retry' })}
          onCancel={() => actionMutation.mutate({ id: selectedItem.id, action: 'cancel' })}
          onClose={() => setSelectedItemId(null)}
        />
      ) : (
        <HelpCard />
      )}

      <RequestIntakeForm
        isPending={createMutation.isPending}
        error={createMutation.error}
        onSubmit={(input) => createMutation.mutate(input)}
      />

      <rect x={0} y={0} width={1600} height={900} fill="url(#lineLampGlow)" pointerEvents="none" />
    </svg>
  );
}

/**
 * Aggregate per-stage status across the project's live items so a
 * station's screen/lamp reflects whatever is happening at it right now.
 * Priority: failure > held > running > recent success.
 */
function deriveStageActivity(items: WorkItem[]): Partial<Record<PipelineStageId, StageRunStatus>> {
  const activity: Partial<Record<PipelineStageId, StageRunStatus>> = {};
  const priority: Record<string, number> = { failed: 4, 'waiting-approval': 3, running: 2, success: 1 };
  for (const item of items) {
    for (const stage of PIPELINE_STAGE_ORDER) {
      let status = item.stages[stage]?.status;
      if (item.status === 'monitoring' && stage === 'monitor') status = 'running';
      if (!status || !(status in priority)) continue;
      const current = activity[stage];
      if (!current || priority[status]! > priority[current]!) activity[stage] = status;
    }
  }
  return activity;
}

function BackButton({ navigate }: { navigate: (s: SceneId) => void }): JSX.Element {
  return (
    <Workstation label="Back to workshop" onActivate={() => navigate('workshop')}>
      <rect x={28} y={28} rx={5} width={120} height={34} fill="#241810" stroke="#4a3624" strokeWidth={1} />
      <text x={88} y={50} textAnchor="middle" fontSize={13} fill="#c8a888">
        ← Workshop
      </text>
    </Workstation>
  );
}

function HelpCard(): JSX.Element {
  return (
    <foreignObject x={28} y={90} width={470} height={540}>
      <div style={helpCard}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#f0d8b8' }}>How this line works</div>
        <p style={helpText}>
          Requests enter on the left and ride the belt through each station:
          spec → code → test → deploy → monitor.
        </p>
        <p style={helpText}>
          <b>Click a station</b> to configure it — switch it on/off, set its
          prompt, provider, gate, and (for test/deploy/monitor) shell commands.
        </p>
        <p style={helpText}>
          <b>Click a box on the belt</b> to inspect a work item, approve it
          through a gate, retry a failure, or cancel it.
        </p>
        <p style={helpText}>
          Purple arches are approval gates. Items that pass monitoring exit
          through the SHIPPED chute; failed health checks file a defect back
          onto the line automatically.
        </p>
      </div>
    </foreignObject>
  );
}

function textAt(x: number, y: number, z: number): { x: number; y: number } {
  const p = iso(x, y, z);
  return { x: p.x, y: p.y };
}

function basename(path: string): string {
  const norm = path.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

const svgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

const helpCard: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: 14,
  border: '1px solid #2a1f17',
  borderRadius: 10,
  background: 'rgba(24, 16, 10, 0.6)',
  color: '#c8a888',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const helpText: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  margin: '4px 0',
};
