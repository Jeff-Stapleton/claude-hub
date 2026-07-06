import { iso, poly } from '../iso.js';
import { BELT_D, BELT_Y, gateX } from './layout.js';

/**
 * Approval gate: two posts and a crossbar spanning the belt just before
 * the stage it guards. Glows purple while an item is parked at it.
 */
export function GateArch({ stageIndex, held }: { stageIndex: number; held: boolean }): JSX.Element {
  const x = gateX(stageIndex);
  const y0 = BELT_Y - 0.12;
  const y1 = BELT_Y + BELT_D + 0.12;
  const barZ = 0.85;

  const postA0 = iso(x, y0, 0);
  const postA1 = iso(x, y0, barZ);
  const postB0 = iso(x, y1, 0);
  const postB1 = iso(x, y1, barZ);
  const label = iso(x, (y0 + y1) / 2, barZ + 0.18);

  const barColor = held ? '#b48ad6' : '#6a5a42';

  return (
    <g>
      <line x1={postB0.x} y1={postB0.y} x2={postB1.x} y2={postB1.y} stroke="#4a3a28" strokeWidth={3.5} strokeLinecap="round" />
      <line x1={postA0.x} y1={postA0.y} x2={postA1.x} y2={postA1.y} stroke="#5a4630" strokeWidth={3.5} strokeLinecap="round" />
      <polygon
        points={poly(postA1, postB1, iso(x, y1, barZ - 0.14), iso(x, y0, barZ - 0.14))}
        fill={held ? '#3a2a48' : '#2a2018'}
        stroke={barColor}
        strokeWidth={1.4}
        style={held ? { animation: 'workshop-led 1.1s ease-in-out infinite' } : undefined}
      />
      {held ? (
        <text x={label.x} y={label.y} textAnchor="middle" fontSize={9} fontFamily="monospace" fill="#d6bce8">
          APPROVAL
        </text>
      ) : null}
    </g>
  );
}
