import type { Trigger } from '../../types.js';
import { FLOOR, iso, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

const MAX_VISIBLE_CLOCKS = 6;

/**
 * Mounted on the back-left wall (y = FLOOR). A grid of round clocks on
 * a wooden plaque. The plaque is a parallelogram in the wall plane (y is
 * constant); the clocks themselves are circles rendered without
 * perspective skew — they read as "facing the viewer" which keeps them
 * legible at the workshop's small scale.
 *
 * Running cron triggers pulse their clock; success/error tint the face.
 */
export function CronWall({
  triggers,
  onOpen,
}: {
  triggers: Trigger[];
  onOpen: () => void;
}): JSX.Element {
  const crons = triggers.filter((t) => t.type === 'cron');
  const visible = crons.slice(0, MAX_VISIBLE_CLOCKS);
  const overflow = Math.max(0, crons.length - MAX_VISIBLE_CLOCKS);

  // Plaque on back-left wall: roughly the left 2/3 of the wall.
  const xs = 0.8;
  const xe = 7.2;
  const zs = 0.6;
  const ze = 2.6;
  const wallY = FLOOR;

  const bl = iso(xs, wallY, zs);
  const br = iso(xe, wallY, zs);
  const tr = iso(xe, wallY, ze);
  const tl = iso(xs, wallY, ze);

  return (
    <Workstation label={`Cron triggers (${crons.length})`} onActivate={onOpen}>
      {/* Plaque */}
      <polygon points={poly(bl, br, tr, tl)} fill="#2a1d14" stroke="#1a110a" strokeWidth={2} />
      {/* Plaque trim */}
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

      {/* Clocks: 3 across x 2 rows on the plaque. Project the center of
          each slot in world coords, then render the clock as a flat
          circle in screen space (no foreshortening — it stays legible). */}
      {visible.map((t, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const cxw = xs + 1 + col * 1.95;
        const czw = ze - 0.55 - row * 1.0;
        const center = iso(cxw, wallY, czw);
        return <Clock key={t.id} cx={center.x} cy={center.y} status={t.lastStatus} />;
      })}

      {/* Overflow badge */}
      {overflow > 0 ? (
        (() => {
          const c = iso(xe - 0.4, wallY, zs + 0.4);
          return (
            <g>
              <circle cx={c.x} cy={c.y} r={14} fill="#c8a25a" stroke="#1a110a" strokeWidth={1.2} />
              <text x={c.x} y={c.y + 5} textAnchor="middle" fontSize={12} fontWeight={600} fill="#2a1a0c">
                +{overflow}
              </text>
            </g>
          );
        })()
      ) : null}

      {/* Empty state */}
      {crons.length === 0 ? (
        (() => {
          const c = iso((xs + xe) / 2, wallY, (zs + ze) / 2);
          return (
            <text
              x={c.x}
              y={c.y}
              textAnchor="middle"
              fontSize={13}
              fill="#8a6a48"
              opacity={0.7}
              fontStyle="italic"
            >
              (no clocks yet)
            </text>
          );
        })()
      ) : null}
    </Workstation>
  );
}

function Clock({
  cx,
  cy,
  status,
}: {
  cx: number;
  cy: number;
  status: 'running' | 'success' | 'error' | undefined;
}): JSX.Element {
  const face =
    status === 'error' ? '#704040' : status === 'success' ? '#e8d6b0' : '#9a8a70';
  const isRunning = status === 'running';

  return (
    <g style={isRunning ? pulseStyle : undefined}>
      <circle cx={cx} cy={cy} r={26} fill="#3a2818" stroke="#1a110a" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={21} fill={face} stroke="#2a1c10" strokeWidth={1} />
      {/* 12/3/6/9 marks */}
      <line x1={cx} y1={cy - 18} x2={cx} y2={cy - 15} stroke="#2a1c10" strokeWidth={1.5} />
      <line x1={cx + 18} y1={cy} x2={cx + 15} y2={cy} stroke="#2a1c10" strokeWidth={1.5} />
      <line x1={cx} y1={cy + 18} x2={cx} y2={cy + 15} stroke="#2a1c10" strokeWidth={1.5} />
      <line x1={cx - 18} y1={cy} x2={cx - 15} y2={cy} stroke="#2a1c10" strokeWidth={1.5} />
      {/* Hands at 10:10 */}
      <line x1={cx} y1={cy} x2={cx - 9} y2={cy - 6} stroke="#2a1c10" strokeWidth={2} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={cx + 10} y2={cy - 10} stroke="#2a1c10" strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={1.8} fill="#2a1c10" />
    </g>
  );
}

const pulseStyle: React.CSSProperties = {
  transformOrigin: 'center',
  animation: 'workshop-pulse 1.2s ease-in-out infinite',
};
