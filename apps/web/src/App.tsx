import { useState } from 'react';
import { ActivityTab } from './tabs/ActivityTab.jsx';
import { ChannelsTab } from './tabs/ChannelsTab.jsx';
import { OrchestratorTab } from './tabs/OrchestratorTab.jsx';
import { ProjectsTab } from './tabs/ProjectsTab.jsx';
import { TriggersTab } from './tabs/TriggersTab.jsx';
import { useLiveState } from './useLiveState.js';

type TabId = 'projects' | 'channels' | 'triggers' | 'orchestrator' | 'activity';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'projects', label: 'Projects' },
  { id: 'channels', label: 'Channels' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'orchestrator', label: 'Orchestrator' },
  { id: 'activity', label: 'Activity' },
];

export function App(): JSX.Element {
  const [tab, setTab] = useState<TabId>('projects');
  const { data, isLoading, error } = useLiveState();

  if (isLoading) return <main style={main}>Loading…</main>;
  if (error) return <main style={main}>Error: {String(error)}</main>;
  if (!data) return <main style={main}>No data.</main>;

  return (
    <main style={main}>
      <header style={header}>
        <h1 style={{ margin: 0, fontSize: 20 }}>claude-hub</h1>
        <nav style={{ display: 'flex', gap: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                ...tabButton,
                ...(tab === t.id ? tabButtonActive : {}),
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div style={{ padding: 24 }}>
        {tab === 'projects' && <ProjectsTab projects={data.projects} />}
        {tab === 'channels' && <ChannelsTab channels={data.channels} />}
        {tab === 'triggers' && <TriggersTab triggers={data.triggers} projects={data.projects} />}
        {tab === 'orchestrator' && <OrchestratorTab state={data.orchestrator} />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </main>
  );
}

const main: React.CSSProperties = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  background: '#0a0a0a',
  color: '#eee',
  minHeight: '100vh',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 24px',
  borderBottom: '1px solid #222',
};

const tabButton: React.CSSProperties = {
  background: 'transparent',
  color: '#aaa',
  border: '1px solid transparent',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
};

const tabButtonActive: React.CSSProperties = {
  color: '#fff',
  borderColor: '#444',
  background: '#1a1a1a',
};
