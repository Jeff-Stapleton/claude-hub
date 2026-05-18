import type { Channel } from '../../types.js';
import { iso, isoBoxPoints, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

/**
 * Right-front of the floor: a stand-up radio with an antenna rising from
 * the top. Status LED on the front face; when Discord is connected, the
 * antenna emits faint arcs.
 *
 * Footprint: world (7.5, 1.0) to (9.0, 2.5).
 */
export function ChannelsRadio({
  channels,
  onOpen,
}: {
  channels: Channel[];
  onOpen: () => void;
}): JSX.Element {
  const discord = channels.find((c) => c.type === 'discord');
  const status = discord?.status ?? 'disconnected';
  const connected = status === 'connected';
  const ledColor =
    status === 'connected' ? '#5ec27a' : status === 'error' ? '#cf4040' : '#5a5a5a';

  const bx = 7.5;
  const by = 1.0;
  const bw = 1.5;
  const bd = 1.5;
  const bh = 1.6;

  const { topFace, rightFace, leftFace } = isoBoxPoints(bx, by, bw, bd, bh);

  return (
    <Workstation label={`Discord channel (${status})`} onActivate={onOpen}>
      {/* Radio body */}
      <polygon points={poly(...leftFace)} fill="#34241a" stroke="#1a110a" strokeWidth={1} />
      <polygon points={poly(...rightFace)} fill="#4a3020" stroke="#1a110a" strokeWidth={1} />
      <polygon points={poly(...topFace)} fill="#5a3a22" stroke="#1a110a" strokeWidth={1.5} />

      {/* Screen panel on the front-right (MIN Y) face of the radio. */}
      {(() => {
        const a = iso(bx + 0.2, by, 1.0);
        const b = iso(bx + bw - 0.2, by, 1.0);
        const c = iso(bx + bw - 0.2, by, 1.35);
        const d = iso(bx + 0.2, by, 1.35);
        return (
          <polygon
            points={poly(a, b, c, d)}
            fill="#1a2018"
            stroke="#0a0e0a"
            strokeWidth={1}
          />
        );
      })()}

      {/* Status LED on the front-right face, lower section */}
      {(() => {
        const c = iso(bx + 0.35, by, 0.7);
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

      {/* Dial knobs on the front-right (MIN Y) face */}
      {[0.7, 1.1].map((dx) => {
        const c = iso(bx + dx, by, 0.55);
        return (
          <circle
            key={dx}
            cx={c.x}
            cy={c.y}
            r={5}
            fill="#5a3a22"
            stroke="#1a110a"
            strokeWidth={1}
          />
        );
      })}

      {/* Antenna pole rising from top center */}
      {(() => {
        const base = iso(bx + bw - 0.4, by + bd / 2, bh);
        const tip = iso(bx + bw - 0.4, by + bd / 2, bh + 1.7);
        return (
          <>
            <line
              x1={base.x}
              y1={base.y}
              x2={tip.x}
              y2={tip.y}
              stroke="#8a8a8a"
              strokeWidth={2.5}
            />
            <circle cx={tip.x} cy={tip.y} r={4} fill="#c8c8c8" stroke="#2a2a2a" strokeWidth={1} />
            {connected ? (
              <g style={arcStyle}>
                <path
                  d={`M ${tip.x - 22} ${tip.y + 6} A 22 16 0 0 1 ${tip.x + 22} ${tip.y + 6}`}
                  fill="none"
                  stroke="#5ec27a"
                  strokeWidth={1.5}
                  opacity={0.7}
                />
                <path
                  d={`M ${tip.x - 36} ${tip.y + 14} A 36 26 0 0 1 ${tip.x + 36} ${tip.y + 14}`}
                  fill="none"
                  stroke="#5ec27a"
                  strokeWidth={1.2}
                  opacity={0.45}
                />
              </g>
            ) : null}
          </>
        );
      })()}

      {/* Status text label */}
      {(() => {
        const c = iso(bx + bw / 2, by + bd / 2, bh + 0.45);
        return (
          <text
            x={c.x}
            y={c.y}
            textAnchor="middle"
            fontSize={10}
            fontFamily="monospace"
            fill="#c8a888"
            opacity={0.8}
          >
            {status}
          </text>
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
