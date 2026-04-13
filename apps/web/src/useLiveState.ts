import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api.js';
import type { UIState } from './types.js';

const STATE_KEY = ['state'] as const;

/**
 * Pulls UIState via react-query, then opens a WS connection and pushes each
 * received {type: "state"} frame straight into the query cache. The result:
 * components re-render as soon as the server observes a change.
 *
 * Reconnect logic is intentionally minimal — the dev server proxies WS and
 * the prod server is loopback; disconnects are rare.
 */
export function useLiveState(): ReturnType<typeof useQuery<UIState>> {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: STATE_KEY, queryFn: api.getState });

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as { type?: string; payload?: UIState };
        if (msg.type === 'state' && msg.payload) {
          qc.setQueryData(STATE_KEY, msg.payload);
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => ws.close();
  }, [qc]);

  return q;
}
