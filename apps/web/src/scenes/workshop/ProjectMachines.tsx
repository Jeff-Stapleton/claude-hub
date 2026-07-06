import type { ActivityEntry } from '../../api.js';
import type { Project, Trigger, TriggerRunStatus, WorkItem } from '../../types.js';
import { PIPELINE_STAGE_ORDER } from '../../types.js';
import { FLOOR, iso, isoBoxPoints, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

const MAX_PACKAGES_PER_BELT = 3;

export function ProjectMachines({
  projects,
  triggers,
  activity,
  workItems,
  onOpenTriggers,
  onOpenLine,
  onRemove,
  removingProjectId,
}: {
  projects: Project[];
  triggers: Trigger[];
  activity: ActivityEntry[];
  workItems: WorkItem[];
  onOpenTriggers: () => void;
  onOpenLine: (projectId: string) => void;
  onRemove: (projectId: string) => void;
  removingProjectId: string | undefined;
}): JSX.Element {
  if (projects.length === 0) {
    const c = iso(4.8, 4.4, 0.35);
    return (
      <g>
        <text
          x={c.x}
          y={c.y}
          textAnchor="middle"
          fontSize={13}
          fill="#c8a888"
          opacity={0.7}
          fontStyle="italic"
        >
          add a project to build its machine
        </text>
      </g>
    );
  }

  const triggerProjectById = new Map(triggers.map((trigger) => [trigger.id, trigger.projectId]));
  const activityByProject = new Map<string, ActivityEntry[]>();
  for (const entry of activity) {
    const projectId = triggerProjectById.get(entry.run.triggerId);
    if (!projectId) continue;
    const entries = activityByProject.get(projectId) ?? [];
    if (entries.length < MAX_PACKAGES_PER_BELT) {
      entries.push(entry);
      activityByProject.set(projectId, entries);
    }
  }

  const visibleProjects = projects.slice(0, 9);
  const placements = visibleProjects.map((project, index) => {
    const row = index % 3;
    const col = Math.floor(index / 3);
    return {
      project,
      x: 4.05 + col * 1.65,
      y: 2.6 + row * 1.55,
      index,
    };
  });
  const tunnelYs = Array.from(new Set(placements.map((placement) => placement.y + 0.18)));

  return (
    <g>
      {[...placements]
        .sort((a, b) => b.x + b.y - (a.x + a.y))
        .map(({ project, x, y, index }) => (
        <Machine
          key={project.id}
          project={project}
          x={x}
          y={y}
          variant={index}
          activity={activityByProject.get(project.id) ?? []}
          workItems={workItems.filter((item) => item.projectId === project.id)}
          onOpenLine={onOpenLine}
          onRemove={onRemove}
          removing={removingProjectId === project.id}
        />
      ))}
      {tunnelYs.map((y) => (
        <WorkRequestTunnel key={y} y={y} onOpen={onOpenTriggers} />
      ))}
      {projects.length > 9 ? <OverflowBadge count={projects.length - 9} /> : null}
    </g>
  );
}

function Machine({
  project,
  x,
  y,
  variant,
  activity,
  workItems,
  onOpenLine,
  onRemove,
  removing,
}: {
  project: Project;
  x: number;
  y: number;
  variant: number;
  activity: ActivityEntry[];
  workItems: WorkItem[];
  onOpenLine: (projectId: string) => void;
  onRemove: (projectId: string) => void;
  removing: boolean;
}): JSX.Element {
  const bw = 1.35;
  const bd = 1.0;
  const bh = 1.25;
  const palette = palettes[variant % palettes.length]!;
  const latest = activity[0]?.run.status;
  const active = latest === 'running' || workItems.some((item) => item.status === 'running');
  const label = project.alias ?? basename(project.path);
  const sessionCount = project.agentSessions.reduce((sum, session) => sum + session.sessionCount, 0);
  const { topFace, rightFace, leftFace } = isoBoxPoints(x, y, bw, bd, bh);
  const beltX = x + bw;
  const beltY = y + 0.18;
  const beltLength = FLOOR - beltX;

  return (
    <g>
      <Conveyor x={beltX} y={beltY} length={beltLength} activity={activity} />

      <Workstation label={`${label} assembly line`} onActivate={() => onOpenLine(project.id)}>
        <g style={active ? machinePulseStyle : undefined}>
          <polygon points={poly(...leftFace)} fill={palette.left} stroke="#15100c" strokeWidth={1} />
          <polygon points={poly(...rightFace)} fill={palette.right} stroke="#15100c" strokeWidth={1} />
          <polygon points={poly(...topFace)} fill={palette.top} stroke="#15100c" strokeWidth={1.4} />

          <MachineScreen x={x} y={y} width={bw} height={bh} status={latest} />
          <StageLightsStrip x={x} y={y} width={bw} height={bh} workItems={workItems} />
          <MachineLabel x={x + bw / 2} y={y + bd / 2} z={bh + 0.45} label={label} />
          <SessionBadge x={x + bw - 0.2} y={y + bd - 0.1} z={bh + 0.1} count={sessionCount} />
          <RemoveButton
            x={x + bw - 0.1}
            y={y - 0.05}
            z={bh + 0.35}
            label={label}
            disabled={removing}
            onRemove={() => onRemove(project.id)}
          />
        </g>
      </Workstation>
    </g>
  );
}

/**
 * Six LEDs on the machine's front face — one per pipeline stage — giving
 * an at-a-glance read of the project's assembly line from the main scene.
 */
function StageLightsStrip({
  x,
  y,
  width,
  height,
  workItems,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  workItems: WorkItem[];
}): JSX.Element {
  const step = (width - 0.36) / (PIPELINE_STAGE_ORDER.length - 1);
  return (
    <g>
      {PIPELINE_STAGE_ORDER.map((stage, i) => {
        const c = iso(x + 0.18 + i * step, y, height * 0.38);
        let fill = '#3a3128';
        let anim: string | undefined;
        for (const item of workItems) {
          if (item.currentStage !== stage && !(stage === 'monitor' && item.status === 'monitoring')) {
            continue;
          }
          if (item.status === 'failed') {
            fill = '#cf4040';
            anim = 'workshop-flash 0.9s ease-in-out infinite';
            break;
          }
          if (item.status === 'waiting-approval') {
            fill = '#b48ad6';
            anim = 'workshop-blink 1.2s steps(1) infinite';
          } else if (item.status === 'running' && fill === '#3a3128') {
            fill = '#e8b04a';
            anim = 'workshop-led 1.1s ease-in-out infinite';
          } else if (item.status === 'monitoring' && stage === 'monitor' && fill === '#3a3128') {
            fill = '#5ec27a';
            anim = 'workshop-led 1.6s ease-in-out infinite';
          }
        }
        return (
          <circle
            key={stage}
            cx={c.x}
            cy={c.y}
            r={2.6}
            fill={fill}
            stroke="#15100c"
            strokeWidth={0.6}
            style={anim ? { animation: anim } : undefined}
          />
        );
      })}
    </g>
  );
}

function Conveyor({
  x,
  y,
  length,
  activity,
}: {
  x: number;
  y: number;
  length: number;
  activity: ActivityEntry[];
}): JSX.Element {
  const belt = isoBoxPoints(x, y, length, 0.42, 0.18);
  const slats = Array.from({ length: Math.max(1, Math.floor(length / 0.38)) }, (_, i) => 0.18 + i * 0.38).filter(
    (offset) => offset < length - 0.1,
  );
  return (
    <g>
      <polygon points={poly(...belt.leftFace)} fill="#1f1f1f" stroke="#0d0d0d" strokeWidth={0.8} />
      <polygon points={poly(...belt.rightFace)} fill="#2a2a2a" stroke="#0d0d0d" strokeWidth={0.8} />
      <polygon points={poly(...belt.topFace)} fill="#34302a" stroke="#0d0d0d" strokeWidth={1} />
      {slats.map((offset) => {
        const a = iso(x + offset, y + 0.03, 0.2);
        const b = iso(x + offset, y + 0.39, 0.2);
        return <line key={offset} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#151515" strokeWidth={1.2} />;
      })}
      {activity.slice(0, MAX_PACKAGES_PER_BELT).map((entry, i) => (
        <Package
          key={entry.run.id}
          x={x + Math.min(length - 0.35, 0.18 + i * 0.34)}
          y={y + 0.1}
          status={entry.run.status}
        />
      ))}
    </g>
  );
}

function WorkRequestTunnel({
  y,
  onOpen,
}: {
  y: number;
  onOpen: () => void;
}): JSX.Element {
  const ys = y - 0.08;
  const ye = y + 0.5;
  const zs = 0.12;
  const ze = 0.82;
  const bottomLeft = iso(FLOOR, ys, zs);
  const bottomRight = iso(FLOOR, ye, zs);
  const topRight = iso(FLOOR, ye, ze);
  const topLeft = iso(FLOOR, ys, ze);
  const label = iso(FLOOR, (ys + ye) / 2, ze + 0.14);

  return (
    <Workstation label="Work request tunnel (open triggers)" onActivate={onOpen}>
      <polygon points={poly(bottomLeft, bottomRight, topRight, topLeft)} fill="#4a3020" stroke="#130c08" strokeWidth={1.4} />
      <polygon
        points={poly(
          iso(FLOOR, ys + 0.08, zs + 0.08),
          iso(FLOOR, ye - 0.08, zs + 0.08),
          iso(FLOOR, ye - 0.08, ze - 0.12),
          iso(FLOOR, ys + 0.08, ze - 0.12),
        )}
        fill="#090807"
        stroke="#0f0b08"
        strokeWidth={1}
      />
      <line
        x1={topLeft.x}
        y1={topLeft.y}
        x2={topRight.x}
        y2={topRight.y}
        stroke="#7a5635"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <text x={label.x} y={label.y} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#c8a888" opacity={0.8}>
        REQUESTS
      </text>
    </Workstation>
  );
}

function Package({
  x,
  y,
  status,
}: {
  x: number;
  y: number;
  status: TriggerRunStatus;
}): JSX.Element {
  const box = isoBoxPoints(x, y, 0.24, 0.2, 0.2);
  const fill = status === 'running' ? '#e8b04a' : status === 'error' ? '#9a4a40' : '#8a6840';
  return (
    <g style={status === 'running' ? packageSlideStyle : undefined}>
      <polygon points={poly(...box.leftFace)} fill="#4a3020" stroke="#1a110a" strokeWidth={0.5} />
      <polygon points={poly(...box.rightFace)} fill={fill} stroke="#1a110a" strokeWidth={0.5} />
      <polygon points={poly(...box.topFace)} fill="#c8a25a" stroke="#1a110a" strokeWidth={0.5} />
    </g>
  );
}

function MachineScreen({
  x,
  y,
  width,
  height,
  status,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  status: TriggerRunStatus | undefined;
}): JSX.Element {
  const a = iso(x + 0.18, y, height * 0.55);
  const b = iso(x + width - 0.18, y, height * 0.55);
  const c = iso(x + width - 0.18, y, height * 0.88);
  const d = iso(x + 0.18, y, height * 0.88);
  const fill = status === 'running' ? '#2f2a10' : status === 'error' ? '#321010' : '#102018';
  const stroke = status === 'running' ? '#e8b04a' : status === 'error' ? '#cf4040' : '#5ec27a';
  return <polygon points={poly(a, b, c, d)} fill={fill} stroke={stroke} strokeWidth={1} />;
}

function MachineLabel({
  x,
  y,
  z,
  label,
}: {
  x: number;
  y: number;
  z: number;
  label: string;
}): JSX.Element {
  const c = iso(x, y, z);
  return (
    <text x={c.x} y={c.y} textAnchor="middle" fontSize={10} fill="#ead6b8" fontFamily="monospace">
      {shorten(label, 12)}
    </text>
  );
}

function SessionBadge({
  x,
  y,
  z,
  count,
}: {
  x: number;
  y: number;
  z: number;
  count: number;
}): JSX.Element {
  if (count === 0) return <></>;
  const c = iso(x, y, z);
  return (
    <g>
      <circle cx={c.x} cy={c.y} r={10} fill="#c8a25a" stroke="#1a110a" strokeWidth={1} />
      <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#2a1a0c">
        {count}
      </text>
    </g>
  );
}

function RemoveButton({
  x,
  y,
  z,
  label,
  disabled,
  onRemove,
}: {
  x: number;
  y: number;
  z: number;
  label: string;
  disabled: boolean;
  onRemove: () => void;
}): JSX.Element {
  const c = iso(x, y, z);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Remove ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onRemove();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (!disabled) onRemove();
      }}
      style={{ cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.45 : 1 }}
    >
      <circle cx={c.x} cy={c.y} r={11} fill="#5a1f1f" stroke="#1a0a0a" strokeWidth={1.2} />
      <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#f2c0b8">
        x
      </text>
    </g>
  );
}

function OverflowBadge({ count }: { count: number }): JSX.Element {
  const c = iso(9.0, 7.4, 0.6);
  return (
    <g>
      <circle cx={c.x} cy={c.y} r={18} fill="#c8a25a" stroke="#1a110a" strokeWidth={1.5} />
      <text x={c.x} y={c.y + 5} textAnchor="middle" fontSize={12} fontWeight={700} fill="#2a1a0c">
        +{count}
      </text>
    </g>
  );
}

function basename(path: string): string {
  const norm = path.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function shorten(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

const palettes = [
  { top: '#6b5535', right: '#554026', left: '#3b2b1b' },
  { top: '#4f5f63', right: '#3d4a4e', left: '#2a3438' },
  { top: '#65464b', right: '#51363a', left: '#39262a' },
];

const machinePulseStyle: React.CSSProperties = {
  animation: 'workshop-pulse 1.2s ease-in-out infinite',
};

const packageSlideStyle: React.CSSProperties = {
  animation: 'workshop-package 1.4s ease-in-out infinite',
};
