import { iso, poly } from '../iso.js';
import { BELT_D } from './layout.js';

/**
 * Opening in the right wall (x = wallX) where a lane's finished work
 * leaves the workshop, aligned with that lane's belt.
 */
export function ExitChute({ wallX, beltY }: { wallX: number; beltY: number }): JSX.Element {
  const ys = beltY - 0.15;
  const ye = beltY + BELT_D + 0.15;
  const zs = 0.12;
  const ze = 0.86;
  const label = iso(wallX, (ys + ye) / 2, ze + 0.16);
  return (
    <g>
      <polygon
        points={poly(iso(wallX, ys, zs), iso(wallX, ye, zs), iso(wallX, ye, ze), iso(wallX, ys, ze))}
        fill="#4a3020"
        stroke="#130c08"
        strokeWidth={1.4}
      />
      <polygon
        points={poly(
          iso(wallX, ys + 0.08, zs + 0.08),
          iso(wallX, ye - 0.08, zs + 0.08),
          iso(wallX, ye - 0.08, ze - 0.12),
          iso(wallX, ys + 0.08, ze - 0.12),
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
