import type { Project } from '../../types.js';
import { iso, isoBoxPoints, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

const MAX_VISIBLE_TOOLS = 6;

/**
 * Front-left of floor: a long workbench. Each registered project is a
 * small wooden block sitting on the bench top. Above 6, an overflow
 * badge sticks up on the right end.
 *
 * Footprint: world (1, 1.3) to (5.5, 2.6) — runs along the +X axis, so
 * the bench's long dimension reads as left-to-right on screen.
 */
export function ProjectsBench({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: () => void;
}): JSX.Element {
  const n = projects.length;
  const visible = Math.min(n, MAX_VISIBLE_TOOLS);
  const overflow = n - visible;

  // Bench dimensions in world units.
  const bx = 1.0;
  const by = 1.3;
  const bw = 4.5;
  const bd = 1.3;
  const bh = 0.9;

  const { topFace, rightFace, leftFace } = isoBoxPoints(bx, by, bw, bd, bh);

  return (
    <Workstation
      label={`Projects bench (${n} ${n === 1 ? 'project' : 'projects'})`}
      onActivate={onOpen}
    >
      {/* Bench legs as 4 thin posts at the corners (drawn first so the
          bench top renders over them). */}
      {[
        [bx + 0.05, by + 0.05],
        [bx + bw - 0.15, by + 0.05],
        [bx + 0.05, by + bd - 0.15],
        [bx + bw - 0.15, by + bd - 0.15],
      ].map(([lx, ly], i) => {
        const leg = isoBoxPoints(lx ?? 0, ly ?? 0, 0.1, 0.1, bh);
        return (
          <g key={i}>
            <polygon points={poly(...leg.leftFace)} fill="#2a1a0e" />
            <polygon points={poly(...leg.rightFace)} fill="#3a2818" />
          </g>
        );
      })}
      {/* Bench faces */}
      <polygon points={poly(...leftFace)} fill="#34241a" stroke="#1a110a" strokeWidth={1} />
      <polygon points={poly(...rightFace)} fill="#4a3020" stroke="#1a110a" strokeWidth={1} />
      <polygon points={poly(...topFace)} fill="#5a3a22" stroke="#1a110a" strokeWidth={1.5} />

      {/* Wood grain stripe across the bench top */}
      {[0.4, 0.9].map((dy) => {
        const a = iso(bx + 0.15, by + dy, bh);
        const b = iso(bx + bw - 0.15, by + dy, bh);
        return (
          <line
            key={dy}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#3e2716"
            strokeWidth={0.8}
            opacity={0.7}
          />
        );
      })}

      {/* Tools sitting on the bench */}
      {Array.from({ length: visible }, (_, i) => {
        const slot = bw / MAX_VISIBLE_TOOLS;
        const cx = bx + slot * (i + 0.5) - 0.18;
        const cy = by + 0.55;
        return <Tool key={i} x={cx} y={cy} variant={i % 3} baseHeight={bh} />;
      })}

      {/* Overflow badge floating above the right end of the bench */}
      {overflow > 0 ? (
        (() => {
          const c = iso(bx + bw - 0.3, by + 0.5, bh + 0.9);
          return (
            <g>
              <circle cx={c.x} cy={c.y} r={16} fill="#c8a25a" stroke="#1a110a" strokeWidth={1.5} />
              <text x={c.x} y={c.y + 5} textAnchor="middle" fontSize={13} fontWeight={600} fill="#2a1a0c">
                +{overflow}
              </text>
            </g>
          );
        })()
      ) : null}

      {/* Empty state */}
      {n === 0 ? (
        (() => {
          const c = iso(bx + bw / 2, by + bd / 2, bh + 0.6);
          return (
            <text
              x={c.x}
              y={c.y}
              textAnchor="middle"
              fontSize={13}
              fill="#c8a888"
              opacity={0.7}
              fontStyle="italic"
            >
              (no tools — add a project)
            </text>
          );
        })()
      ) : null}
    </Workstation>
  );
}

function Tool({
  x,
  y,
  variant,
  baseHeight,
}: {
  x: number;
  y: number;
  variant: number;
  baseHeight: number;
}): JSX.Element {
  // A tool is a tiny isometric block. Three palette variants so the bench
  // reads as varied. Phase 4 swaps in real pixel-art sprites.
  const palettes = [
    { top: '#a8843e', right: '#86692c', left: '#5e4a1e' }, // brass
    { top: '#8a8a8a', right: '#6a6a6a', left: '#4a4a4a' }, // steel
    { top: '#cf6a2c', right: '#a85420', left: '#7a3814' }, // copper
  ];
  const p = palettes[variant % palettes.length]!;
  const w = 0.35;
  const d = 0.22;
  const h = 0.3;
  const b = isoBoxPoints(x, y, w, d, h);
  // Lift to bench top
  const lift = baseHeight;
  const shift = (face: { x: number; y: number }[]): { x: number; y: number }[] =>
    face.map((pt) => ({ x: pt.x, y: pt.y - lift * 58 }));
  return (
    <g>
      <polygon points={poly(...shift(b.leftFace))} fill={p.left} stroke="#1a110a" strokeWidth={0.6} />
      <polygon points={poly(...shift(b.rightFace))} fill={p.right} stroke="#1a110a" strokeWidth={0.6} />
      <polygon points={poly(...shift(b.topFace))} fill={p.top} stroke="#1a110a" strokeWidth={0.6} />
    </g>
  );
}
