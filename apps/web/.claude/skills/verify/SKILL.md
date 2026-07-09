---
name: verify
description: Build, launch, and drive the claude-hub web app to verify changes at the browser surface.
---

# Verifying apps/web changes

## Launch

```powershell
pnpm --filter @claude-hub/web dev   # background; Vite prints the port
```

- Default port is 5173 but Vite auto-bumps (5174, ...) if the user already
  has a dev server running — always read the port from the Vite banner.
- The dev server proxies `/api` and `/ws` to the Fastify backend on :7878.
  If the user's own dev session is up, that backend serves your instance
  too and the workshop renders with real data; otherwise the app shows its
  error scene (MusicControl and other main.tsx-level UI still mount).

## Drive

No Playwright in the repo. Install a throwaway copy in the scratchpad
(`npm init -y; npm i playwright`), then `npx playwright install chromium`
once (browsers cache under `%LOCALAPPDATA%\ms-playwright`). Drive with a
plain node script using `chromium.launch()` + `page.goto`.

Gotchas learned the hard way:

- Headless Chromium **blocks WebAudio autoplay by default** — that is the
  realistic path for testing autoplay-unlock UX. Counterintuitively,
  passing `--autoplay-policy=user-gesture-required` made autoplay
  *allowed* in headless; don't rely on that flag, use the default launch
  for the blocked path.
- To prove audio is actually rendering, use CDP: `WebAudio.enable`,
  collect `WebAudio.contextCreated`, then poll
  `WebAudio.getRealtimeData({contextId})` — `currentTime` advancing means
  the context is live. There is no way to tap the app's audio graph.
- Console errors from `/api`/`/ws`/`WebSocket` are backend-absence noise;
  classify them out before judging "no console errors".
- Elements inside a `width: 0; overflow: hidden` wrapper still report a
  full-size `boundingBox()` — check the wrapper's computed width (or the
  element's x-shift) to assert expand/collapse, not the child's box.
- The workshop SVG has a long tab order; `locator.focus()` beats tabbing
  to reach chrome-level controls.
