import { iso, isoBoxPoints, poly } from '../iso.js';
import {
  BELT_LOCAL_Y,
  HEAD_D,
  HEAD_LOCAL_Y,
  HEAD_W,
  HEAD_X,
  LANE_BELT_X0,
} from './layout.js';
import { Workstation } from './Workstation.jsx';

const GHOST_H = 1.0;

/**
 * The ghost project lane in the band after the last real lane: a
 * translucent dashed head-machine silhouette plus a dashed belt hint,
 * previewing the assembly line a new project gets. Clicking it opens the
 * new-project wizard (the GhostSlot pattern, one level up).
 */
export function GhostLane({
  y0,
  beltX1,
  onActivate,
}: {
  /** Lane-band origin y (ghostLaneY(projectCount)). */
  y0: number;
  /** Belt end (the right wall's x), shared with the real lanes. */
  beltX1: number;
  onActivate: () => void;
}): JSX.Element {
  const y = y0 + HEAD_LOCAL_Y;
  const { topFace, rightFace, leftFace } = isoBoxPoints(HEAD_X, y, HEAD_W, HEAD_D, GHOST_H);
  const plus = iso(HEAD_X + HEAD_W / 2, y + HEAD_D / 2, GHOST_H * 0.55);
  const hint = iso(HEAD_X + HEAD_W / 2, y + HEAD_D / 2, GHOST_H + 0.35);
  const dash = {
    fill: 'rgba(200, 168, 136, 0.06)',
    stroke: '#8a7458',
    strokeWidth: 1.2,
    strokeDasharray: '5 5',
  } as const;
  const beltA = iso(LANE_BELT_X0, y0 + BELT_LOCAL_Y, 0.02);
  const beltB = iso(beltX1, y0 + BELT_LOCAL_Y, 0.02);

  return (
    <Workstation label="Add a project" onActivate={onActivate}>
      <line
        x1={beltA.x}
        y1={beltA.y}
        x2={beltB.x}
        y2={beltB.y}
        stroke="#8a7458"
        strokeWidth={1.2}
        strokeDasharray="6 8"
        opacity={0.45}
      />
      <polygon points={poly(...leftFace)} {...dash} />
      <polygon points={poly(...rightFace)} {...dash} />
      <polygon points={poly(...topFace)} {...dash} />
      <text
        x={plus.x}
        y={plus.y + 9}
        textAnchor="middle"
        fontSize={26}
        fontWeight={300}
        fill="#c8a888"
        opacity={0.85}
      >
        +
      </text>
      <text x={hint.x} y={hint.y} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#8a7458">
        ADD PROJECT
      </text>
    </Workstation>
  );
}
