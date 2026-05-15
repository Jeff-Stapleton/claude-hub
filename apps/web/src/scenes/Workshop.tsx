import type { UIState } from '../types.js';
import type { SceneId } from './useSceneRouter.js';
import { ChannelsRadio } from './workshop/ChannelsRadio.jsx';
import { CronWall } from './workshop/CronWall.jsx';
import { OrchestratorConsole } from './workshop/OrchestratorConsole.jsx';
import { ProjectsBench } from './workshop/ProjectsBench.jsx';
import { TimeCardWall } from './workshop/TimeCardWall.jsx';
import { WebhookMail } from './workshop/WebhookMail.jsx';

/**
 * Workshop home scene. SVG viewBox is 1600×900 (matches the 16:9 stage)
 * so all child workstations use the same coordinate system regardless of
 * actual viewport size.
 *
 * Layout is three horizontal bands:
 *   - y 100-420: back wall  → CronWall (left) + WebhookMail (right)
 *   - y 440-680: mid floor  → TimeCardWall, OrchestratorConsole, ChannelsRadio
 *   - y 700-870: foreground → ProjectsBench (full-width)
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
      {/* Room: back wall + floor. */}
      <Room />

      {/* Back wall workstations */}
      <CronWall triggers={state.triggers} onOpen={() => navigate('triggers')} />
      <WebhookMail triggers={state.triggers} onOpen={() => navigate('triggers')} />

      {/* Mid floor */}
      <TimeCardWall triggers={state.triggers} onOpen={() => navigate('activity')} />
      <OrchestratorConsole state={state.orchestrator} onOpen={() => navigate('orchestrator')} />
      <ChannelsRadio channels={state.channels} onOpen={() => navigate('channels')} />

      {/* Foreground */}
      <ProjectsBench projects={state.projects} onOpen={() => navigate('projects')} />

      {/* First-run hint — fades the moment anything is configured. */}
      {nothingConfigured ? (
        <text
          x={800}
          y={50}
          textAnchor="middle"
          fontSize={14}
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

/** Background room: a simple lit interior in primitive form. */
function Room(): JSX.Element {
  return (
    <g>
      {/* Far wall (full back) */}
      <rect x={0} y={0} width={1600} height={500} fill="#1f1610" />
      {/* Floor */}
      <rect x={0} y={500} width={1600} height={400} fill="#2a1d14" />
      {/* Floor plank lines */}
      {[600, 700, 800].map((y) => (
        <line key={y} x1={0} y1={y} x2={1600} y2={y} stroke="#1a110a" strokeWidth={1} opacity={0.6} />
      ))}
      {/* Warm vignette from an imagined lamp above the workbench. */}
      <radialGradient id="workshopLight" cx="0.5" cy="0.85" r="0.5">
        <stop offset="0%" stopColor="#ffd28a" stopOpacity={0.18} />
        <stop offset="60%" stopColor="#ffd28a" stopOpacity={0.05} />
        <stop offset="100%" stopColor="#ffd28a" stopOpacity={0} />
      </radialGradient>
      <rect x={0} y={0} width={1600} height={900} fill="url(#workshopLight)" pointerEvents="none" />
    </g>
  );
}
