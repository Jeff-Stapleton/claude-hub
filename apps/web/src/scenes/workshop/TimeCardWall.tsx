import type { Trigger } from '../../types.js';
import { Workstation } from './Workstation.jsx';

const SLOTS = 12; // 4 columns × 3 rows of card slots

/**
 * Mid-left floor: a wall of time card slots with a punch clock on top.
 *
 * For Phase 2 the "cards" reflect triggers that have a lastRun — once we
 * have a richer activity feed in scope (Phase 3+) this can read the
 * actual run history. Color band on each card encodes lastStatus.
 */
export function TimeCardWall({
  triggers,
  onOpen,
}: {
  triggers: Trigger[];
  onOpen: () => void;
}): JSX.Element {
  // Sort by lastRun desc so newest pinned cards are top-left.
  const recent = triggers
    .filter((t) => !!t.lastRun)
    .sort((a, b) => (b.lastRun ?? '').localeCompare(a.lastRun ?? ''))
    .slice(0, SLOTS);

  const wallX = 120;
  const wallY = 460;
  const wallW = 350;
  const wallH = 220;

  // Punch clock dimensions.
  const punchX = wallX + wallW / 2;
  const punchY = wallY + 30;

  return (
    <Workstation
      x={100}
      y={440}
      width={400}
      height={240}
      label={`Activity (${recent.length} recent runs)`}
      onActivate={onOpen}
    >
      {/* Wall plaque */}
      <rect x={wallX} y={wallY} width={wallW} height={wallH} fill="#2a1d14" stroke="#1a110a" strokeWidth={2} />

      {/* Punch clock body */}
      <rect x={punchX - 50} y={punchY - 20} width={100} height={50} rx={6} fill="#3a2818" stroke="#1a110a" strokeWidth={2} />
      <rect x={punchX - 36} y={punchY - 10} width={72} height={28} fill="#1a2018" stroke="#0a0e0a" strokeWidth={1} />
      <text x={punchX} y={punchY + 9} textAnchor="middle" fontSize={11} fontFamily="monospace" fill="#a8e0c8">
        TIME
      </text>

      {/* Slot grid */}
      {Array.from({ length: SLOTS }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = wallX + 20 + col * 80;
        const y = wallY + 80 + row * 50;
        const card = recent[i];
        return <Slot key={i} x={x} y={y} card={card} />;
      })}
    </Workstation>
  );
}

function Slot({
  x,
  y,
  card,
}: {
  x: number;
  y: number;
  card: Trigger | undefined;
}): JSX.Element {
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
      {/* Slot mount (always visible) */}
      <rect x={x} y={y + 18} width={70} height={6} fill="#1a110a" />
      {/* Card sticking up out of the slot (only when there's recent run data) */}
      {card ? (
        <>
          <rect x={x + 6} y={y} width={58} height={22} fill="#e8d6b0" stroke="#2a1c10" strokeWidth={1} />
          {/* Status color band on the card edge */}
          <rect x={x + 6} y={y} width={58} height={3} fill={band} />
          {/* Tiny stamp lines */}
          <line x1={x + 12} y1={y + 10} x2={x + 58} y2={y + 10} stroke="#5a4828" strokeWidth={0.8} opacity={0.7} />
          <line x1={x + 12} y1={y + 15} x2={x + 48} y2={y + 15} stroke="#5a4828" strokeWidth={0.8} opacity={0.7} />
        </>
      ) : null}
    </g>
  );
}
