import type { Trigger } from '../../types.js';
import { Workstation } from './Workstation.jsx';

const MAX_VISIBLE_TUBES = 6;

/**
 * Back-right wall: pneumatic mail tubes. One per webhook trigger.
 *
 * Each tube has a slot at the bottom where an envelope flashes briefly
 * when the webhook last ran. Empty state: bare wall mounts with no tubes
 * installed.
 */
export function WebhookMail({
  triggers,
  onOpen,
}: {
  triggers: Trigger[];
  onOpen: () => void;
}): JSX.Element {
  const webhooks = triggers.filter((t) => t.type === 'webhook');
  const visible = webhooks.slice(0, MAX_VISIBLE_TUBES);
  const overflow = Math.max(0, webhooks.length - MAX_VISIBLE_TUBES);

  const wallX = 820;
  const wallY = 120;
  const wallW = 680;
  const wallH = 300;

  return (
    <Workstation
      x={820}
      y={100}
      width={680}
      height={320}
      label={`Webhook triggers (${webhooks.length})`}
      onActivate={onOpen}
    >
      {/* Wall */}
      <rect
        x={wallX}
        y={wallY}
        width={wallW}
        height={wallH}
        fill="#2a1d14"
        stroke="#1a110a"
        strokeWidth={2}
      />
      {/* Top rail where tubes mount */}
      <rect
        x={wallX + 20}
        y={wallY + 30}
        width={wallW - 40}
        height={10}
        fill="#5a3a22"
        stroke="#1a110a"
        strokeWidth={1}
      />

      {visible.map((t, i) => {
        const slotW = (wallW - 60) / MAX_VISIBLE_TUBES;
        const cx = wallX + 30 + slotW * (i + 0.5);
        return <Tube key={t.id} cx={cx} top={wallY + 40} bottom={wallY + wallH - 30} status={t.lastStatus} />;
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
      {webhooks.length === 0 ? (
        <text
          x={wallX + wallW / 2}
          y={wallY + wallH / 2}
          textAnchor="middle"
          fontSize={14}
          fill="#8a6a48"
          fontStyle="italic"
          opacity={0.7}
        >
          (no tubes — add a webhook trigger)
        </text>
      ) : null}
    </Workstation>
  );
}

function Tube({
  cx,
  top,
  bottom,
  status,
}: {
  cx: number;
  top: number;
  bottom: number;
  status: 'running' | 'success' | 'error' | undefined;
}): JSX.Element {
  const tubeColor =
    status === 'error' ? '#704040' : status === 'success' ? '#a88a5a' : '#8a7050';
  const isRunning = status === 'running';
  return (
    <g style={isRunning ? flashStyle : undefined}>
      {/* Tube body */}
      <rect
        x={cx - 10}
        y={top}
        width={20}
        height={bottom - top}
        fill={tubeColor}
        stroke="#1a110a"
        strokeWidth={1}
      />
      {/* Tube highlight (suggestion of cylinder) */}
      <rect x={cx - 6} y={top + 4} width={3} height={bottom - top - 8} fill="#d0b888" opacity={0.4} />
      {/* Slot at bottom */}
      <rect x={cx - 12} y={bottom} width={24} height={6} fill="#1a110a" />
      {/* Envelope hint if recently used */}
      {status && status !== 'running' ? (
        <rect
          x={cx - 8}
          y={bottom + 8}
          width={16}
          height={10}
          fill="#e8d6b0"
          stroke="#2a1c10"
          strokeWidth={1}
        />
      ) : null}
    </g>
  );
}

const flashStyle: React.CSSProperties = {
  animation: 'workshop-flash 0.8s ease-in-out infinite',
};
