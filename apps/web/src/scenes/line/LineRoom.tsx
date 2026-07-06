import { iso, poly } from '../iso.js';
import { EXIT_X, HALL_D, HALL_W, HALL_WALL_H } from './layout.js';

/**
 * The assembly hall: a long shallow floor with two back walls, styled
 * like the workshop's room so the line scene reads as another room of
 * the same building. Includes the "SHIPPED" exit chute in the right wall
 * where completed items leave the line.
 */
export function LineRoom(): JSX.Element {
  const F = iso(0, 0, 0);
  const R = iso(HALL_W, 0, 0);
  const B = iso(HALL_W, HALL_D, 0);
  const L = iso(0, HALL_D, 0);

  const gridLines: Array<{ a: ReturnType<typeof iso>; b: ReturnType<typeof iso> }> = [];
  for (let i = 1; i < HALL_D; i++) {
    gridLines.push({ a: iso(0, i, 0), b: iso(HALL_W, i, 0) });
  }
  for (let i = 1; i < HALL_W; i++) {
    gridLines.push({ a: iso(i, 0, 0), b: iso(i, HALL_D, 0) });
  }

  // Back wall along y = HALL_D, right wall along x = HALL_W.
  const bw = [iso(HALL_W, HALL_D, 0), iso(0, HALL_D, 0), iso(0, HALL_D, HALL_WALL_H), iso(HALL_W, HALL_D, HALL_WALL_H)];
  const rw = [iso(HALL_W, HALL_D, 0), iso(HALL_W, 0, 0), iso(HALL_W, 0, HALL_WALL_H), iso(HALL_W, HALL_D, HALL_WALL_H)];

  return (
    <g>
      {/* Walls first (farthest), then floor. */}
      <polygon points={poly(bw[0]!, bw[1]!, bw[2]!, bw[3]!)} fill="#1f1610" stroke="#0e0a06" strokeWidth={1.5} />
      {[1, 2].map((z) => {
        const a = iso(0, HALL_D, z);
        const b = iso(HALL_W, HALL_D, z);
        return <line key={`bw-${z}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e0a06" strokeWidth={1} opacity={0.7} />;
      })}
      <polygon points={poly(rw[0]!, rw[1]!, rw[2]!, rw[3]!)} fill="#2a1d14" stroke="#0e0a06" strokeWidth={1.5} />
      {[1, 2].map((z) => {
        const a = iso(HALL_W, 0, z);
        const b = iso(HALL_W, HALL_D, z);
        return <line key={`rw-${z}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e0a06" strokeWidth={1} opacity={0.7} />;
      })}
      {(() => {
        const a = iso(HALL_W, HALL_D, 0);
        const b = iso(HALL_W, HALL_D, HALL_WALL_H);
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0a0805" strokeWidth={2} />;
      })()}

      <polygon points={poly(F, R, B, L)} fill="url(#lineFloorShade)" stroke="#1a110a" strokeWidth={2} />
      {gridLines.map((l, i) => (
        <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="#1a110a" strokeWidth={0.6} opacity={0.55} />
      ))}

      <ExitChute />
    </g>
  );
}

/** Opening in the right wall where finished work leaves the hall. */
function ExitChute(): JSX.Element {
  const ys = 1.95;
  const ye = 2.65;
  const zs = 0.12;
  const ze = 0.86;
  const label = iso(HALL_W, (ys + ye) / 2, ze + 0.16);
  return (
    <g>
      <polygon
        points={poly(iso(HALL_W, ys, zs), iso(HALL_W, ye, zs), iso(HALL_W, ye, ze), iso(HALL_W, ys, ze))}
        fill="#4a3020"
        stroke="#130c08"
        strokeWidth={1.4}
      />
      <polygon
        points={poly(
          iso(HALL_W, ys + 0.08, zs + 0.08),
          iso(HALL_W, ye - 0.08, zs + 0.08),
          iso(HALL_W, ye - 0.08, ze - 0.12),
          iso(HALL_W, ys + 0.08, ze - 0.12),
        )}
        fill="#090807"
        stroke="#0f0b08"
        strokeWidth={1}
      />
      <text x={label.x} y={label.y} textAnchor="middle" fontSize={9} fontFamily="monospace" fill="#c8a888" opacity={0.85}>
        SHIPPED
      </text>
    </g>
  );
}
