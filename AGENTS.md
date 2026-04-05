# Pixel Agents — Compressed Reference

VS Code extension with embedded React webview: pixel art office where AI agents (Claude Code terminals) are animated characters.

## Architecture

```
src/ — Extension backend (Node.js, VS Code API)
 constants.ts — Extension-only constants (VS Code IDs, key names)
 extension.ts — Entry: activate(), deactivate()
 PixelAgentsViewProvider.ts — WebviewViewProvider, message dispatch, asset loading, server lifecycle
 assetLoader.ts — PNG parsing, sprite conversion, catalog building, default layout loading
 agentManager.ts — Terminal lifecycle: launch, remove, restore, persist
 configPersistence.ts — User-level config file I/O (~/.pixel-agents/config.json), external asset directories
 layoutPersistence.ts — User-level layout file I/O (~/.pixel-agents/layout.json), migration, cross-window watching
 fileWatcher.ts — fs.watch + polling, readNewLines, /clear detection, terminal adoption
 transcriptParser.ts — JSONL parsing: tool_use/tool_result → webview messages
 timerManager.ts — Waiting/permission timer logic
 types.ts — Shared interfaces (AgentState, PersistedAgent)

server/ — Standalone server (Node.js, no VS Code deps except types)
 src/
 server.ts — HTTP server: hook endpoint, health check, server.json discovery
 hookEventHandler.ts — Routes hook events to agents, buffers pre-registration events
 constants.ts — All timing/scanning constants (shared by extension + server)
 providers/file/
 claudeHookInstaller.ts — Install/uninstall hooks in ~/.claude/settings.json
 hooks/claude-hook.ts — Hook script: reads stdin, POSTs to server (bundled to CJS by esbuild)
 __tests__/ — Vitest test suite
 server.test.ts — HTTP server lifecycle, auth, hooks, server.json
 hookEventHandler.test.ts — Event routing, buffering, timer cancellation
 claudeHookInstaller.test.ts — Hook install/uninstall in settings.json
 claude-hook.test.ts — Integration: spawns real hook script process

webview-ui/src/ — React + TypeScript (Vite)
 constants.ts — All webview magic numbers/strings (grid, animation, rendering, camera, zoom, editor, game logic, notification sound)
 notificationSound.ts — Web Audio API chime on agent turn completion, with enable/disable
 App.tsx — Composition root, hooks + components + EditActionBar
 hooks/
 useExtensionMessages.ts — Message handler + agent/tool state
 useEditorActions.ts — Editor state + callbacks
 useEditorKeyboard.ts — Keyboard shortcut effect
 components/
 BottomToolbar.tsx — + Agent, Layout toggle, Settings button
 ZoomControls.tsx — +/- zoom (top-right)
 SettingsModal.tsx — Centered modal: settings, export/import layout, sound toggle, hooks toggle, debug toggle
 InfoModal.tsx — Reusable pixel-styled modal (used for hooks info, changelog)
 Tooltip.tsx — First-run tooltip with dismiss + "View more" link
 DebugView.tsx — Debug overlay
 office/
 types.ts — Interfaces (OfficeLayout, FloorColor, Character, etc.) + re-exports constants from constants.ts
 toolUtils.ts — STATUS_TO_TOOL mapping, extractToolName(), defaultZoom()
 colorize.ts — Dual-mode color module: Colorize (grayscale→HSL) + Adjust (HSL shift)
 floorTiles.ts — Floor sprite storage + colorized cache
 wallTiles.ts — Wall auto-tile: 16 bitmask sprites from walls.png
 sprites/
 spriteData.ts — Pixel data: characters (6 pre-colored from PNGs, fallback templates), furniture, tiles, bubbles
 spriteCache.ts — SpriteData → offscreen canvas, per-zoom WeakMap cache, outline sprites
 editor/
 editorActions.ts — Pure layout ops: paint, place, remove, move, rotate, toggleState, canPlace, expandLayout
 editorState.ts — Imperative state: tools, ghost, selection, undo/redo, dirty, drag
 EditorToolbar.tsx — React toolbar/palette for edit mode
 layout/
 furnitureCatalog.ts — Dynamic catalog from loaded assets + getCatalogEntry()
 layoutSerializer.ts — OfficeLayout ↔ runtime (tileMap, furniture, seats, blocked)
 tileMap.ts — Walkability, BFS pathfinding
 engine/
 characters.ts — Character FSM: idle/walk/type + wander AI
 officeState.ts — Game world: layout, characters, seats, selection, subagents
 gameLoop.ts — rAF loop with delta time (capped 0.1s)
 renderer.ts — Canvas: tiles, z-sorted entities, overlays, edit UI
 matrixEffect.ts — Matrix-style spawn/despawn digital rain effect
 components/
 OfficeCanvas.tsx — Canvas, resize, DPR, mouse hit-testing, edit interactions, drag-to-move
 ToolOverlay.tsx — Activity status label above hovered/selected character + close button

scripts/ — 7-stage asset extraction pipeline
 0-import-tileset.ts — Interactive CLI wrapper
 1-detect-assets.ts — Flood-fill asset detection
 2-asset-editor.html — Browser UI for position/bounds editing
 3-vision-inspect.ts — Claude vision auto-metadata
 4-review-metadata.html — Browser UI for metadata review
 5-export-assets.ts — Export PNGs + furniture-catalog.json
 asset-manager.html — Unified editor (Stage 2+4 combined), Save/Save As via File System Access API
 generate-walls.js — Generate walls.png (4×4 grid of 16×32 auto-tile pieces)
 wall-tile-editor.html — Browser UI for editing wall tile appearance
```

