import { iso, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

/**
 * Opening in the back-right wall (x = wallX) where trigger-driven work
 * requests enter the workshop. Clicking it opens the triggers scene.
 */
export function WorkRequestTunnel({
  wallX,
  y,
  onOpen,
}: {
  wallX: number;
  y: number;
  onOpen: () => void;
}): JSX.Element {
  const ys = y - 0.08;
  const ye = y + 0.5;
  const zs = 0.12;
  const ze = 0.82;
  const bottomLeft = iso(wallX, ys, zs);
  const bottomRight = iso(wallX, ye, zs);
  const topRight = iso(wallX, ye, ze);
  const topLeft = iso(wallX, ys, ze);
  const label = iso(wallX, (ys + ye) / 2, ze + 0.14);

  return (
    <Workstation label="Work request tunnel (open triggers)" onActivate={onOpen}>
      <polygon points={poly(bottomLeft, bottomRight, topRight, topLeft)} fill="#4a3020" stroke="#130c08" strokeWidth={1.4} />
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
      <line
        x1={topLeft.x}
        y1={topLeft.y}
        x2={topRight.x}
        y2={topRight.y}
        stroke="#7a5635"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <text x={label.x} y={label.y} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="#c8a888" opacity={0.8}>
        REQUESTS
      </text>
    </Workstation>
  );
}
