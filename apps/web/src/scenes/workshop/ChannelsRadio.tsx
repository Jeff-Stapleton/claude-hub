import type { Channel } from '../../types.js';
import { iso, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

/**
 * Compact comms box mounted high on the back-left wall (y = wallY), beside
 * the clock wall and activity plaque. Status LED shows Discord health; when
 * connected, a tiny antenna emits faint arcs.
 */
export function ChannelsRadio({
  channels,
  wallY,
  xEnd,
  onOpen,
}: {
  channels: Channel[];
  /** Depth of the back-left wall (the room's floor depth). */
  wallY: number;
  /** Right edge of the box along the wall. */
  xEnd: number;
  onOpen: () => void;
}): JSX.Element {
  const discord = channels.find((c) => c.type === 'discord');
  const status = discord?.status ?? 'disconnected';
  const connected = status === 'connected';
  const ledColor =
    status === 'connected' ? '#5ec27a' : status === 'error' ? '#cf4040' : '#5a5a5a';

  const xs = xEnd - 2.3;
  const xe = xEnd;
  const zs = 1.55;
  const ze = 2.55;

  const bl = iso(xs, wallY, zs);
  const br = iso(xe, wallY, zs);
  const tr = iso(xe, wallY, ze);
  const tl = iso(xs, wallY, ze);

  return (
    <Workstation label={`Discord channel (${status})`} onActivate={onOpen}>
      {/* Wall-mounted comms box */}
      <polygon points={poly(bl, br, tr, tl)} fill="#2b2118" stroke="#1a110a" strokeWidth={1.5} />
      <polygon
        points={poly(
          iso(xs + 0.12, wallY, zs + 0.12),
          iso(xe - 0.12, wallY, zs + 0.12),
          iso(xe - 0.12, wallY, ze - 0.12),
          iso(xs + 0.12, wallY, ze - 0.12),
        )}
        fill="none"
        stroke="#5a3a22"
        strokeWidth={1}
      />

      {/* Small glass status screen */}
      {(() => {
        const a = iso(xs + 0.38, wallY, zs + 0.38);
        const b = iso(xe - 0.36, wallY, zs + 0.38);
        const c = iso(xe - 0.36, wallY, zs + 0.68);
        const d = iso(xs + 0.38, wallY, zs + 0.68);
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
        const c = iso(xs + 0.42, wallY, zs + 0.22);
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

      {[1.05, 1.42].map((xOffset) => {
        const c = iso(xs + xOffset, wallY, zs + 0.22);
        return (
          <circle
            key={xOffset}
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
        const base = iso(xs + 1.75, wallY, ze);
        const tip = iso(xs + 1.75, wallY, ze + 0.42);
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
        const title = iso((xs + xe) / 2, wallY, ze - 0.22);
        const label = iso((xs + xe) / 2, wallY, zs + 0.53);
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
