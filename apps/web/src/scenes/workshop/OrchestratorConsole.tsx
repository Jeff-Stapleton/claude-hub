import type { OrchestratorState } from '../../types.js';
import { iso, isoBoxPoints, poly } from '../iso.js';
import { Workstation } from './Workstation.jsx';

/**
 * Front-left of the floor: an industrial-green machine with a glowing
 * screen on the front-right face. Screen color reflects orchestrator
 * status; an ACTIVE indicator blinks while channelSessions is non-empty.
 *
 * The room center is reserved for project machines, so this console sits
 * where the old projects bench used to live.
 */
export function OrchestratorConsole({
  state,
  onOpen,
}: {
  state: OrchestratorState;
  onOpen: () => void;
}): JSX.Element {
  const running = state.status === 'running';
  const error = state.status === 'error';
  const sessionsActive = Object.keys(state.channelSessions).length > 0;

  const bx = 1.1;
  const by = 1.45;
  const bw = 1.8;
  const bd = 1.45;
  const bh = 1.9;

  const { topFace, rightFace, leftFace } = isoBoxPoints(bx, by, bw, bd, bh);

  const screenFill = error ? '#3a1010' : running ? '#1a3020' : '#0e120e';
  const screenStroke = error ? '#cf4040' : running ? '#5ec27a' : '#5a5a5a';

  return (
    <Workstation label={`Orchestrator (${state.status})`} onActivate={onOpen}>
      {/* Machine body — painted industrial green */}
      <polygon points={poly(...leftFace)} fill="#2a361c" stroke="#0e1208" strokeWidth={1} />
      <polygon points={poly(...rightFace)} fill="#3a4a2a" stroke="#0e1208" strokeWidth={1} />
      <polygon points={poly(...topFace)} fill="#4a5e3a" stroke="#0e1208" strokeWidth={1.5} />

      {/* Glowing screen on the front-right face (the face at MIN Y) */}
      {(() => {
        const a = iso(bx + 0.25, by, 1.4);
        const b = iso(bx + bw - 0.25, by, 1.4);
        const c = iso(bx + bw - 0.25, by, 1.95);
        const d = iso(bx + 0.25, by, 1.95);
        return (
          <>
            <polygon points={poly(a, b, c, d)} fill={screenFill} stroke="#0a0a0a" strokeWidth={1.5} />
            <text
              x={(a.x + b.x) / 2}
              y={(a.y + d.y) / 2 + 3}
              textAnchor="middle"
              fontSize={11}
              fontFamily="monospace"
              fill={screenStroke}
              opacity={0.9}
            >
              ◀ {state.status.toUpperCase()} ▶
            </text>
          </>
        );
      })()}

      {/* Buttons on the front-right face, below screen */}
      {[0.35, 0.7, 1.05, 1.4, 1.75].map((xOffset) => {
        const c = iso(bx + xOffset, by, 0.95);
        return (
          <circle
            key={xOffset}
            cx={c.x}
            cy={c.y}
            r={5}
            fill="#5a3a22"
            stroke="#0e1208"
            strokeWidth={1}
          />
        );
      })}

      {/* Vent grille on the front-left face (the face at MIN X) */}
      {[0.4, 0.7, 1.0, 1.3, 1.6].map((yOffset) => {
        const a = iso(bx, by + yOffset, 0.5);
        const b = iso(bx, by + yOffset, 1.4);
        return (
          <line
            key={yOffset}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#1a2210"
            strokeWidth={2}
          />
        );
      })}

      {/* Top chimney/exhaust */}
      {(() => {
        const ch = isoBoxPoints(bx + 0.7, by + 0.7, 0.6, 0.6, 0.5);
        const lift = bh * 58;
        const shift = (face: { x: number; y: number }[]): { x: number; y: number }[] =>
          face.map((pt) => ({ x: pt.x, y: pt.y - lift }));
        return (
          <g>
            <polygon points={poly(...shift(ch.leftFace))} fill="#1a2210" />
            <polygon points={poly(...shift(ch.rightFace))} fill="#2a361c" />
            <polygon points={poly(...shift(ch.topFace))} fill="#3a4a2a" stroke="#0e1208" strokeWidth={1} />
          </g>
        );
      })()}

      {/* ACTIVE indicator floating above the chimney when sessions exist */}
      {sessionsActive ? (
        (() => {
          const c = iso(bx + bw / 2, by + bd / 2, bh + 0.95);
          return (
            <g>
              <circle cx={c.x} cy={c.y} r={7} fill="#e8b04a" style={blinkStyle} />
              <text
                x={c.x}
                y={c.y + 18}
                textAnchor="middle"
                fontSize={9}
                fill="#c8a888"
                fontFamily="monospace"
              >
                ACTIVE
              </text>
            </g>
          );
        })()
      ) : null}
    </Workstation>
  );
}

const blinkStyle: React.CSSProperties = {
  animation: 'workshop-blink 1.0s steps(2, end) infinite',
};