## Cursor Cloud specific instructions

### Project overview

VS Code extension (TypeScript + esbuild) with a React webview (Vite) and a standalone HTTP hook server. Three separate `node_modules` directories: root, `webview-ui/`, and `server/`.

### Key commands

All standard commands are documented in `CONTRIBUTING.md` and `package.json` scripts. Quick reference:

| Action                     | Command                                                   |
| -------------------------- | --------------------------------------------------------- |
| Full build                 | `npm run build` (type-check + lint + esbuild + Vite)      |
| Lint                       | `npm run lint`                                            |
| All unit/integration tests | `npm test`                                                |
| Server tests only          | `npm run test:server`                                     |
| Webview tests only         | `npm run test:webview`                                    |
| E2E tests                  | `npm run e2e` (requires display server)                   |
| Dev watch (extension)      | `npm run watch`                                           |
| Webview dev server         | `cd webview-ui && npm run dev` (serves at localhost:5173) |

### Non-obvious caveats

- **Three npm installs required**: root, `webview-ui/`, and `server/` each have their own `package.json` and `node_modules`.
- **Server tests need build output**: `claude-hook.test.ts` spawns the compiled hook script at `dist/hooks/claude-hook.js`. Run `npm run build` before `npm run test:server` if `dist/` doesn't exist.
- **Webview dev server** (`cd webview-ui && npm run dev`) runs a mocked standalone version of the pixel art office at `http://localhost:5173/`. Agent spawning requires the full VS Code extension host (F5 in VS Code), but the UI, layout editor, and rendering are fully functional in the standalone dev server.
- **E2E tests** use `@vscode/test-electron` + Playwright and download a VS Code binary (~200 MB) on first run. They require a display server (Xvfb on Linux). In cloud VM (Docker-in-Firecracker) environments, E2E tests may fail because VS Code's Electron workbench cannot render — this is an environment limitation, not a code bug.
- **Pre-commit hook** requires `gitleaks` installed on the system. The hook scans staged files for secrets and runs `lint-staged` for formatting.
- **Pre-push hook** runs `npm run check-types` (TypeScript type-checking for both extension and server).
- **No `enum` keyword**: use `as const` objects (TypeScript `erasableSyntaxOnly`).
- **`import type` required** for type-only imports (`verbatimModuleSyntax`).
- **Constants are centralized**: never add inline magic numbers. Extension: `src/constants.ts`, Webview: `webview-ui/src/constants.ts`, CSS: `webview-ui/src/index.css` `:root`.
