import type { BuiltinMachineSlug, PipelineMachine, StageRunStatus } from '../../types.js';
import { UNIT_Z, iso, isoBoxPoints, poly } from '../iso.js';
import {
  BELT_H,
  MACHINE_BELT_OFFSET,
  SLOT_D,
  SLOT_W,
  TUNNEL_CLEAR,
  TUNNEL_H,
  machineLabel,
} from './layout.js';
import { Workstation } from './Workstation.jsx';

/** Per-built-in silhouette: height + palette + topper so each machine reads. */
const VARIANTS: Record<
  BuiltinMachineSlug,
  { h: number; top: string; right: string; left: string }
> = {
  intake: { h: 1.15, top: '#6b5535', right: '#554026', left: '#3b2b1b' },
  spec: { h: 1.25, top: '#4f5f63', right: '#3d4a4e', left: '#2a3438' },
  code: { h: 1.45, top: '#65464b', right: '#51363a', left: '#39262a' },
  test: { h: 1.35, top: '#4f6350', right: '#3d4e3f', left: '#2a382c' },
  deploy: { h: 1.55, top: '#5f5563', right: '#4a424e', left: '#343038' },
  monitor: { h: 1.3, top: '#535f4a', right: '#414a3a', left: '#2d3428' },
};

/** Which built-in template (if any) a machine was stamped from. */
function builtinSlug(machine: PipelineMachine): BuiltinMachineSlug | undefined {
  const slug = machine.templateId?.replace(/^builtin-/, '');
  return machine.templateId?.startsWith('builtin-') && slug && slug in VARIANTS
    ? (slug as BuiltinMachineSlug)
    : undefined;
}

function hashKey(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Deterministic silhouette for custom machines: a muted hue keyed off the
 * machine key, height inside the built-in range, so every custom machine
 * is stable frame-to-frame and distinct from its neighbors while staying
 * inside the scene's low-saturation palette.
 */
function customVariant(key: string): { h: number; top: string; right: string; left: string } {
  const h = hashKey(key);
  const hue = h % 360;
  const height = 1.2 + ((h >>> 9) % 5) * 0.08;
  const c = (l: number): string => `hsl(${hue} 18% ${l}%)`;
  return { h: height, top: c(30), right: c(24), left: c(17) };
}

/**
 * One installed machine on a project's lane, parameterized by world
 * position. The machine straddles the belt: a tunnel mouth is cut into its
 * -X face where the belt enters, and the belt re-emerges past the +X face
 * (hidden from the viewer), so work visibly goes in one side and comes out
 * the other. The whole body is a Workstation hotspot — clicking opens the
 * machine's config panel. The lamp above the screen reflects live activity.
 */
export function Machine({
  machine,
  x,
  y,
  activity,
  selected,
  onSelect,
}: {
  machine: PipelineMachine;
  x: number;
  y: number;
  /** Live status of this machine across the project's work items. */
  activity: StageRunStatus | undefined;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const slug = builtinSlug(machine);
  const variant = slug ? VARIANTS[slug] : customVariant(machine.key);
  const running = activity === 'running';
  const { topFace, rightFace, leftFace } = isoBoxPoints(x, y, SLOT_W, SLOT_D, variant.h);

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

  // Tunnel mouth on the -X face: a dark opening spanning the belt's depth,
  // with a short throat of belt surface visible just inside it.
  const mouthLo = y + MACHINE_BELT_OFFSET - TUNNEL_CLEAR;
  const mouthHi = y + SLOT_D - MACHINE_BELT_OFFSET + TUNNEL_CLEAR;
  const mouth = [
    iso(x, mouthLo, 0),
    iso(x, mouthHi, 0),
    iso(x, mouthHi, TUNNEL_H),
    iso(x, mouthLo, TUNNEL_H),
  ];
  const throat = [
    iso(x, y + MACHINE_BELT_OFFSET, BELT_H),
    iso(x, y + SLOT_D - MACHINE_BELT_OFFSET, BELT_H),
    iso(x + TUNNEL_CLEAR, y + SLOT_D - MACHINE_BELT_OFFSET, BELT_H),
    iso(x + TUNNEL_CLEAR, y + MACHINE_BELT_OFFSET, BELT_H),
  ];

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
    <Workstation label={`${machine.name} machine — configure`} onActivate={onSelect}>
      <g
        style={{
          filter: selected ? 'drop-shadow(0 0 10px rgba(255, 210, 138, 0.9))' : undefined,
        }}
      >
        <g style={running ? { animation: 'workshop-pulse 1.2s ease-in-out infinite' } : undefined}>
          <polygon points={poly(...leftFace)} fill={variant.left} stroke="#15100c" strokeWidth={1} />
          <polygon points={poly(...rightFace)} fill={variant.right} stroke="#15100c" strokeWidth={1} />
          <polygon points={poly(...topFace)} fill={variant.top} stroke="#15100c" strokeWidth={1.4} />
          <polygon points={poly(...mouth)} fill="#0b0908" stroke="#1c150e" strokeWidth={1} />
          <polygon points={poly(...throat)} fill="#241f19" opacity={0.9} />
          <polygon
            points={poly(screen.a, screen.b, screen.c, screen.d)}
            fill={screenFill}
            stroke={screenStroke}
            strokeWidth={1}
          />
          <Topper slug={slug} machineKey={machine.key} x={x} y={y} h={variant.h} />
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
          {machineLabel(machine)}
        </text>
        {machine.gate === 'approval' ? (
          <text x={label.x} y={label.y + 14} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#b48ad6">
            gated
          </text>
        ) : null}
      </g>
    </Workstation>
  );
}

/** Small per-machine decoration so the machines aren't identical boxes. */
function Topper({
  slug,
  machineKey,
  x,
  y,
  h,
}: {
  slug: BuiltinMachineSlug | undefined;
  machineKey: string;
  x: number;
  y: number;
  h: number;
}): JSX.Element {
  const cx = x + SLOT_W / 2;
  const cy = y + SLOT_D / 2;
  switch (slug) {
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
    case 'spec':
    case 'code':
      return <></>;
    default: {
      // Custom machines: a deterministic small decoration by key hash so
      // they read as distinct without a bespoke variant.
      const pick = hashKey(machineKey) % 3;
      if (pick === 0) {
        // Vent box.
        const vent = isoBoxPoints(cx - 0.25, cy - 0.2, 0.5, 0.4, 0.18);
        return (
          <g transform={`translate(0, ${-h * UNIT_Z})`} opacity={0.9}>
            <polygon points={poly(...vent.leftFace)} fill="#2a2420" stroke="#15100c" strokeWidth={0.8} />
            <polygon points={poly(...vent.rightFace)} fill="#3a322c" stroke="#15100c" strokeWidth={0.8} />
            <polygon points={poly(...vent.topFace)} fill="#1c1814" stroke="#15100c" strokeWidth={0.8} />
          </g>
        );
      }
      if (pick === 1) {
        // Short antenna.
        const base = iso(cx + 0.2, cy, h);
        const top = iso(cx + 0.2, cy, h + 0.4);
        return (
          <g>
            <line x1={base.x} y1={base.y} x2={top.x} y2={top.y} stroke="#8a7458" strokeWidth={2} />
            <circle cx={top.x} cy={top.y} r={2.4} fill="#c8a888" />
          </g>
        );
      }
      return <></>;
    }
  }
}
