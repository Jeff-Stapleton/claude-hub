import type { PipelineStageId, StageConfig, StageRunStatus } from '../../types.js';
import { UNIT_Z, iso, isoBoxPoints, poly } from '../iso.js';
import { SLOT_D, SLOT_W, STAGE_META } from './layout.js';
import { Workstation } from './Workstation.jsx';

/** Per-stage silhouette: height + palette + topper so each machine reads. */
const VARIANTS: Record<
  PipelineStageId,
  { h: number; top: string; right: string; left: string }
> = {
  intake: { h: 1.15, top: '#6b5535', right: '#554026', left: '#3b2b1b' },
  spec: { h: 1.25, top: '#4f5f63', right: '#3d4a4e', left: '#2a3438' },
  code: { h: 1.45, top: '#65464b', right: '#51363a', left: '#39262a' },
  test: { h: 1.35, top: '#4f6350', right: '#3d4e3f', left: '#2a382c' },
  deploy: { h: 1.55, top: '#5f5563', right: '#4a424e', left: '#343038' },
  monitor: { h: 1.3, top: '#535f4a', right: '#414a3a', left: '#2d3428' },
};

/**
 * One installed stage machine on a project's lane, parameterized by world
 * position. The whole body is a Workstation hotspot — clicking opens the
 * stage's config panel. The lamp above the screen reflects live activity.
 */
export function StageMachine({
  stage,
  x,
  y,
  config,
  activity,
  selected,
  onSelect,
}: {
  stage: PipelineStageId;
  x: number;
  y: number;
  config: StageConfig;
  /** Live status of this stage across the project's work items. */
  activity: StageRunStatus | undefined;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const variant = VARIANTS[stage];
  const { topFace, rightFace, leftFace } = isoBoxPoints(x, y, SLOT_W, SLOT_D, variant.h);
  const meta = STAGE_META[stage];
  const running = activity === 'running';

  const screen = {
    a: iso(x + 0.16, y, variant.h * 0.5),
    b: iso(x + SLOT_W - 0.16, y, variant.h * 0.5),
    c: iso(x + SLOT_W - 0.16, y, variant.h * 0.82),
    d: iso(x + 0.16, y, variant.h * 0.82),
  };
  const screenFill =
    activity === 'running' ? '#2f2a10' : activity === 'failed' ? '#321010' : '#102018';
  const screenStroke =
    activity === 'running'
      ? '#e8b04a'
      : activity === 'failed'
        ? '#cf4040'
        : activity === 'waiting-approval'
          ? '#b48ad6'
          : '#5ec27a';

  const lamp = iso(x + SLOT_W / 2, y + SLOT_D / 2, variant.h + 0.16);
  const label = iso(x + SLOT_W / 2, y + SLOT_D / 2, variant.h + 0.5);
  const lampFill =
    activity === 'running'
      ? '#e8b04a'
      : activity === 'failed'
        ? '#cf4040'
        : activity === 'waiting-approval'
          ? '#b48ad6'
          : activity === 'success'
            ? '#5ec27a'
            : '#3a3128';

  return (
    <Workstation label={`${meta.label} station — configure`} onActivate={onSelect}>
      <g
        style={{
          filter: selected ? 'drop-shadow(0 0 10px rgba(255, 210, 138, 0.9))' : undefined,
        }}
      >
        <g style={running ? { animation: 'workshop-pulse 1.2s ease-in-out infinite' } : undefined}>
          <polygon points={poly(...leftFace)} fill={variant.left} stroke="#15100c" strokeWidth={1} />
          <polygon points={poly(...rightFace)} fill={variant.right} stroke="#15100c" strokeWidth={1} />
          <polygon points={poly(...topFace)} fill={variant.top} stroke="#15100c" strokeWidth={1.4} />
          <polygon
            points={poly(screen.a, screen.b, screen.c, screen.d)}
            fill={screenFill}
            stroke={screenStroke}
            strokeWidth={1}
          />
          <Topper stage={stage} x={x} y={y} h={variant.h} />
        </g>
        <circle
          cx={lamp.x}
          cy={lamp.y}
          r={5}
          fill={lampFill}
          stroke="#15100c"
          strokeWidth={1}
          style={
            activity === 'running' || activity === 'waiting-approval'
              ? { animation: 'workshop-led 1.1s ease-in-out infinite' }
              : undefined
          }
        />
        <text x={label.x} y={label.y} textAnchor="middle" fontSize={11} fontFamily="monospace" fill="#ead6b8">
          {meta.label}
        </text>
        {config.gate === 'approval' ? (
          <text x={label.x} y={label.y + 14} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#b48ad6">
            gated
          </text>
        ) : null}
      </g>
    </Workstation>
  );
}

/** Small per-stage decoration so the six machines aren't identical boxes. */
function Topper({ stage, x, y, h }: { stage: PipelineStageId; x: number; y: number; h: number }): JSX.Element {
  const cx = x + SLOT_W / 2;
  const cy = y + SLOT_D / 2;
  switch (stage) {
    case 'intake': {
      // Hopper: a small open bin on top. isoBoxPoints projects at floor
      // level; raising world z by h is exactly a -h·UNIT_Z screen shift.
      const rim = isoBoxPoints(cx - 0.3, cy - 0.25, 0.6, 0.5, 0.22);
      return (
        <g transform={`translate(0, ${-h * UNIT_Z})`} opacity={0.95}>
          <polygon points={poly(...rim.leftFace)} fill="#3b2b1b" stroke="#15100c" strokeWidth={0.8} />
          <polygon points={poly(...rim.rightFace)} fill="#554026" stroke="#15100c" strokeWidth={0.8} />
          <polygon points={poly(...rim.topFace)} fill="#20180f" stroke="#15100c" strokeWidth={0.8} />
        </g>
      );
    }
    case 'test': {
      // Scanner arch over the front edge.
      const a = iso(x + 0.2, y - 0.05, h);
      const b = iso(x + 0.2, y - 0.05, h + 0.35);
      const c = iso(x + SLOT_W - 0.2, y - 0.05, h + 0.35);
      const d = iso(x + SLOT_W - 0.2, y - 0.05, h);
      return (
        <g>
          <polyline
            points={poly(a, b, c, d)}
            fill="none"
            stroke="#5ec27a"
            strokeWidth={2}
            opacity={0.75}
          />
        </g>
      );
    }
    case 'deploy': {
      // Chimney stack.
      const stack = isoBoxPoints(x + SLOT_W - 0.45, cy - 0.15, 0.3, 0.3, 0.45);
      return (
        <g transform={`translate(0, ${-h * UNIT_Z})`}>
          <polygon points={poly(...stack.leftFace)} fill="#343038" stroke="#15100c" strokeWidth={0.8} />
          <polygon points={poly(...stack.rightFace)} fill="#4a424e" stroke="#15100c" strokeWidth={0.8} />
          <polygon points={poly(...stack.topFace)} fill="#1a1720" stroke="#15100c" strokeWidth={0.8} />
        </g>
      );
    }
    case 'monitor': {
      // Radar mast + dish.
      const base = iso(cx, cy, h);
      const top = iso(cx, cy, h + 0.55);
      return (
        <g>
          <line x1={base.x} y1={base.y} x2={top.x} y2={top.y} stroke="#8a7458" strokeWidth={2} />
          <circle cx={top.x} cy={top.y} r={7} fill="none" stroke="#5ec27a" strokeWidth={1.6} opacity={0.85} />
          <circle cx={top.x} cy={top.y} r={2.2} fill="#5ec27a" />
        </g>
      );
    }
    default:
      return <></>;
  }
}
