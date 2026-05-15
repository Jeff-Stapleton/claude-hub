import type { OrchestratorState } from '../../types.js';
import { Workstation } from './Workstation.jsx';

/**
 * Mid-floor centerpiece: the orchestrator's control console. The screen
 * brightness reflects orchestrator status; a blinking indicator shows
 * whether any conversation is mid-flight.
 */
export function OrchestratorConsole({
  state,
  onOpen,
}: {
  state: OrchestratorState;
  onOpen: () => void;
}): JSX.Element {
  const baseX = 540;
  const baseY = 470;
  const baseW = 520;
  const baseH = 220;

  const running = state.status === 'running';
  const error = state.status === 'error';
  const screenFill = error ? '#3a1010' : running ? '#1a3020' : '#0e120e';
  const screenGlow = running ? 0.6 : error ? 0.4 : 0.15;
  const sessionsActive = Object.keys(state.channelSessions).length > 0;

  return (
    <Workstation
      x={500}
      y={440}
      width={600}
      height={240}
      label={`Orchestrator (${state.status})`}
      onActivate={onOpen}
    >
      {/* Console base */}
      <rect
        x={baseX}
        y={baseY + 80}
        width={baseW}
        height={baseH - 80}
        fill="#3a2818"
        stroke="#1a110a"
        strokeWidth={2}
      />
      {/* Sloped front panel */}
      <polygon
        points={`${baseX},${baseY + 80} ${baseX + baseW},${baseY + 80} ${baseX + baseW - 30},${baseY} ${baseX + 30},${baseY}`}
        fill="#4a3220"
        stroke="#1a110a"
        strokeWidth={2}
      />
      {/* Screen */}
      <rect
        x={baseX + 60}
        y={baseY + 14}
        width={baseW - 120}
        height={56}
        fill={screenFill}
        stroke="#0a0a0a"
        strokeWidth={1.5}
      />
      {/* Screen glow */}
      <rect
        x={baseX + 60}
        y={baseY + 14}
        width={baseW - 120}
        height={56}
        fill={running ? '#5ec27a' : error ? '#cf4040' : '#5a5a5a'}
        opacity={screenGlow * 0.25}
      />
      {/* Scanline text on the screen — pretend status readout */}
      <text
        x={baseX + baseW / 2}
        y={baseY + 46}
        textAnchor="middle"
        fontSize={14}
        fontFamily="monospace"
        fill={running ? '#5ec27a' : error ? '#e88888' : '#888888'}
        opacity={0.85}
      >
        ◀ {state.status.toUpperCase()} ▶
      </text>

      {/* Row of buttons / dials on the body */}
      {[0, 1, 2, 3].map((i) => (
        <circle
          key={i}
          cx={baseX + 60 + i * 50}
          cy={baseY + 130}
          r={9}
          fill="#5a3a22"
          stroke="#1a110a"
          strokeWidth={1.5}
        />
      ))}

      {/* Session-active blinking indicator */}
      {sessionsActive ? (
        <g>
          <circle
            cx={baseX + baseW - 40}
            cy={baseY + 130}
            r={8}
            fill="#e8b04a"
            style={blinkStyle}
          />
          <text
            x={baseX + baseW - 40}
            y={baseY + 162}
            textAnchor="middle"
            fontSize={10}
            fill="#c8a888"
            fontFamily="monospace"
          >
            ACTIVE
          </text>
        </g>
      ) : null}
    </Workstation>
  );
}

const blinkStyle: React.CSSProperties = {
  animation: 'workshop-blink 1.0s steps(2, end) infinite',
};
