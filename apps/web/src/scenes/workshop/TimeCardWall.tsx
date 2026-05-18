import type { Trigger } from '../../types.js';
import { FLOOR, iso, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

const SLOTS = 12;

/**
 * Mounted on the back-right wall (x = FLOOR). A punch clock at top and
 * a 4×3 grid of time card slots. For Phase 2 we approximate "recent
 * activity" by showing one card per trigger that has a `lastRun`; status
 * colors the card's edge band.
 */
export function TimeCardWall({
  triggers,
  onOpen,
}: {
  triggers: Trigger[];
  onOpen: () => void;
}): JSX.Element {
  const recent = triggers
    .filter((t) => !!t.lastRun)
    .sort((a, b) => (b.lastRun ?? '').localeCompare(a.lastRun ?? ''))
    .slice(0, SLOTS);

  // Plaque on back-right wall: y ∈ [1, 9], z ∈ [0.4, 2.6]
  const ys = 1;
  const ye = 9;
  const zs = 0.4;
  const ze = 2.6;
  const wallX = FLOOR;

  const bl = iso(wallX, ys, zs);
  const br = iso(wallX, ye, zs);
  const tr = iso(wallX, ye, ze);
  const tl = iso(wallX, ys, ze);

  return (
    <Workstation
      label={`Activity (${recent.length} recent runs)`}
      onActivate={onOpen}
    >
      {/* Plaque */}
      <polygon points={poly(bl, br, tr, tl)} fill="#2a1d14" stroke="#1a110a" strokeWidth={2} />

      {/* Punch clock at the top center of the plaque */}
      {(() => {
        const a = iso(wallX, (ys + ye) / 2 - 0.7, ze - 0.6);
        const b = iso(wallX, (ys + ye) / 2 + 0.7, ze - 0.6);
        const c = iso(wallX, (ys + ye) / 2 + 0.7, ze - 0.1);
        const d = iso(wallX, (ys + ye) / 2 - 0.7, ze - 0.1);
        const screen = {
          a: iso(wallX, (ys + ye) / 2 - 0.5, ze - 0.5),
          b: iso(wallX, (ys + ye) / 2 + 0.5, ze - 0.5),
          c: iso(wallX, (ys + ye) / 2 + 0.5, ze - 0.2),
          d: iso(wallX, (ys + ye) / 2 - 0.5, ze - 0.2),
        };
        return (
          <>
            <polygon points={poly(a, b, c, d)} fill="#3a2818" stroke="#1a110a" strokeWidth={1.5} />
            <polygon
              points={poly(screen.a, screen.b, screen.c, screen.d)}
              fill="#1a2018"
              stroke="#0a0e0a"
              strokeWidth={1}
            />
            <text
              x={(screen.a.x + screen.b.x) / 2}
              y={(screen.a.y + screen.d.y) / 2 + 3}
              textAnchor="middle"
              fontSize={10}
              fontFamily="monospace"
              fill="#a8e0c8"
            >
              TIME
            </text>
          </>
        );
      })()}

      {/* Slot grid: 4 columns across (Y direction) × 3 rows (down in Z) */}
      {Array.from({ length: SLOTS }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const cyw = ys + 0.7 + col * 1.85;
        const czw = ze - 0.85 - row * 0.55;
        const card = recent[i];
        return <Slot key={i} y={cyw} z={czw} wallX={wallX} card={card} />;
      })}
    </Workstation>
  );
}

function Slot({
  y,
  z,
  wallX,
  card,
}: {
  y: number;
  z: number;
  wallX: number;
  card: Trigger | undefined;
}): JSX.Element {
  // Slot itself: a small horizontal mount on the wall.
  const slotW = 1.4;
  const ms = iso(wallX, y - slotW / 2, z);
  const me = iso(wallX, y + slotW / 2, z);
  // Card sticking up from the slot.
  const cardH = 0.4;
  const ca = iso(wallX, y - slotW / 2 + 0.1, z);
  const cb = iso(wallX, y + slotW / 2 - 0.1, z);
  const cc = iso(wallX, y + slotW / 2 - 0.1, z + cardH);
  const cd = iso(wallX, y - slotW / 2 + 0.1, z + cardH);
  const top = iso(wallX, y + slotW / 2 - 0.1, z + cardH - 0.05);
  const topL = iso(wallX, y - slotW / 2 + 0.1, z + cardH - 0.05);

  const band =
    card?.lastStatus === 'error'
      ? '#cf4040'
      : card?.lastStatus === 'running'
      ? '#e8b04a'
      : card?.lastStatus === 'success'
      ? '#5ec27a'
      : '#5a5a5a';

  return (
    <g>
      {/* Slot mount (always rendered) */}
      <line x1={ms.x} y1={ms.y} x2={me.x} y2={me.y} stroke="#1a110a" strokeWidth={4} />
      {card ? (
        <>
          <polygon
            points={poly(ca, cb, cc, cd)}
            fill="#e8d6b0"
            stroke="#2a1c10"
            strokeWidth={0.8}
          />
          {/* Status color band along the top edge of the card */}
          <polygon points={poly(topL, top, cc, cd)} fill={band} />
        </>
      ) : null}
    </g>
  );
}
