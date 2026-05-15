import type { Trigger } from '../../types.js';
import { Workstation } from './Workstation.jsx';

const MAX_VISIBLE_CLOCKS = 8;

/**
 * Back-left wall: a grid of wall clocks. One per cron trigger.
 *
 * Any cron with lastStatus='running' pulses its clock. Other states are
 * shown via face color (success = warm cream, error = red wash, unrun =
 * dim gray). The clock hands themselves are decorative — the running
 * pulse is the load-bearing visual cue.
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

  // Wall plane.
  const wallX = 120;
  const wallY = 120;
  const wallW = 680;
  const wallH = 300;

  return (
    <Workstation
      x={100}
      y={100}
      width={700}
      height={320}
      label={`Cron triggers (${crons.length})`}
      onActivate={onOpen}
    >
      {/* Wall backboard */}
      <rect
        x={wallX}
        y={wallY}
        width={wallW}
        height={wallH}
        fill="#2a1d14"
        stroke="#1a110a"
        strokeWidth={2}
      />
      {/* Subtle horizontal wood plank lines */}
      {[80, 160, 240].map((dy) => (
        <line
          key={dy}
          x1={wallX}
          y1={wallY + dy}
          x2={wallX + wallW}
          y2={wallY + dy}
          stroke="#1a110a"
          strokeWidth={1}
          opacity={0.6}
        />
      ))}

      {/* Clocks laid out in a 4×2 grid. */}
      {visible.map((t, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const cx = wallX + 90 + col * 160;
        const cy = wallY + 80 + row * 130;
        return <Clock key={t.id} cx={cx} cy={cy} status={t.lastStatus} />;
      })}

      {/* Overflow badge */}
      {overflow > 0 ? (
        <g>
          <circle cx={wallX + wallW - 20} cy={wallY + wallH - 20} r={16} fill="#c8a25a" />
          <text
            x={wallX + wallW - 20}
            y={wallY + wallH - 14}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill="#2a1a0c"
          >
            +{overflow}
          </text>
        </g>
      ) : null}

      {/* Empty state */}
      {crons.length === 0 ? (
        <text
          x={wallX + wallW / 2}
          y={wallY + wallH / 2}
          textAnchor="middle"
          fontSize={14}
          fill="#8a6a48"
          fontStyle="italic"
          opacity={0.7}
        >
          (no clocks — add a cron trigger)
        </text>
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
      {/* Frame */}
      <circle cx={cx} cy={cy} r={42} fill="#3a2818" stroke="#1a110a" strokeWidth={2} />
      {/* Face */}
      <circle cx={cx} cy={cy} r={34} fill={face} stroke="#2a1c10" strokeWidth={1} />
      {/* 12 / 3 / 6 / 9 marks */}
      <line x1={cx} y1={cy - 30} x2={cx} y2={cy - 26} stroke="#2a1c10" strokeWidth={2} />
      <line x1={cx + 30} y1={cy} x2={cx + 26} y2={cy} stroke="#2a1c10" strokeWidth={2} />
      <line x1={cx} y1={cy + 30} x2={cx} y2={cy + 26} stroke="#2a1c10" strokeWidth={2} />
      <line x1={cx - 30} y1={cy} x2={cx - 26} y2={cy} stroke="#2a1c10" strokeWidth={2} />
      {/* Hour + minute hands at 10:10 (a friendly clock pose) */}
      <line x1={cx} y1={cy} x2={cx - 14} y2={cy - 10} stroke="#2a1c10" strokeWidth={3} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={cx + 16} y2={cy - 16} stroke="#2a1c10" strokeWidth={2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={2.5} fill="#2a1c10" />
    </g>
  );
}

const pulseStyle: React.CSSProperties = {
  transformOrigin: 'center',
  animation: 'workshop-pulse 1.2s ease-in-out infinite',
};
