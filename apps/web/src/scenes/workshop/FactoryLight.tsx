import type { FactoryLightState } from '../../types.js';
import { iso } from '../iso.js';
import { BELT_D } from './layout.js';
import { Workstation } from './Workstation.jsx';

/** Same dash tokens as GhostLane/GhostSlot — the "not configured yet" look. */
const GHOST = {
  fill: 'rgba(200, 168, 136, 0.06)',
  stroke: '#8a7458',
  strokeWidth: 1.2,
  strokeDasharray: '5 5',
} as const;

const LIGHT_FILL: Record<Exclude<FactoryLightState, 'ghost'>, string> = {
  healthy: '#5ec27a',
  down: '#cf4040',
  unknown: '#e8b04a',
};

/**
 * The factory light mounted above a lane's SHIPPED door: project-level
 * health at a glance. Ghost (dashed) until monitoring is configured and
 * enabled; then green = all checks passing, amber = awaiting first results,
 * red (pulsing — the alarm state) = the app is down. Clicking it opens the
 * monitoring config panel either way.
 */
export function FactoryLight({
  wallX,
  beltY,
  projectName,
  light,
  onOpen,
}: {
  wallX: number;
  beltY: number;
  projectName: string;
  light: FactoryLightState;
  onOpen: () => void;
}): JSX.Element {
  const cy = beltY + BELT_D / 2;
  const lamp = iso(wallX, cy, 1.3);
  const bracketFoot = iso(wallX, cy, 1.06);

  const label =
    light === 'ghost'
      ? `${projectName} — set up monitoring`
      : `${projectName} monitor — ${
          light === 'down' ? 'DOWN' : light === 'healthy' ? 'healthy' : 'awaiting first checks'
        }`;

  return (
    <Workstation label={label} onActivate={onOpen}>
      {/* Generous invisible hit target — the lamp itself is small. */}
      <circle cx={lamp.x} cy={lamp.y} r={11} fill="transparent" />
      <line
        x1={bracketFoot.x}
        y1={bracketFoot.y}
        x2={lamp.x}
        y2={lamp.y}
        stroke={light === 'ghost' ? GHOST.stroke : '#2a1d14'}
        strokeWidth={1.4}
        {...(light === 'ghost' ? { strokeDasharray: '3 3' } : {})}
      />
      {light === 'ghost' ? (
        <circle cx={lamp.x} cy={lamp.y} r={5} {...GHOST} />
      ) : (
        <circle
          cx={lamp.x}
          cy={lamp.y}
          r={5}
          fill={LIGHT_FILL[light]}
          stroke="#15100c"
          strokeWidth={1}
          style={
            light === 'down' ? { animation: 'workshop-led 1.1s ease-in-out infinite' } : undefined
          }
        />
      )}
    </Workstation>
  );
}
