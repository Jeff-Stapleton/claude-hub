import type { Channel } from '../../types.js';
import { Workstation } from './Workstation.jsx';

/**
 * Mid-right floor: a rack-mounted radio with an antenna. The LED on the
 * front shows Discord connection status; when connected, the antenna
 * radiates faint arcs to convey "listening".
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

  // Radio base box.
  const baseX = 1180;
  const baseY = 540;
  const baseW = 280;
  const baseH = 130;

  // Antenna anchored on top of the box.
  const antennaX = baseX + baseW - 50;
  const antennaTop = baseY - 180;

  return (
    <Workstation
      x={1150}
      y={440}
      width={350}
      height={240}
      label={`Discord channel (${status})`}
      onActivate={onOpen}
    >
      {/* Antenna pole */}
      <line
        x1={antennaX}
        y1={baseY + 4}
        x2={antennaX}
        y2={antennaTop}
        stroke="#8a8a8a"
        strokeWidth={3}
      />
      <circle cx={antennaX} cy={antennaTop} r={5} fill="#c8c8c8" stroke="#2a2a2a" strokeWidth={1} />

      {/* Radiating arcs when connected (CSS-animated). */}
      {connected ? (
        <g style={arcStyle}>
          <path
            d={`M ${antennaX - 30} ${antennaTop + 10} A 30 22 0 0 1 ${antennaX + 30} ${antennaTop + 10}`}
            fill="none"
            stroke="#5ec27a"
            strokeWidth={1.5}
            opacity={0.6}
          />
          <path
            d={`M ${antennaX - 50} ${antennaTop + 20} A 50 36 0 0 1 ${antennaX + 50} ${antennaTop + 20}`}
            fill="none"
            stroke="#5ec27a"
            strokeWidth={1.2}
            opacity={0.4}
          />
        </g>
      ) : null}

      {/* Radio body */}
      <rect
        x={baseX}
        y={baseY}
        width={baseW}
        height={baseH}
        rx={6}
        fill="#3a2818"
        stroke="#1a110a"
        strokeWidth={2}
      />
      {/* Screen panel */}
      <rect
        x={baseX + 16}
        y={baseY + 16}
        width={baseW - 32}
        height={50}
        fill="#1a2018"
        stroke="#0a0e0a"
        strokeWidth={1}
      />
      {/* Status LED */}
      <circle
        cx={baseX + 26}
        cy={baseY + 90}
        r={8}
        fill={ledColor}
        stroke="#1a110a"
        strokeWidth={1.5}
        style={connected ? ledPulseStyle : undefined}
      />
      <text
        x={baseX + 42}
        y={baseY + 95}
        fontSize={13}
        fill="#c8a888"
        fontFamily="monospace"
      >
        {status}
      </text>

      {/* Dial knobs for character */}
      <circle cx={baseX + baseW - 50} cy={baseY + 95} r={10} fill="#5a3a22" stroke="#1a110a" strokeWidth={1.5} />
      <circle cx={baseX + baseW - 20} cy={baseY + 95} r={10} fill="#5a3a22" stroke="#1a110a" strokeWidth={1.5} />
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
