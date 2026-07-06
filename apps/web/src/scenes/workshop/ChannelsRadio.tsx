import type { Channel } from '../../types.js';
import { iso, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

/**
 * Compact comms box mounted high on the back-right wall. Status LED shows
 * Discord health; when connected, a tiny antenna emits faint arcs.
 */
export function ChannelsRadio({
  channels,
  wallX,
  onOpen,
}: {
  channels: Channel[];
  /** Width of the back-right wall (the room's floor width). */
  wallX: number;
  onOpen: () => void;
}): JSX.Element {
  const discord = channels.find((c) => c.type === 'discord');
  const status = discord?.status ?? 'disconnected';
  const connected = status === 'connected';
  const ledColor =
    status === 'connected' ? '#5ec27a' : status === 'error' ? '#cf4040' : '#5a5a5a';

  const ys = 1.15;
  const ye = 3.45;
  const zs = 1.55;
  const ze = 2.55;

  const bl = iso(wallX, ys, zs);
  const br = iso(wallX, ye, zs);
  const tr = iso(wallX, ye, ze);
  const tl = iso(wallX, ys, ze);

  return (
    <Workstation label={`Discord channel (${status})`} onActivate={onOpen}>
      {/* Wall-mounted comms box */}
      <polygon points={poly(bl, br, tr, tl)} fill="#2b2118" stroke="#1a110a" strokeWidth={1.5} />
      <polygon
        points={poly(
          iso(wallX, ys + 0.12, zs + 0.12),
          iso(wallX, ye - 0.12, zs + 0.12),
          iso(wallX, ye - 0.12, ze - 0.12),
          iso(wallX, ys + 0.12, ze - 0.12),
        )}
        fill="none"
        stroke="#5a3a22"
        strokeWidth={1}
      />

      {/* Small glass status screen */}
      {(() => {
        const a = iso(wallX, ys + 0.38, zs + 0.38);
        const b = iso(wallX, ye - 0.36, zs + 0.38);
        const c = iso(wallX, ye - 0.36, zs + 0.68);
        const d = iso(wallX, ys + 0.38, zs + 0.68);
        return (
          <polygon
            points={poly(a, b, c, d)}
            fill="#1a2018"
            stroke="#0a0e0a"
            strokeWidth={1}
          />
        );
      })()}

      {/* Status LED and tuning knobs */}
      {(() => {
        const c = iso(wallX, ys + 0.42, zs + 0.22);
        return (
          <circle
            cx={c.x}
            cy={c.y}
            r={6}
            fill={ledColor}
            stroke="#1a110a"
            strokeWidth={1}
            style={connected ? ledPulseStyle : undefined}
          />
        );
      })()}

      {[1.05, 1.42].map((yOffset) => {
        const c = iso(wallX, ys + yOffset, zs + 0.22);
        return (
          <circle
            key={yOffset}
            cx={c.x}
            cy={c.y}
            r={4}
            fill="#5a3a22"
            stroke="#1a110a"
            strokeWidth={1}
          />
        );
      })}

      {/* Short antenna fixed above the box */}
      {(() => {
        const base = iso(wallX, ys + 1.75, ze);
        const tip = iso(wallX, ys + 1.75, ze + 0.42);
        return (
          <>
            <line
              x1={base.x}
              y1={base.y}
              x2={tip.x}
              y2={tip.y}
              stroke="#8a8a8a"
              strokeWidth={1.8}
            />
            <circle cx={tip.x} cy={tip.y} r={3} fill="#c8c8c8" stroke="#2a2a2a" strokeWidth={1} />
            {connected ? (
              <g style={arcStyle}>
                <path
                  d={`M ${tip.x - 17} ${tip.y + 5} A 17 12 0 0 1 ${tip.x + 17} ${tip.y + 5}`}
                  fill="none"
                  stroke="#5ec27a"
                  strokeWidth={1.2}
                  opacity={0.7}
                />
                <path
                  d={`M ${tip.x - 28} ${tip.y + 12} A 28 20 0 0 1 ${tip.x + 28} ${tip.y + 12}`}
                  fill="none"
                  stroke="#5ec27a"
                  strokeWidth={1}
                  opacity={0.45}
                />
              </g>
            ) : null}
          </>
        );
      })()}

      {(() => {
        const title = iso(wallX, (ys + ye) / 2, ze - 0.22);
        const label = iso(wallX, (ys + ye) / 2, zs + 0.53);
        return (
          <>
            <text
              x={title.x}
              y={title.y}
              textAnchor="middle"
              fontSize={9}
              fontFamily="monospace"
              fill="#c8a888"
              opacity={0.9}
            >
              CHANNELS
            </text>
            <text
              x={label.x}
              y={label.y}
              textAnchor="middle"
              fontSize={8}
              fontFamily="monospace"
              fill="#c8a888"
              opacity={0.8}
            >
              {status}
            </text>
          </>
        );
      })()}
    </Workstation>
  );
}

const arcStyle: React.CSSProperties = {
  transformOrigin: 'center',
  animation: 'workshop-arc 2.5s ease-out infinite',
};

const ledPulseStyle: React.CSSProperties = {
  animation: 'workshop-led 1.8s ease-in-out infinite',
};
