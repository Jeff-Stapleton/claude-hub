import type { CronTrigger, Trigger, TriggerRunStatus } from '../../types.js';
import { iso, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

/**
 * Control-room clock wall on the back-left wall (y = wallY): a row of
 * newsroom-style clocks, one per cron trigger, each with a nameplate and
 * a status LED. The hands point at the schedule's fire time when the cron
 * minute/hour fields are plain numbers. Clicking opens the triggers scene.
 */

const SLOTS = 3;
const PANEL_W = 3.3;
/** Clock face center height on the wall, and screen-space radii. */
const CLOCK_Z = 2.08;
const BEZEL_R = 21;
const FACE_R = 19;

export function CronClockWall({
  triggers,
  wallY,
  xEnd,
  onOpen,
}: {
  triggers: Trigger[];
  /** Depth of the back-left wall (the room's floor depth). */
  wallY: number;
  /** Right edge of the panel along the wall. */
  xEnd: number;
  onOpen: () => void;
}): JSX.Element {
  const crons = triggers.filter((t): t is CronTrigger => t.type === 'cron');
  const xs = xEnd - PANEL_W;
  const zs = 1.3;
  const ze = 2.75;

  const bl = iso(xs, wallY, zs);
  const br = iso(xEnd, wallY, zs);
  const tr = iso(xEnd, wallY, ze);
  const tl = iso(xs, wallY, ze);

  return (
    <Workstation label={`Cron schedules (${crons.length}) — open triggers`} onActivate={onOpen}>
      {/* Panel */}
      <polygon points={poly(bl, br, tr, tl)} fill="#241a12" stroke="#1a110a" strokeWidth={2} />
      <polygon
        points={poly(
          iso(xs + 0.1, wallY, zs + 0.1),
          iso(xEnd - 0.1, wallY, zs + 0.1),
          iso(xEnd - 0.1, wallY, ze - 0.1),
          iso(xs + 0.1, wallY, ze - 0.1),
        )}
        fill="none"
        stroke="#5a3a22"
        strokeWidth={1.2}
      />

      {(() => {
        const c = iso(xs + PANEL_W / 2, wallY, ze - 0.24);
        return (
          <text x={c.x} y={c.y} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#c8a888">
            SCHEDULES
          </text>
        );
      })()}

      {Array.from({ length: SLOTS }, (_, i) => (
        <Clock key={i} cx={xs + 0.65 + i * 1.0} wallY={wallY} trigger={crons[i]} />
      ))}

      {crons.length > SLOTS
        ? (() => {
            const c = iso(xEnd - 0.35, wallY, zs + 0.22);
            return (
              <text x={c.x} y={c.y} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#c8a888" opacity={0.8}>
                +{crons.length - SLOTS}
              </text>
            );
          })()
        : null}
    </Workstation>
  );
}

function Clock({
  cx,
  wallY,
  trigger,
}: {
  cx: number;
  wallY: number;
  trigger: CronTrigger | undefined;
}): JSX.Element {
  const c = iso(cx, wallY, CLOCK_Z);

  if (!trigger) {
    // Empty slot: a dim, handless face waiting for a schedule.
    return (
      <g opacity={0.45}>
        <circle cx={c.x} cy={c.y} r={BEZEL_R} fill="#1a120d" stroke="#3a2a1a" strokeWidth={2} />
        <circle cx={c.x} cy={c.y} r={FACE_R} fill="#241a12" stroke="none" />
      </g>
    );
  }

  const { h, m } = cronHands(trigger.cronExpr);
  const minute = handTip(c, (m / 60) * 360, 15);
  const hour = handTip(c, (((h % 12) + m / 60) / 12) * 360, 9.5);

  return (
    <g>
      {/* Bezel + cream face */}
      <circle cx={c.x} cy={c.y} r={BEZEL_R} fill="#3a2b1c" stroke="#1a110a" strokeWidth={2} />
      <circle cx={c.x} cy={c.y} r={FACE_R} fill="#e8d6b0" stroke="#8a7050" strokeWidth={1} />

      {/* Hour ticks */}
      {Array.from({ length: 12 }, (_, k) => {
        const outer = handTip(c, k * 30, FACE_R - 2);
        const inner = handTip(c, k * 30, FACE_R - (k % 3 === 0 ? 5 : 3.5));
        return (
          <line key={k} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#5a4a32" strokeWidth={k % 3 === 0 ? 1.4 : 0.8} />
        );
      })}

      {/* Hands set to the cron fire time */}
      <line x1={c.x} y1={c.y} x2={hour.x} y2={hour.y} stroke="#2a1a10" strokeWidth={2.4} strokeLinecap="round" />
      <line x1={c.x} y1={c.y} x2={minute.x} y2={minute.y} stroke="#2a1a10" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx={c.x} cy={c.y} r={1.8} fill="#2a1a10" />

      {/* Status LED at the bezel's upper right */}
      <circle cx={c.x + 17} cy={c.y - 17} r={2.8} fill={statusColor(trigger.lastStatus)} stroke="#1a110a" strokeWidth={0.8} />

      {/* Nameplate under the clock */}
      <polygon
        points={poly(
          iso(cx - 0.46, wallY, 1.44),
          iso(cx + 0.46, wallY, 1.44),
          iso(cx + 0.46, wallY, 1.66),
          iso(cx - 0.46, wallY, 1.66),
        )}
        fill="#1a120d"
        stroke="#120c08"
        strokeWidth={0.8}
      />
      {(() => {
        const p = iso(cx, wallY, 1.55);
        return (
          <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#e8d6b0">
            {shorten(trigger.name, 11)}
          </text>
        );
      })()}
    </g>
  );
}

/** Screen point at `angleDeg` clockwise from 12 o'clock, `len` px from c. */
function handTip(c: { x: number; y: number }, angleDeg: number, len: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: c.x + len * Math.sin(a), y: c.y - len * Math.cos(a) };
}

/**
 * Fire time from a cron expression's minute/hour fields. Non-numeric
 * fields (wildcards, steps, ranges) fall back to the classic 10:10 pose.
 */
function cronHands(expr: string): { h: number; m: number } {
  const [m = '', h = ''] = expr.trim().split(/\s+/);
  return {
    m: /^\d{1,2}$/.test(m) ? Number(m) % 60 : 10,
    h: /^\d{1,2}$/.test(h) ? Number(h) % 24 : 10,
  };
}

function statusColor(status: TriggerRunStatus | undefined): string {
  return status === 'error'
    ? '#cf4040'
    : status === 'running'
      ? '#e8b04a'
      : status === 'success'
        ? '#5ec27a'
        : '#5a5a5a';
}

function shorten(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}.` : value;
}
