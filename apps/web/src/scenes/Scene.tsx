import type { ReactNode } from 'react';

/**
 * Viewport-locked scene container. Maintains a fixed 16:9 inner stage that
 * fits the smaller dimension of the viewport, letterboxing the other axis
 * against the body background. The whole app lives inside one of these —
 * the workshop home scene OR a sub-screen — and never scrolls. Sub-screens
 * may internally scroll within their own content area; the stage itself
 * does not.
 *
 * `sceneKey` is used as the React key on the inner wrapper so changing
 * scenes unmounts/remounts and re-fires the CSS `scene-in` animation
 * declared in index.html.
 */
export function Scene({
  sceneKey,
  children,
}: {
  sceneKey: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div style={outer}>
      <div style={stage}>
        <div key={sceneKey} style={inner}>
          {children}
        </div>
      </div>
    </div>
  );
}

const outer: React.CSSProperties = {
  width: '100vw',
  height: '100vh',
  display: 'grid',
  placeItems: 'center',
  overflow: 'hidden',
  // Subtle vignette so the letterbox area reads as "outside the workshop"
  // rather than a blank gap. Real wood-floor texture lands with the
  // pixel-art assets in Phase 4.
  background:
    'radial-gradient(ellipse at center, #1a130d 0%, #0a0705 100%)',
};

const stage: React.CSSProperties = {
  // Fit a 16:9 rectangle inside the viewport without overflowing either
  // axis. `min()` picks whichever dimension constrains us.
  width: 'min(100vw, calc(100vh * 16 / 9))',
  height: 'min(100vh, calc(100vw * 9 / 16))',
  position: 'relative',
  boxShadow: '0 0 60px rgba(0, 0, 0, 0.6)',
  background: '#1f1610',
};

const inner: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  animation: 'scene-in 250ms ease-out',
};
