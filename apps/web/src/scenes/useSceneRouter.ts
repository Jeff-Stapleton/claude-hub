import { useEffect, useState } from 'react';

export type SceneId =
  | 'workshop'
  | 'projects'
  | 'channels'
  | 'triggers'
  | 'orchestrator'
  | 'activity';

const VALID: ReadonlySet<SceneId> = new Set<SceneId>([
  'workshop',
  'projects',
  'channels',
  'triggers',
  'orchestrator',
  'activity',
]);

function readSceneFromHash(): SceneId {
  const raw = window.location.hash.slice(1);
  return VALID.has(raw as SceneId) ? (raw as SceneId) : 'workshop';
}

/**
 * Hash-based scene router. Hash-vs-path keeps us decoupled from any server
 * SPA-fallback config and avoids accidental conflicts with /api or
 * /triggers/webhooks/* on the same origin.
 *
 * `navigate` uses pushState so back/forward navigate between scenes; the
 * `hashchange` listener catches manual hash edits and reflects them in
 * React state.
 */
export function useSceneRouter(): {
  scene: SceneId;
  navigate: (next: SceneId) => void;
} {
  const [scene, setScene] = useState<SceneId>(readSceneFromHash);

  useEffect(() => {
    const onChange = (): void => setScene(readSceneFromHash());
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  const navigate = (next: SceneId): void => {
    if (next === scene) return;
    const url = next === 'workshop' ? window.location.pathname : `#${next}`;
    window.history.pushState({}, '', url);
    setScene(next);
  };

  return { scene, navigate };
}
