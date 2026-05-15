import type { ReactNode } from 'react';
import { Scene } from './scenes/Scene.jsx';
import { useSceneRouter, type SceneId } from './scenes/useSceneRouter.js';
import { ActivityTab } from './tabs/ActivityTab.jsx';
import { ChannelsTab } from './tabs/ChannelsTab.jsx';
import { OrchestratorTab } from './tabs/OrchestratorTab.jsx';
import { ProjectsTab } from './tabs/ProjectsTab.jsx';
import { TriggersTab } from './tabs/TriggersTab.jsx';
import { useLiveState } from './useLiveState.js';

/**
 * Phase 1 of the workshop redesign — viewport-locked single-scene shell.
 *
 * The workshop scene itself is still a placeholder (Phase 2 replaces it
 * with the illustrated workstation layout). Sub-screens wrap the existing
 * per-tab components unchanged so we can prove navigation end-to-end
 * without yet touching any mutation logic.
 */
export function App(): JSX.Element {
  const { scene, navigate } = useSceneRouter();
  const { data, isLoading, error } = useLiveState();

  if (isLoading) {
    return (
      <Scene sceneKey="loading">
        <Centered>Loading…</Centered>
      </Scene>
    );
  }
  if (error) {
    return (
      <Scene sceneKey="error">
        <Centered>Error: {String(error)}</Centered>
      </Scene>
    );
  }
  if (!data) {
    return (
      <Scene sceneKey="empty">
        <Centered>No data.</Centered>
      </Scene>
    );
  }

  return (
    <Scene sceneKey={scene}>
      {scene === 'workshop' && <WorkshopPlaceholder navigate={navigate} />}
      {scene === 'projects' && (
        <SubScreen title="Projects" onBack={() => navigate('workshop')}>
          <ProjectsTab projects={data.projects} />
        </SubScreen>
      )}
      {scene === 'channels' && (
        <SubScreen title="Channels" onBack={() => navigate('workshop')}>
          <ChannelsTab channels={data.channels} />
        </SubScreen>
      )}
      {scene === 'triggers' && (
        <SubScreen title="Triggers" onBack={() => navigate('workshop')}>
          <TriggersTab triggers={data.triggers} projects={data.projects} />
        </SubScreen>
      )}
      {scene === 'orchestrator' && (
        <SubScreen title="Orchestrator" onBack={() => navigate('workshop')}>
          <OrchestratorTab state={data.orchestrator} />
        </SubScreen>
      )}
      {scene === 'activity' && (
        <SubScreen title="Activity" onBack={() => navigate('workshop')}>
          <ActivityTab />
        </SubScreen>
      )}
    </Scene>
  );
}

function WorkshopPlaceholder({
  navigate,
}: {
  navigate: (s: SceneId) => void;
}): JSX.Element {
  // Five rectangular hotspots in approximate isometric positions, ready
  // for Phase 2 to replace with real workstations. The layout grid is
  // intentionally rough — Phase 2 places each at its illustrated anchor.
  const stations: Array<{ id: SceneId; label: string; pos: React.CSSProperties }> = [
    { id: 'projects', label: 'Projects bench', pos: { top: '40%', left: '10%' } },
    { id: 'triggers', label: 'Triggers (clocks + mail)', pos: { top: '15%', left: '38%' } },
    { id: 'orchestrator', label: 'Orchestrator console', pos: { top: '45%', left: '40%' } },
    { id: 'channels', label: 'Channels radio', pos: { top: '20%', left: '68%' } },
    { id: 'activity', label: 'Time card wall', pos: { top: '55%', left: '70%' } },
  ];

  return (
    <div style={workshopRoot}>
      <div style={workshopTitle}>claude-hub workshop</div>
      <div style={workshopHint}>(placeholder — click a station)</div>
      {stations.map((s) => (
        <button
          key={s.id}
          onClick={() => navigate(s.id)}
          style={{ ...station, ...s.pos }}
          aria-label={s.label}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function SubScreen({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={subScreenRoot}>
      <header style={subScreenHeader}>
        <button onClick={onBack} style={backButton} aria-label="Back to workshop">
          ← Workshop
        </button>
        <h1 style={subScreenTitle}>{title}</h1>
      </header>
      <div style={subScreenBody}>{children}</div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return <div style={centered}>{children}</div>;
}

// ---------- styles ----------

const centered: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  fontSize: 14,
  opacity: 0.7,
};

const workshopRoot: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  // Placeholder backdrop. Phase 2 swaps in the isometric room.
  background:
    'linear-gradient(180deg, #2a1d14 0%, #1f1610 50%, #15100c 100%)',
};

const workshopTitle: React.CSSProperties = {
  position: 'absolute',
  top: '4%',
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: 1,
  color: '#e8d6b0',
  opacity: 0.85,
};

const workshopHint: React.CSSProperties = {
  position: 'absolute',
  top: '11%',
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 12,
  color: '#c8a888',
  opacity: 0.55,
};

const station: React.CSSProperties = {
  position: 'absolute',
  width: '22%',
  height: '20%',
  padding: 0,
  background: 'rgba(80, 56, 36, 0.4)',
  color: '#f3e0bd',
  border: '1.5px dashed #6b4d2e',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};

const subScreenRoot: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#15100c',
  color: '#eee',
};

const subScreenHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '10px 20px',
  borderBottom: '1px solid #2a1f17',
  flexShrink: 0,
};

const subScreenTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 500,
};

const backButton: React.CSSProperties = {
  background: 'transparent',
  color: '#c8a888',
  border: '1px solid #4a3624',
  padding: '4px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const subScreenBody: React.CSSProperties = {
  flex: 1,
  padding: '16px 24px',
  // Sub-screen content (long tables/lists) may exceed the 16:9 stage.
  // The stage itself never scrolls; internal overflow scrolls here.
  overflow: 'auto',
};
