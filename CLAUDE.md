# ExcaliDash agent notes

## Rules

- Everything must stay compatible with standard Excalidraw: anything created in ExcaliDash has to copy-paste into excalidraw.com and work, with no custom data that breaks or gets lost.
- For canvas element changes, verify visually (render and look at a screenshot), not only with unit tests.

## Get to the canvas fast (cloud sessions)

One command installs missing deps (backend, frontend, e2e in parallel, ~25s cold), starts the no-auth dev stack, seeds a drawing, opens `/editor/<id>` in headless Chromium and saves a screenshot:

```bash
npm run canvas:shot                       # built-in sample scene
npm run canvas:shot -- scene.excalidraw   # any standard .excalidraw file
npm run canvas:shot -- scene.excalidraw --out /tmp/a.png --width 1600 --height 900
```

- Output PNG defaults to `.dev-local/canvas.png`; open it with the Read tool to inspect the render.
- Cold start is ~45s total; with the stack already running a shot takes ~7s. The stack is left running (log: `.dev-local/stack.log`), so re-run after each change; Vite hot-reloads frontend edits.
- Auth is disabled (`AUTH_MODE=disabled`), data lives in `.dev-local/` (`npm run dev:local:fresh` wipes it). `AWS_*` env vars are stripped so the backend does not abort on a half-configured S3.
- The page exposes `window.__EXCALIDASH_EXCALIDRAW_API__`; drive it from Playwright (`e2e/node_modules`) for interaction before screenshotting.
- Preinstalled Chromium at `/opt/pw-browsers` is used automatically; do not run `playwright install`.

## Other tests

- Frontend unit: `npm --prefix frontend run test:unit`
- Backend integration: `npm --prefix backend test`
- Browser e2e: `npm run test:e2e` (boots its own backend and frontend on ports 28000/26767)
