import type { Trigger } from '../../types.js';
import { iso, isoBoxPoints, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

const MAX_VISIBLE_TUBES = 4;

/**
 * Back-left of the floor: a small mail station with vertical pneumatic
 * tubes rising from a cabinet. Each webhook trigger gets a tube; running
 * webhooks flash their tube.
 *
 * Footprint: world (1.5, 7.2) to (3.5, 8.7).
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

  const bx = 1.5;
  const by = 7.2;
  const bw = 2;
  const bd = 1.5;
  const bh = 1.0;

  const { topFace, rightFace, leftFace } = isoBoxPoints(bx, by, bw, bd, bh);

  return (
    <Workstation
      label={`Webhook triggers (${webhooks.length})`}
      onActivate={onOpen}
    >
      {/* Cabinet faces */}
      <polygon points={poly(...leftFace)} fill="#2c1d12" stroke="#1a110a" strokeWidth={1} />
      <polygon points={poly(...rightFace)} fill="#3e2618" stroke="#1a110a" strokeWidth={1} />
      <polygon points={poly(...topFace)} fill="#4a3020" stroke="#1a110a" strokeWidth={1.5} />

      {/* Mail slot strip on the front-right (MIN Y) face of the cabinet. */}
      {(() => {
        const slotZ = 0.5;
        const a = iso(bx + 0.25, by, slotZ);
        const b = iso(bx + bw - 0.25, by, slotZ);
        return (
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1a110a" strokeWidth={4} />
        );
      })()}

      {/* Pneumatic tubes rising from the cabinet top, one per webhook. */}
      {visible.map((t, i) => {
        const slot = bw / (MAX_VISIBLE_TUBES + 1);
        const tx = bx + slot * (i + 1);
        const ty = by + bd / 2;
        return <Tube key={t.id} x={tx} y={ty} baseZ={bh} status={t.lastStatus} />;
      })}

      {/* Overflow badge */}
      {overflow > 0 ? (
        (() => {
          const c = iso(bx + bw - 0.3, by + bd - 0.3, bh + 0.6);
          return (
            <g>
              <circle cx={c.x} cy={c.y} r={12} fill="#c8a25a" stroke="#1a110a" strokeWidth={1.2} />
              <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#2a1a0c">
                +{overflow}
              </text>
            </g>
          );
        })()
      ) : null}

      {/* Empty state */}
      {webhooks.length === 0 ? (
        (() => {
          const c = iso(bx + bw / 2, by + bd / 2, bh + 0.5);
          return (
            <text
              x={c.x}
              y={c.y}
              textAnchor="middle"
              fontSize={11}
              fill="#8a6a48"
              opacity={0.7}
              fontStyle="italic"
            >
              (no tubes)
            </text>
          );
        })()
      ) : null}
    </Workstation>
  );
}

function Tube({
  x,
  y,
  baseZ,
  status,
}: {
  x: number;
  y: number;
  baseZ: number;
  status: 'running' | 'success' | 'error' | undefined;
}): JSX.Element {
  // Vertical tube: small footprint, tall height.
  const w = 0.18;
  const d = 0.18;
  const h = 1.3;
  const b = isoBoxPoints(x - w / 2, y - d / 2, w, d, h);
  const lift = baseZ * 58;
  const shift = (face: { x: number; y: number }[]): { x: number; y: number }[] =>
    face.map((pt) => ({ x: pt.x, y: pt.y - lift }));

  const color =
    status === 'error' ? '#704040' : status === 'success' ? '#a88a5a' : '#8a7050';
  const running = status === 'running';

  return (
    <g style={running ? flashStyle : undefined}>
      <polygon points={poly(...shift(b.leftFace))} fill="#3a2818" stroke="#1a110a" strokeWidth={0.5} />
      <polygon points={poly(...shift(b.rightFace))} fill={color} stroke="#1a110a" strokeWidth={0.5} />
      <polygon points={poly(...shift(b.topFace))} fill="#5a4838" stroke="#1a110a" strokeWidth={0.5} />
    </g>
  );
}

const flashStyle: React.CSSProperties = {
  animation: 'workshop-flash 0.8s ease-in-out infinite',
};
