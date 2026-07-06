import { iso, isoBoxPoints, poly } from '../iso.js';
import { BELT_D, BELT_H, BELT_X0, BELT_X1, BELT_Y } from './layout.js';

/**
 * The long conveyor running the length of the hall — a stretched version
 * of the workshop's per-machine Conveyor. A dashed guide line on the top
 * face scrolls while anything on the line is running.
 */
export function Belt({ moving }: { moving: boolean }): JSX.Element {
  const length = BELT_X1 - BELT_X0;
  const belt = isoBoxPoints(BELT_X0, BELT_Y, length, BELT_D, BELT_H);
  const slats = Array.from({ length: Math.floor(length / 0.38) }, (_, i) => 0.18 + i * 0.38).filter(
    (offset) => offset < length - 0.1,
  );
  const guideA = iso(BELT_X0 + 0.1, BELT_Y + BELT_D / 2, BELT_H + 0.01);
  const guideB = iso(BELT_X1 - 0.1, BELT_Y + BELT_D / 2, BELT_H + 0.01);

  return (
    <g>
      <polygon points={poly(...belt.leftFace)} fill="#1f1f1f" stroke="#0d0d0d" strokeWidth={0.8} />
      <polygon points={poly(...belt.rightFace)} fill="#2a2a2a" stroke="#0d0d0d" strokeWidth={0.8} />
      <polygon points={poly(...belt.topFace)} fill="#34302a" stroke="#0d0d0d" strokeWidth={1} />
      {slats.map((offset) => {
        const a = iso(BELT_X0 + offset, BELT_Y + 0.03, BELT_H + 0.02);
        const b = iso(BELT_X0 + offset, BELT_Y + BELT_D - 0.03, BELT_H + 0.02);
        return <line key={offset} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#151515" strokeWidth={1.2} />;
      })}
      <line
        x1={guideA.x}
        y1={guideA.y}
        x2={guideB.x}
        y2={guideB.y}
        stroke="#c8a25a"
        strokeWidth={1}
        strokeDasharray="6 14"
        opacity={moving ? 0.5 : 0.15}
        style={moving ? { animation: 'line-belt-scroll 1.2s linear infinite' } : undefined}
      />
    </g>
  );
}
