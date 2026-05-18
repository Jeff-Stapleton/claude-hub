import type { UIState } from '../types.js';
import { FLOOR, iso, poly, WALL_H } from './iso.js';
import type { SceneId } from './useSceneRouter.js';
import { ChannelsRadio } from './workshop/ChannelsRadio.jsx';
import { CronWall } from './workshop/CronWall.jsx';
import { OrchestratorConsole } from './workshop/OrchestratorConsole.jsx';
import { ProjectsBench } from './workshop/ProjectsBench.jsx';
import { TimeCardWall } from './workshop/TimeCardWall.jsx';
import { WebhookMail } from './workshop/WebhookMail.jsx';

/**
 * Workshop home scene. The 16:9 stage hosts a true-isometric room with
 * a rhombus floor and two visible walls (back-left along y=FLOOR,
 * back-right along x=FLOOR), as if the front-left and front-right walls
 * were cut away so the viewer can see inside.
 *
 * Paint order is strict back-to-front so closer workstations occlude
 * farther ones cleanly.
 */
export function Workshop({
  state,
  navigate,
}: {
  state: UIState;
  navigate: (s: SceneId) => void;
}): JSX.Element {
  const nothingConfigured =
    state.projects.length === 0 &&
    state.triggers.length === 0 &&
    state.channels.length === 0 &&
    Object.keys(state.orchestrator.channelSessions).length === 0;

  return (
    <svg
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
      role="img"
      aria-label="claude-hub workshop"
    >
      {/* Lighting + glow gradient defs */}
      <defs>
        <radialGradient id="lampGlow" cx="0.5" cy="0.4" r="0.55">
          <stop offset="0%" stopColor="#ffd28a" stopOpacity={0.22} />
          <stop offset="55%" stopColor="#ffd28a" stopOpacity={0.06} />
          <stop offset="100%" stopColor="#ffd28a" stopOpacity={0} />
        </radialGradient>
        <linearGradient id="floorShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a2818" />
          <stop offset="100%" stopColor="#241810" />
        </linearGradient>
      </defs>

      {/* Room background: walls drawn first (farthest), then floor on top. */}
      <Walls />
      <Floor />

      {/* Wall-mounted workstations (sit on the back walls). */}
      <CronWall triggers={state.triggers} onOpen={() => navigate('triggers')} />
      <TimeCardWall triggers={state.triggers} onOpen={() => navigate('activity')} />

      {/* Floor workstations in back-to-front paint order. Back-most first. */}
      <WebhookMail triggers={state.triggers} onOpen={() => navigate('triggers')} />
      <OrchestratorConsole state={state.orchestrator} onOpen={() => navigate('orchestrator')} />
      <ChannelsRadio channels={state.channels} onOpen={() => navigate('channels')} />
      <ProjectsBench projects={state.projects} onOpen={() => navigate('projects')} />

      {/* Warm lamp glow overlay (non-interactive) */}
      <rect x={0} y={0} width={1600} height={900} fill="url(#lampGlow)" pointerEvents="none" />

      {nothingConfigured ? (
        <text
          x={800}
          y={60}
          textAnchor="middle"
          fontSize={13}
          fill="#c8a888"
          opacity={0.7}
          fontStyle="italic"
        >
          click any workstation to begin
        </text>
      ) : null}
    </svg>
  );
}

/** Floor rhombus + faint tile grid. */
function Floor(): JSX.Element {
  // Floor corners in world coords: F=front, R=back-right, B=back, L=back-left
  const F = iso(0, 0, 0);
  const R = iso(FLOOR, 0, 0);
  const B = iso(FLOOR, FLOOR, 0);
  const L = iso(0, FLOOR, 0);

  // Tile grid lines, 1 world unit apart. Drawn faintly so they suggest
  // floorboards or tiles without dominating.
  const lines: Array<{ a: ReturnType<typeof iso>; b: ReturnType<typeof iso> }> = [];
  for (let i = 1; i < FLOOR; i++) {
    // Lines parallel to the +X axis (constant Y)
    lines.push({ a: iso(0, i, 0), b: iso(FLOOR, i, 0) });
    // Lines parallel to the +Y axis (constant X)
    lines.push({ a: iso(i, 0, 0), b: iso(i, FLOOR, 0) });
  }

  return (
    <g>
      <polygon points={poly(F, R, B, L)} fill="url(#floorShade)" stroke="#1a110a" strokeWidth={2} />
      {lines.map((l, i) => (
        <line
          key={i}
          x1={l.a.x}
          y1={l.a.y}
          x2={l.b.x}
          y2={l.b.y}
          stroke="#1a110a"
          strokeWidth={0.6}
          opacity={0.55}
        />
      ))}
    </g>
  );
}

/** Back-left wall (y=FLOOR) and back-right wall (x=FLOOR). */
function Walls(): JSX.Element {
  // Back-left wall: from back-corner to back-left corner, rising WALL_H.
  const bl0 = iso(FLOOR, FLOOR, 0);
  const bl1 = iso(0, FLOOR, 0);
  const bl2 = iso(0, FLOOR, WALL_H);
  const bl3 = iso(FLOOR, FLOOR, WALL_H);

  // Back-right wall: from back-corner to back-right corner, rising WALL_H.
  const br0 = iso(FLOOR, FLOOR, 0);
  const br1 = iso(FLOOR, 0, 0);
  const br2 = iso(FLOOR, 0, WALL_H);
  const br3 = iso(FLOOR, FLOOR, WALL_H);

  return (
    <g>
      {/* Back-left wall — slightly darker (shadow side) */}
      <polygon points={poly(bl0, bl1, bl2, bl3)} fill="#1f1610" stroke="#0e0a06" strokeWidth={1.5} />
      {/* Plank lines on back-left wall */}
      {[1, 2].map((z) => {
        const a = iso(0, FLOOR, z);
        const b = iso(FLOOR, FLOOR, z);
        return <line key={`bl-${z}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e0a06" strokeWidth={1} opacity={0.7} />;
      })}

      {/* Back-right wall — slightly lighter (lit side) */}
      <polygon points={poly(br0, br1, br2, br3)} fill="#2a1d14" stroke="#0e0a06" strokeWidth={1.5} />
      {/* Plank lines on back-right wall */}
      {[1, 2].map((z) => {
        const a = iso(FLOOR, 0, z);
        const b = iso(FLOOR, FLOOR, z);
        return <line key={`br-${z}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e0a06" strokeWidth={1} opacity={0.7} />;
      })}

      {/* Corner seam where the two walls meet, slightly darker */}
      {(() => {
        const a = iso(FLOOR, FLOOR, 0);
        const b = iso(FLOOR, FLOOR, WALL_H);
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0a0805" strokeWidth={2} />;
      })()}
    </g>
  );
}
