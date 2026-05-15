import type { ReactNode } from 'react';
import { Scene } from './scenes/Scene.jsx';
import { useSceneRouter } from './scenes/useSceneRouter.js';
import { Workshop } from './scenes/Workshop.jsx';
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
      {scene === 'workshop' && <Workshop state={data} navigate={navigate} />}
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
