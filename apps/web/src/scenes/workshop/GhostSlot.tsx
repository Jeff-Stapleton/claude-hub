import { iso, isoBoxPoints, poly } from '../iso.js';
import { SLOT_D, SLOT_W } from './layout.js';
import { Workstation } from './Workstation.jsx';

const GHOST_H = 0.95;

/**
 * The "+" ghost slot on a lane: a translucent dashed machine outline at
 * the next empty stage slot. Clicking it opens the add-machine picker.
 */
export function GhostSlot({
  x,
  y,
  projectLabel,
  onActivate,
}: {
  x: number;
  y: number;
  projectLabel: string;
  onActivate: () => void;
}): JSX.Element {
  const { topFace, rightFace, leftFace } = isoBoxPoints(x, y, SLOT_W, SLOT_D, GHOST_H);
  const plus = iso(x + SLOT_W / 2, y + SLOT_D / 2, GHOST_H * 0.55);
  const hint = iso(x + SLOT_W / 2, y + SLOT_D / 2, GHOST_H + 0.35);
  const dash = { fill: 'rgba(200, 168, 136, 0.06)', stroke: '#8a7458', strokeWidth: 1.2, strokeDasharray: '5 5' } as const;

  return (
    <Workstation label={`Add a machine to ${projectLabel}'s line`} onActivate={onActivate}>
      <polygon points={poly(...leftFace)} {...dash} />
      <polygon points={poly(...rightFace)} {...dash} />
      <polygon points={poly(...topFace)} {...dash} />
      <text x={plus.x} y={plus.y + 9} textAnchor="middle" fontSize={26} fontWeight={300} fill="#c8a888" opacity={0.85}>
        +
      </text>
      <text x={hint.x} y={hint.y} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#8a7458">
        ADD MACHINE
      </text>
    </Workstation>
  );
}
