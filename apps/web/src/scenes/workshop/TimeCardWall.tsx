import type { ActivityEntry } from '../../api.js';
import { FLOOR, iso, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

const SLOTS = 5;

/**
 * Compact activity wall mounted beside the cron clocks on the back-left
 * wall (y = FLOOR). Shows recent activity entries as status cards.
 */
export function TimeCardWall({
  activity,
  onOpen,
}: {
  activity: ActivityEntry[];
  onOpen: () => void;
}): JSX.Element {
  const recent = activity.slice(0, SLOTS);

  // Plaque on back-left wall: roughly the right 1/3 of the wall.
  const xs = 7.35;
  const xe = 9.8;
  const zs = 0.6;
  const ze = 2.6;
  const wallY = FLOOR;

  const bl = iso(xs, wallY, zs);
  const br = iso(xe, wallY, zs);
  const tr = iso(xe, wallY, ze);
  const tl = iso(xs, wallY, ze);

  return (
    <Workstation
      label={`Activity log (${recent.length} recent runs)`}
      onActivate={onOpen}
    >
      {/* Plaque */}
      <polygon points={poly(bl, br, tr, tl)} fill="#2a1d14" stroke="#1a110a" strokeWidth={2} />
      <polygon
        points={poly(
          iso(xs + 0.1, wallY, zs + 0.1),
          iso(xe - 0.1, wallY, zs + 0.1),
          iso(xe - 0.1, wallY, ze - 0.1),
          iso(xs + 0.1, wallY, ze - 0.1),
        )}
        fill="none"
        stroke="#5a3a22"
        strokeWidth={1.2}
      />

      {(() => {
        const c = iso((xs + xe) / 2, wallY, ze - 0.28);
        return (
          <text x={c.x} y={c.y} textAnchor="middle" fontSize={11} fontFamily="monospace" fill="#c8a888">
            ACTIVITY
          </text>
        );
      })()}

      {Array.from({ length: SLOTS }, (_, i) => (
        <Slot key={i} x={xs + 0.35} z={ze - 0.65 - i * 0.33} wallY={wallY} card={recent[i]} />
      ))}
    </Workstation>
  );
}

function Slot({
  x,
  z,
  wallY,
  card,
}: {
  x: number;
  z: number;
  wallY: number;
  card: ActivityEntry | undefined;
}): JSX.Element {
  const w = 1.75;
  const h = 0.25;
  const a = iso(x, wallY, z);
  const b = iso(x + w, wallY, z);
  const c = iso(x + w, wallY, z + h);
  const d = iso(x, wallY, z + h);

  const band =
    card?.run.status === 'error'
      ? '#cf4040'
      : card?.run.status === 'running'
      ? '#e8b04a'
      : card?.run.status === 'success'
      ? '#5ec27a'
      : '#5a5a5a';

  return (
    <g>
      <polygon points={poly(a, b, c, d)} fill="#1a120d" stroke="#120c08" strokeWidth={0.8} />
      {card ? (
        <>
          <line x1={a.x} y1={a.y} x2={d.x} y2={d.y} stroke={band} strokeWidth={4} />
          <text
            x={(a.x + b.x) / 2}
            y={(a.y + d.y) / 2 + 3}
            textAnchor="middle"
            fontSize={8}
            fontFamily="monospace"
            fill="#e8d6b0"
          >
            {shorten(card.triggerName, 14)}
          </text>
        </>
      ) : null}
    </g>
  );
}

function shorten(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}.` : value;
}
