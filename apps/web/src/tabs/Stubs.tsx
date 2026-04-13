import type { Channel, OrchestratorState } from '../types.js';

/**
 * Placeholder tabs for features not yet implemented.
 *
 * Each displays whatever UIState slice is already available — so e.g. the
 * Triggers tab shows the empty list today and will grow into a full UI in
 * later steps without structural changes to App.tsx.
 */

export function ChannelsTab({ channels }: { channels: Channel[] }): JSX.Element {
  return (
    <section>
      <h2>Channels</h2>
      <p style={{ opacity: 0.7 }}>
        Discord adapter is not implemented yet. Registered channel configs will appear here.
      </p>
      <pre style={pre}>{JSON.stringify(channels, null, 2)}</pre>
    </section>
  );
}

export function OrchestratorTab({ state }: { state: OrchestratorState }): JSX.Element {
  return (
    <section>
      <h2>Orchestrator</h2>
      <p style={{ opacity: 0.7 }}>Long-lived CC session manager. Not implemented yet.</p>
      <pre style={pre}>{JSON.stringify(state, null, 2)}</pre>
    </section>
  );
}

export function ActivityTab(): JSX.Element {
  return (
    <section>
      <h2>Activity</h2>
      <p style={{ opacity: 0.7 }}>
        Unified channel messages + trigger runs stream will appear here once channels and
        triggers are wired up.
      </p>
    </section>
  );
}

const pre: React.CSSProperties = {
  background: '#111',
  color: '#ddd',
  padding: 12,
  borderRadius: 4,
  overflow: 'auto',
};
