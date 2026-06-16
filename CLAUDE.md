# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**레이저 리플렉트 (Laser Reflect)** — a 2D laser-reflection puzzle game for electronic whiteboards (전자칠판), played as a two-team competition. Players rotate mirrors to bend a laser beam to a target across a grid past obstacles. The game runs as a single-page `<canvas>` app embedded in an iframe on a hosting platform (the parent communicates via `postMessage`).

The source of truth for game design is `기획안.md` (Korean planning doc). All gameplay/UI text is Korean.

## Source layout & build

The shippable app lives entirely in `app/`. Everything else at the repo root (`_unzipped/`, root `*.png`, the `.zip`, `x-upload-workflow-for-cli-llm.md`) is scratch/reference material.

- **`app/main.js` is generated — never edit it by hand.** It is an esbuild ESM bundle of the three TS entry points. `main.js.bak` is a stale backup; ignore it.
- Edit the TypeScript sources: `main.ts`, `app.ts`, `appHelper.ts` (the `tsconfig.json` `include` list).
- There is no `package.json` / `node_modules` in-repo; tooling runs via `npx` (note `.claude/settings.local.json` pre-allows `Bash(rtk npx *)`).
- Rebuild after editing TS: bundle `main.ts` to ESM with dependencies kept **external** (they are resolved at runtime by the import map in `index.html`), e.g.
  ```
  npx esbuild app/main.ts --bundle --format=esm --outfile=app/main.js --packages=external
  ```
- To run locally you need a static server (the app `fetch`es `data.json`), e.g. `npx serve app` or `python3 -m http.server` from `app/`, then open `index.html`.
- `tsconfig.json` is intentionally loose (`strict: false`, `strictNullChecks: false`) but `noImplicitAny: true`.

## Runtime dependencies

CDN libraries are declared in the `<script type="importmap">` block of `index.html` (three, cannon-es, howler, tone, gsap, mathjs, canvas-confetti, html-to-image). **Any new bare import in TS must be added to that import map** or it will fail in the browser, since esbuild leaves these imports unresolved. In practice only `html-to-image` (capture) and `canvas-confetti` (results screen) are currently imported.

## Architecture

Four files, layered host → bootstrap → helpers → game:

- **`index.html`** — the host shell. Contains an inline error-collection harness that batches runtime/console errors and forwards them to the parent window via `postMessage` (`source: "typingx-x-iframe"`), patches `canvas.getContext` to force `preserveDrawingBuffer` (for thumbnail capture), and holds the import map. The DOM is just `#appContainer > #appCanvas + #uiLayer`.

- **`main.ts`** — bootstrap + platform/host integration, **not game logic**:
  - Responsive scaling: treats the canvas's first non-1×1 size as the *logical resolution*, then scales `#appContainer` and `#uiLayer` to fit the viewport (letterboxing). Driven by a `ResizeObserver` + `resize`.
  - The parent↔iframe protocol: listens for messages from `source: "alparka-parent"` and answers `ping`→`pong` (heartbeat), `request-canvas-capture`→`canvas-capture` (thumbnail), `request-app-resolution`→`app-resolution`. Replies always tag `source: "typingx-x-iframe"`.
  - Calls `initApp()` on `DOMContentLoaded`.

- **`appHelper.ts`** — `AppHelper`, a static-method utility class:
  - Loads `data.json` and splits it into `appData` / `textData` / `assetList`. `loadTextData` implements the optional multi-language scheme (`default_language`, `supported_multiple_languages`, `?lang=` query param).
  - `getRelativeCoordinates(clientX, clientY, canvas)` — **use this for every pointer/touch coordinate**; it converts client coords into logical canvas coords accounting for the display scale.
  - `createUIElement(...)` sanitizes `textContent` through `sanitizeText` (XSS guard) before assigning `innerHTML`. Canvas text is drawn directly and is not sanitized.
  - `captureCanvasAsDataUrl` / `captureCanvasAsImage` — used by both the host capture protocol and any in-game image use.

- **`app.ts`** — the whole game (~3300 lines), conventionally ordered: type defs → constants → laser/trace + stage-gen engine → render/draw helpers → screen renderers → input handlers → main loop. Key pieces:
  - Fixed logical canvas `1280×800` (`LOGICAL_W`/`LOGICAL_H`); all drawing is in this space.
  - **Laser engine**: `Dir` (R/L/U/D) and mirror `Ori` (`/ \ | -`). `REFLECT`/`DELTA` tables drive `traceLaser(stage, moverCells)`, which walks the beam cell-by-cell and returns a `TraceResult` (perfect/partial/fail + reason).
  - **Procedural stages**: `generateStage`/`tryBuild`/`stageParams` build solvable boards from per-difficulty params in `data.json` (`EASY`/`NORMAL` rotate in 90° steps; `HARD` adds 45° rotation and moving obstacles).
  - **Screen flow**: `screen: Screen` is the state machine — `title → (intro → predict → manipulate → fire → result) × 6 → final`. `gameLoop` = `update(now)` + `render(now)` on `requestAnimationFrame`. `initApp` loads data, wires canvas pointer/wheel/keyboard listeners (keyboard registered in capture phase so the host iframe can't swallow keys), force-loads the Korean font, then starts the loop.
  - **`Sfx` is currently a no-op stub and `assetList.sounds` is empty** — audio is wired up structurally but disabled, even though `.mp3` files exist in `assets/`. Re-enabling sound means implementing `Sfx` (e.g. via howler) and populating `assetList`.

## Title-screen editor (dev tool, not player-facing)

`app.ts` embeds a layout editor for the title screen, gated by `editMode`. It supports selecting/dragging/resizing/rotating the title art items (`TitleLayoutItem[]`), z-ordering, and keyboard shortcuts (arrows nudge, `[`/`]` scale, `O`/`P` rotate, `Q/A/Z/X` z-order, `D` duplicate, `Delete` remove, `S` downloads `layout.json`, `R` resets to `DEFAULT_TITLE_LAYOUT`). Layout is loaded at startup from `assets/title/layout.json` (with `.bak*` snapshots beside it). When changing title visuals, edit via this editor and re-export rather than hand-editing coordinates.

## Data & assets

- **`app/data.json`** is the runtime config: `appData` (rounds, teams, scoring, per-difficulty params), `textData.ko` (all UI strings), `assetList`. Tuning difficulty/text/teams happens here, not in code.
- **`app/assets/`** holds gameplay sprites/audio; `assets/title/` holds the title-screen art + `layout.json`.
- **`app/archive/`** contains versioned snapshots (`v1-1`, `v2-1`) and `change_log.json` tracking the rewrite history. `app_metadata.json` / `chat.json` are platform metadata. These are reference only.
