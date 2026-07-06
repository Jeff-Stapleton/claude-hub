import { useEffect, useState } from 'react';

export type SceneId =
  | 'workshop'
  | 'channels'
  | 'triggers'
  | 'orchestrator'
  | 'activity';

const VALID: ReadonlySet<SceneId> = new Set<SceneId>([
  'workshop',
  'channels',
  'triggers',
  'orchestrator',
  'activity',
]);

interface SceneLocation {
  scene: SceneId;
  /** Optional scene parameter (`#<scene>/<param>`); unused today. */
  param?: string;
}

function readSceneFromHash(): SceneLocation {
  const raw = window.location.hash.slice(1);
  const slash = raw.indexOf('/');
  const head = slash >= 0 ? raw.slice(0, slash) : raw;
  // Unknown scenes (including retired `#line/<id>` links) fall back to
  // the workshop — every assembly line lives there now.
  return VALID.has(head as SceneId) ? { scene: head as SceneId } : { scene: 'workshop' };
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
  param: string | undefined;
  navigate: (next: SceneId, param?: string) => void;
} {
  const [location, setLocation] = useState<SceneLocation>(readSceneFromHash);

  useEffect(() => {
    const onChange = (): void => setLocation(readSceneFromHash());
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  const navigate = (next: SceneId, param?: string): void => {
    if (next === location.scene && param === location.param) return;
    const url =
      next === 'workshop'
        ? window.location.pathname
        : param !== undefined
          ? `#${next}/${encodeURIComponent(param)}`
          : `#${next}`;
    window.history.pushState({}, '', url);
    setLocation({ scene: next, ...(param !== undefined ? { param } : {}) });
  };

  return { scene: location.scene, param: location.param, navigate };
}
