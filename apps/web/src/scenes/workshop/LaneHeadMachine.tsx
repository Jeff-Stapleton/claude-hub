import type { ActivityEntry } from '../../api.js';
import type { Project, TriggerRunStatus } from '../../types.js';
import { iso, isoBoxPoints, poly } from '../iso.js';
import { HEAD_D, HEAD_H, HEAD_W } from './layout.js';
import { Workstation } from './Workstation.jsx';

/**
 * The project's head machine at the left end of its lane: nameplate,
 * trigger-activity screen, session badge, and the remove button. Clicking
 * the body opens the lane's work-request intake form.
 */
export function LaneHeadMachine({
  project,
  x,
  y,
  variant,
  activity,
  anythingRunning,
  removing,
  onOpenIntake,
  onRemove,
}: {
  project: Project;
  x: number;
  y: number;
  variant: number;
  /** Recent trigger runs for this project (drives the screen color). */
  activity: ActivityEntry[];
  anythingRunning: boolean;
  removing: boolean;
  onOpenIntake: () => void;
  onRemove: () => void;
}): JSX.Element {
  const palette = palettes[variant % palettes.length]!;
  const latest = activity[0]?.run.status;
  const active = latest === 'running' || anythingRunning;
  const label = project.alias ?? basename(project.path);
  const sessionCount = project.agentSessions.reduce((sum, session) => sum + session.sessionCount, 0);
  const { topFace, rightFace, leftFace } = isoBoxPoints(x, y, HEAD_W, HEAD_D, HEAD_H);

  return (
    <Workstation label={`${label} — new work request`} onActivate={onOpenIntake}>
      <g style={active ? machinePulseStyle : undefined}>
        <polygon points={poly(...leftFace)} fill={palette.left} stroke="#15100c" strokeWidth={1} />
        <polygon points={poly(...rightFace)} fill={palette.right} stroke="#15100c" strokeWidth={1} />
        <polygon points={poly(...topFace)} fill={palette.top} stroke="#15100c" strokeWidth={1.4} />

        <MachineScreen x={x} y={y} width={HEAD_W} height={HEAD_H} status={latest} />
        <MachineLabel x={x + HEAD_W / 2} y={y + HEAD_D / 2} z={HEAD_H + 0.45} label={label} />
        <SessionBadge x={x + HEAD_W - 0.2} y={y + HEAD_D - 0.1} z={HEAD_H + 0.1} count={sessionCount} />
        <RemoveButton
          x={x + HEAD_W - 0.1}
          y={y - 0.05}
          z={HEAD_H + 0.35}
          label={label}
          disabled={removing}
          onRemove={onRemove}
        />
      </g>
    </Workstation>
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
