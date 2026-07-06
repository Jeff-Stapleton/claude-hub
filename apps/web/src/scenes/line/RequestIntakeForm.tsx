import { useState } from 'react';
import * as s from './panelStyles.js';

/**
 * The manual "feed the line" form: a title + request that becomes a work
 * item at the head of the assembly line.
 */
export function RequestIntakeForm({
  isPending,
  error,
  onSubmit,
}: {
  isPending: boolean;
  error: unknown;
  onSubmit: (input: { request: string; title?: string }) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');

  return (
    <foreignObject x={28} y={648} width={470} height={224}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!request.trim()) return;
          onSubmit({
            request: request.trim(),
            ...(title.trim() ? { title: title.trim() } : {}),
          });
          setTitle('');
          setRequest('');
        }}
        style={s.panel}
      >
        <div style={s.panelTitle}>New work request</div>
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
        <button type="submit" disabled={isPending || !request.trim()} style={s.panelButton}>
          {isPending ? 'Feeding the line…' : 'Send down the line'}
        </button>
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </form>
    </foreignObject>
  );
}
