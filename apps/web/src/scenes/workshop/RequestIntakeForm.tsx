import { useState } from 'react';
import * as s from './panelStyles.js';

/**
 * The "feed the line" form for one project, shown in the top-left panel
 * dock when the project's head machine is clicked. Submitting is blocked
 * while the lane has no installed machines — the item would run straight
 * through doing nothing (and the server rejects it anyway).
 */
export function RequestIntakeForm({
  projectLabel,
  noMachines,
  isPending,
  error,
  onSubmit,
  onClose,
}: {
  projectLabel: string;
  noMachines: boolean;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: { request: string; title?: string }) => void;
  onClose: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');

  return (
    <foreignObject x={28} y={90} width={470} height={280}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (noMachines || !request.trim()) return;
          onSubmit({
            request: request.trim(),
            ...(title.trim() ? { title: title.trim() } : {}),
          });
          setTitle('');
          setRequest('');
        }}
        style={s.panel}
      >
        <div style={s.panelTitle}>
          <span>
            {projectLabel} <span style={s.panelHint}>— new work request</span>
          </span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>
        <input
          placeholder="Title (optional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          style={s.panelInput}
        />
        <textarea
          placeholder="Describe the feature, fix, or change to build…"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          style={{ ...s.panelTextarea, flex: 1 }}
          rows={3}
        />
        <button type="submit" disabled={isPending || noMachines || !request.trim()} style={s.panelButton}>
          {isPending ? 'Feeding the line…' : 'Send down the line'}
        </button>
        {noMachines ? (
          <div style={s.panelHint}>
            this line has no machines — hover the belt and click a ghost slot to install one first
          </div>
        ) : null}
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </form>
    </foreignObject>
  );
}

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};
