import { iso, isoBoxPoints, poly } from '../iso.js';
import { MACHINE_BELT_OFFSET, SLOT_D, SLOT_W, TUNNEL_CLEAR, TUNNEL_H } from './layout.js';
import { Workstation } from './Workstation.jsx';

const GHOST_H = 0.95;

/**
 * The ghost machine previewed inside a hovered belt gap: a translucent
 * dashed machine outline straddling the belt, tunnel mouth included so it
 * previews the installed silhouette. Clicking it opens the add-machine
 * picker at that gap's insertion index.
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
  const mouthLo = y + MACHINE_BELT_OFFSET - TUNNEL_CLEAR;
  const mouthHi = y + SLOT_D - MACHINE_BELT_OFFSET + TUNNEL_CLEAR;
  const mouth = [
    iso(x, mouthLo, 0),
    iso(x, mouthHi, 0),
    iso(x, mouthHi, TUNNEL_H),
    iso(x, mouthLo, TUNNEL_H),
  ];

  return (
    <Workstation label={`Insert a machine here on ${projectLabel}'s line`} onActivate={onActivate}>
      <polygon points={poly(...leftFace)} {...dash} />
      <polygon points={poly(...rightFace)} {...dash} />
      <polygon points={poly(...topFace)} {...dash} />
      <polygon points={poly(...mouth)} fill="rgba(11, 9, 8, 0.3)" stroke="#8a7458" strokeWidth={1} strokeDasharray="4 4" />
      <text x={plus.x} y={plus.y + 9} textAnchor="middle" fontSize={26} fontWeight={300} fill="#c8a888" opacity={0.85}>
        +
      </text>
      <text x={hint.x} y={hint.y} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#8a7458">
        INSERT MACHINE
      </text>
    </Workstation>
  );
}
