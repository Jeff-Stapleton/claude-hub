import type { Project } from '../../types.js';
import { Workstation } from './Workstation.jsx';

const MAX_VISIBLE_TOOLS = 8;

/**
 * Foreground workbench. The bench surface holds up to 8 tool sprites,
 * one per registered project. Above 8, an "+N more" badge sits on the
 * end of the bench so the user knows there are more.
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

  // Bench plank dimensions.
  const benchX = 120;
  const benchY = 740;
  const benchW = 1360;
  const benchH = 100;

  return (
    <Workstation
      x={100}
      y={700}
      width={1400}
      height={170}
      label={`Projects bench (${n} ${n === 1 ? 'project' : 'projects'})`}
      onActivate={onOpen}
    >
      {/* Bench top */}
      <rect
        x={benchX}
        y={benchY}
        width={benchW}
        height={benchH}
        rx={4}
        fill="#5a3a22"
        stroke="#2e1c0e"
        strokeWidth={2}
      />
      {/* Wood grain hint */}
      <line
        x1={benchX + 20}
        y1={benchY + 30}
        x2={benchX + benchW - 20}
        y2={benchY + 30}
        stroke="#3e2716"
        strokeWidth={1}
        opacity={0.6}
      />
      <line
        x1={benchX + 20}
        y1={benchY + 70}
        x2={benchX + benchW - 20}
        y2={benchY + 70}
        stroke="#3e2716"
        strokeWidth={1}
        opacity={0.6}
      />
      {/* Bench legs */}
      <rect x={benchX + 20} y={benchY + benchH} width={20} height={30} fill="#3e2716" />
      <rect x={benchX + benchW - 40} y={benchY + benchH} width={20} height={30} fill="#3e2716" />

      {/* Tools laid out evenly along the bench. */}
      {Array.from({ length: visible }, (_, i) => {
        const slotW = benchW / MAX_VISIBLE_TOOLS;
        const cx = benchX + slotW * (i + 0.5);
        const cy = benchY + 50;
        return <Tool key={i} cx={cx} cy={cy} variant={i % 3} />;
      })}

      {/* Overflow indicator at the right end of the bench. */}
      {overflow > 0 ? (
        <g>
          <circle cx={benchX + benchW - 30} cy={benchY - 18} r={18} fill="#c8a25a" />
          <text
            x={benchX + benchW - 30}
            y={benchY - 12}
            textAnchor="middle"
            fontSize={14}
            fontWeight={600}
            fill="#2a1a0c"
          >
            +{overflow}
          </text>
        </g>
      ) : null}

      {/* Empty-state hint: faint pencil mark on the bench. */}
      {n === 0 ? (
        <text
          x={benchX + benchW / 2}
          y={benchY + benchH / 2 + 5}
          textAnchor="middle"
          fontSize={16}
          fill="#8a6a48"
          fontStyle="italic"
          opacity={0.7}
        >
          (no tools yet — add a project)
        </text>
      ) : null}
    </Workstation>
  );
}

function Tool({
  cx,
  cy,
  variant,
}: {
  cx: number;
  cy: number;
  variant: number;
}): JSX.Element {
  // Three primitive tool shapes so the bench reads as varied — these are
  // primitives only, Phase 4 swaps in real pixel-art tool sprites.
  if (variant === 0) {
    // Hammer
    return (
      <g>
        <rect x={cx - 4} y={cy - 30} width={8} height={50} fill="#7a5a3a" />
        <rect x={cx - 18} y={cy - 36} width={36} height={14} fill="#9a9a9a" stroke="#2a2a2a" strokeWidth={1} />
      </g>
    );
  }
  if (variant === 1) {
    // Wrench
    return (
      <g>
        <rect x={cx - 3} y={cy - 28} width={6} height={48} fill="#8a8a8a" />
        <circle cx={cx} cy={cy - 30} r={9} fill="none" stroke="#8a8a8a" strokeWidth={4} />
      </g>
    );
  }
  // Screwdriver
  return (
    <g>
      <rect x={cx - 4} y={cy - 8} width={8} height={30} fill="#cf6a2c" />
      <rect x={cx - 2} y={cy - 30} width={4} height={22} fill="#aaaaaa" />
    </g>
  );
}
