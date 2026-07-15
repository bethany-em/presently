# Presently v2

Presently is a local, buildless controller for showing words and live video at gatherings of any kind. A deck can contain song lyrics, announcements, readings, schedules, or any other cueable text. Named screens receive the same live cue with their own video treatment, text placement, text size, and resolution.

This directory is a clean architectural rewrite. It imports the durable v1 deck, but it is not a line-for-line port. Every v2 source file, dependency, test, and document lives under `v2/`; the application does not modify files outside this directory.

## Run and test

Requirements:

- Node.js and npm
- Caddy on `PATH`
- Chromium installed for Playwright
- local ports 443 and 2019 available to Caddy

```powershell
cd v2
npm install
npm start
```

Open <https://localhost>. The first Caddy run may ask the operating system to trust its local certificate authority.

Run the complete suite with:

```powershell
npm test
```

`npm test` starts Caddy when needed, opens the real HTTPS application at the Pages-shaped `/v2/` path in Chromium, runs the built-in product and resource-lifecycle tests, verifies the vendored runtime request graph, checks the controller and popup viewer, exercises 16:9, 4:3, ultrawide, portrait, DPR 2, pagehide/pageshow reconnection, 2–10 full-width deck columns, and a 390 px viewport, reports first-party JavaScript coverage, and stops only the Caddy instance it started.

The implementation baseline is 36/36 built-in tests with no page errors. Tests cover complete v1 migration, normalization, import/export ordering, semantic document and screen actions, deletion-to-standby, bounded Undo/Redo, text transactions, platform history shortcuts, immediate click/double-click behavior, navigation, direct editing, paste acceptance/rejection, set collapse, native drag-and-drop, screen-local composition, blank standby, popup identity and reconnection, partial/late media acquisition, exact and retained-stream ownership, terminal disposal, denied storage, arbitrary aspect ratios, 2× subscaling, persistence, and secure-context operation.

The supplied uncovered-range calculation currently reports 86.5% first-party line coverage. Coverage is diagnostic rather than an acceptance percentage. Chromium records coverage per page, so viewer-owned code appears uncovered in the controller page even though the suite opens a real viewer, synchronizes it, changes it live from 16:9 to 4:3, and verifies the viewer's pagehide/pageshow disconnect/reconnect protocol. The suite does not claim to prove browser BFCache eligibility or restoration through a real navigation.

## Why HTTPS is required

Camera and display capture are secure-context APIs. `getUserMedia()` and `getDisplayMedia()` are not generally available to an untrusted HTTP origin. Explicit HTTPS gives the application one predictable origin for permissions, `crypto.randomUUID()`, local modules, the controller, and popup outputs.

Same-origin popup windows also matter architecturally. A live `MediaStream` is a process object, not JSON. The controller can hand that object directly to a same-origin viewer without persisting or serializing it.

`file://` is deliberately not used. File documents have inconsistent module, origin, popup, and media behavior and do not test the topology that the application actually depends on. Playwright ignores the local certificate error in automation; the application itself does not weaken browser security.

## GitHub Pages deployment

The repository workflow uploads the checked-out repository root as a static Pages artifact; it does not run `npm install` or a build. The existing root application therefore remains at the repository URL, while this application is served from its preserved subdirectory:

```text
https://<owner>.github.io/<repository>/v2/
```

Every runtime URL is relative to `v2/index.html`. Styles, application modules, popup viewers, and the Solid import map consequently stay below `/v2/` for both project Pages and custom domains. The root workflow needs no v2-specific copy step, base-path rewrite, or redirect. Because v1 and v2 share the Pages origin, v2 can still read and copy the legacy `deck` storage key without modifying v1.

GitHub Pages has no `node_modules`, so the four reviewed Solid 1.9.14 browser modules are committed byte-for-byte under `vendor/solid-js/`, together with Solid's license. `solid-js` remains an exact dev dependency for source inspection and controlled upgrades; it is not a deployed runtime dependency. When Solid changes, update the package and lockfile, re-review the installed sources, replace all four vendored modules and the license from that exact package, then run `npm test`. The harness byte-compares every vendored file with the installed package, and the browser shell fails if the application requests `/node_modules/` or does not load every expected vendored Solid entrypoint.

## Source map

| File | Responsibility |
| --- | --- |
| `index.html` | Import map, pre-import test gate, mode/bootstrap parsing, and one mount point |
| `app.css` | Native-font visual system, fixed operator workspace, full-width deck grid, and responsive fallback |
| `model.js` | Pure document/workspace normalization, navigation, ordering, parsing, color, and composition math |
| `canvas.js` | Shared video/text renderer used by thumbnails, previews, and popup outputs |
| `history.js` | Bounded labeled deck-command history with focus transactions |
| `controller.js` | Serializable deck/workspace/cue state, semantic commands, history, hydration, and persistence |
| `media.js` | Camera/display inventory, selected-key policy, request ordering, and complete stream ownership |
| `outputs.js` | Popup registry, cached full-state publication, exact-target bridge, and viewer lifecycle |
| `app.js` | Browser capability adapter, small composition root, view-session gestures, and components |
| `tests.js` | Built-in browser tests, loaded only with `?test=1` |
| `test.js` | Caddy/Playwright orchestration, popup and geometry checks, and module coverage |
| `Caddyfile` | Local HTTPS static server |
| `vendor/solid-js/` | Exact deployable Solid 1.9.14 browser modules and upstream license |
| `docs/spec.md` | Ignored canonical product and acceptance contract |
| `docs/plan.md` | Ignored design record; never included in source control |

The runtime uses the committed files in `vendor/solid-js/`. There is no bundler, JSX transform, Vite server, CDN, deployed `node_modules`, or build step.

## What v1 does

The repository-root application is a buildless Preact application with separate controller and output entries. Its important behavior is worth preserving: a visual deck, direct plaintext editing, same-origin live output windows, import/export, keyboard cueing, labeled-text splitting, video sources, and color-readable slide groups.

Its main architectural constraints are:

1. Selection is an array index path. Reorder and removal can silently make that path identify a different slide.
2. A generic change handler clones the complete deck on every edit and then mutates a walked path.
3. IDs are regenerated at boot, so they cannot provide durable identity.
4. Portable deck data, operator preferences, media objects, selection, and popup state are not clearly separated by lifetime.
5. Output rendering and lifecycle are distributed across controller, iframe, and popup paths.
6. Media acquisition is eager and can hold multiple camera streams.
7. Drag-and-drop reconstructs state from DOM order through an external library.
8. Parsing, mutations, and rendering meet inside components, making behavior difficult to test independently.

v2 keeps the useful interaction flow while replacing those foundations with stable IDs, pure domain functions, narrow Solid store updates, one renderer, one selected source, state-owned ordering, and executable browser contracts.

## Architecture

The application has three serializable/session state lifetimes, two browser-resource owners, and one shared composition function.

| Lifetime | Contents | Persistence |
| --- | --- | --- |
| Deck document | version, deck/set/slide IDs, titles, labels, words, attribution | local storage and JSON export |
| Operator workspace | generic screens, dimensions, video mode, two text-position banks, text rows, deck columns, reference screen | local storage only |
| Live runtime | selected cue, editor focus, deck history, camera preview streams, selected source, popup handles, drag state, collapsed sets, notices | memory only |

Ownership is deliberately stricter than that persistence table:

```text
index bootstrap + browser capabilities
                 |
          Solid render owner
       /            |           \
controller.js    media.js    outputs.js
deck/workspace   streams      popups/viewer
cue/history      selection    full-state bridge
       \            |           /
          semantic capabilities
                 |
             app.js views
```

`controller.js` never stores `Window`, DOM, or `MediaStream` objects. `media.js` never knows about decks or screen policy. `outputs.js` receives already-resolved view states and never imports the schema. `app.js` owns only view-session state such as Edit mode, focus, and drag gestures, plus the few commands that genuinely cross owners. All structural changes use named commands; components express operator intent rather than storage paths or resource repair.

The output path is:

```text
deck + selected IDs ─┐
screen profile ──────┼─> resolveScreenComposition() ─> OutputCanvas
active MediaStream ──┘                               ├─ controller preview
                                                    ├─ deck thumbnail
                                                    └─ popup viewer
```

Thumbnails intentionally use the reference screen's words-only bank and no live video. Screen previews and popup viewers use the complete screen-local composition. Screen labels are never renderer branches.

`mount(root, environment, bootstrap)` creates every mutable capability inside one Solid owner and returns `{ app, dispose }`. The render disposer is the only external teardown path. Viewer mode branches before controller creation, so an output window does not hydrate storage, create history, or request cameras.

### Durable deck

```json
{
  "version": 2,
  "id": "uuid",
  "title": "Presently Demo",
  "presentations": [
    {
      "id": "uuid",
      "title": "First Song",
      "attribution": "Example words · public domain",
      "slides": [
        {
          "id": "uuid",
          "title": "Verse 1",
          "content": "A quiet line begins\nAnd fills the waiting room"
        }
      ]
    }
  ]
}
```

The `presentations` field remains compatible with v1 JSON; the UI calls these groups “sets.” `normalizeDeck()` supplies missing strings and repairs missing or duplicate IDs across the whole document.

On normal startup, v2 first checks `presently.v2.deck`. If it is absent, it reads the complete v1 `localStorage["deck"]`, normalizes it, and writes a separate v2 copy. The v1 value is never changed or removed. Import follows the same boundary: parsing and normalization complete before the active deck is replaced.

Successful import and reset enter standby instead of auto-cueing a slide. Export contains only the portable deck—not screen setup, selection, devices, streams, or window handles.

When neither v2 nor v1 storage exists, the initial deck is one tutorial set containing ten short slides. They explain cue toggling, global Edit mode, keys, paste splitting, label colors, drag ordering, sources, generic screens, and video-preserving standby. Reset restores the same single-set tutorial. There is no onboarding modal to dismiss before the deck can be used.

### Operator workspace

```json
{
  "slideColumns": 2,
  "previewScreenId": "uuid",
  "screens": [
    {
      "id": "uuid",
      "label": "Stage",
      "videoMode": "off",
      "textPositions": {
        "withoutVideo": "center-center",
        "withVideo": "bottom-center"
      },
      "textRows": 8,
      "width": 1920,
      "height": 1080
    }
  ]
}
```

“Stage” and “Audience” are only default labels. The operator can add any number of screens, rename them, remove them, and change their positive integer width/height. `previewScreenId` chooses which screen supplies deck-thumbnail geometry. The explicit `Slide preview` selector beside the deck columns control changes that reference only; it never routes content or changes a live output.

Older v2 workspace values are normalized in place. The former screen `video` flag plus global `fitVideo` become each screen's `off`, `cover`, or `contain` mode. Columns clamp to 2–10, text rows to 1–20, invalid positions return to their defaults, and screen/reference IDs are repaired.

### Stable identity

Selection is either `null` or `{ presentationId, slideId }`. It never depends on array position. Reorder follows stable IDs. Deleting the live slide or its containing set always returns words to standby; deleting unrelated content preserves the existing cue. Undo restores document content without silently restoring a former live cue.

Editor focus is separate from live selection. Typing and single-click editing do not accidentally change the audience cue. Focus is transient and is used only to place the caret after adding or splitting content.

## End-to-end user flow

Presently has four pieces of state that can change independently:

| Operator concept | What it means | What it affects |
| --- | --- | --- |
| Deck | Saved sets, slides, labels, words, and attribution | Editing, import/export, and future sessions |
| Live cue | Either one selected slide or standby | The words layer on every screen |
| Video source | At most one selected camera or shared display | Screens whose video mode is Cover or Contain |
| Screen profile | A named destination with its own mode, alignment, rows, and resolution | Its controller preview and popup output only |

There is no selected destination screen. Every open screen receives the same live cue and selected source, then applies its own profile. This separation explains the most important live behavior: clearing words does not clear video, and setting one screen to Off does not disable video on the others.

### 1. Start or resume

1. Open the Caddy HTTPS URL. HTTPS is part of the product path because camera, display capture, and same-origin popup streams depend on it.
2. Presently restores `presently.v2.deck` and the v2 workspace when they exist. On the first v2 visit only, it imports the complete v1 `deck` value. With neither value, it opens the single-set tutorial.
3. The controller always starts in Operate mode and standby. Saved words and screen profiles return; the previous live cue, streams, collapsed sets, and popup handles do not.
4. Camera discovery starts immediately. The browser may ask for permission before all source cards appear. This is intentional so the operator can choose from visible feeds without a separate discovery step.
5. Stage and Audience are initial screen names, not fixed roles. Their popup state begins Closed.

### 2. Prepare the deck

1. Enter Edit with the visible mode switch, or double-click a slide. The switch changes mode only. Double-clicking from Operate takes that slide live and focuses its editor: **Take and Edit**.
2. Edit the deck title, set title, slide label, slide words, and set attribution directly where they appear. Changes persist immediately; there is no Save command or unsaved-draft state. Undo and Redo sit in the top Edit command band.
3. Add sets or slides only in Edit. New slides receive focus but do not become live.
4. Paste structured lyrics into slide words. The complete text is stored first. If useful headings are detected, accept the prompt to split it or reject the prompt to keep the paste on one slide.
5. Reuse a label suggestion to reuse its deterministic color. Color groups controller cards; it is not sent to outputs.
6. Drag only from the visible handle. Slides move within their set; sets move within the deck. Collapse a set to reduce visual load without changing saved data or the live cue.
7. Import, export, and reset live in the Edit-only Deck menu. Import and reset replace the document and return the words layer to standby.

Attribution belongs to the set and is emitted only with that set's first slide. It is edited below the set's slide grid, not on each slide.

### 3. Configure screens and video

1. Add, rename, resize, or remove screens in Edit. Any number of screens is supported; labels never select special behavior.
2. Choose Off, Cover, or Contain on each screen. Off suppresses the video layer for that screen. Cover fills with cropping; Contain letterboxes without cropping.
3. Choose a camera or shared display in the source strip. Clicking the selected source again deselects it. Source selection is global, while whether it appears is screen-local.
4. Set text placement with the 3×3 grid. Off edits the no-video alignment bank; Cover or Contain edits the with-video bank. Each screen remembers both.
5. Set the desired text-row capacity from 1 to 20. Eight is the default. The overflow warning reports when the current copy does not fit the screen's safe region.
6. Use `Slide preview` only to choose which screen profile shapes deck thumbnails. It does not route content or choose a destination.
7. Select Open for each physical destination. The popup reuses that screen's stable identity and immediately receives the current composition. Move the popup to the intended display and make it full-screen using the browser or operating system.

### 4. Run the gathering

1. Leave Edit with the visible mode switch to preserve the live cue, or double-click a slide to leave Edit and take that slide live.
2. In Operate, click a slide to cue it immediately; click the live slide again to return the words layer to standby immediately.
3. Use Left/Right for the previous or next slide across the complete deck. Use Up/Down for the first slide of the previous or next non-empty set. Navigation wraps at both ends.
4. Press Escape to clear words. Enter or Space toggles a keyboard-focused slide immediately.
5. Select or change video independently at any time. Standby leaves configured video running.
6. Watch the amber slide border and top-bar Live cue readout for words state, the amber source border for source state, and each screen preview for the final screen-local result.

### 5. Recover or finish

- A cancelled camera/display request preserves the selected source. A newer choice wins over a slower request.
- Refresh rebuilds camera previews and preserves a selected camera by device ID when it is still available.
- Hiding a source stops that preview until Refresh. An ended selected display returns video selection to none.
- Closing or reloading the controller stops its media tracks. Reload restores the deck and workspace in standby; reopen each required output.
- Popup-blocked, import, and source failures appear in their own panel rather than changing unrelated state.
- Undo/Redo history is session-only. Reload keeps the autosaved deck but begins with empty history.

### Control reference

The following mode details are consequences of that end-to-end flow.

### Operate mode

- Single-click a slide to cue it.
- Single-click the live slide again to clear only its words layer.
- Double-click a slide to enter global Edit mode without changing the existing live cue.
- Left/Right move through the full flattened running order.
- Up/Down move to the first slide of the previous/next non-empty set.
- From standby, forward keys enter at the beginning and reverse keys enter at the end.
- Escape clears only the words layer; active video continues.
- Focus inside an input, button, select, range, or editor suppresses global cue keys.
- Open creates or reuses a popup keyed by stable screen ID.
- Video mode, alignment, text rows, sources, and popup controls remain available because they affect the live composition.

### Edit mode

- The deck title, set title, slide label, words, and attribution become directly editable in place.
- A single click in slide words edits without changing the live cue.
- A double click leaves global Edit mode and cues that slide.
- Add set and canvas-shaped Add slide controls create records and focus the new words editor without cueing unfinished text.
- Existing labels appear as native datalist suggestions, making consistent color grouping quick without persisting presentation colors.
- Clicking a set header collapses it locally without changing the deck, live cue, or popup output.
- One native drag handle and remove control appear per slide/set. Only the handle is draggable, so text selection never starts a drag.
- Drag/drop resolves before/after by stable source and target IDs; DOM order is never read back into state.
- Document import/export/reset lives in one compact Deck menu.
- Undo/Redo covers deck text, add/remove/reorder, paste splitting, import, and reset. It never replays cues, sources, screens, or popups.
- `Ctrl/Cmd+Z` undoes; `Ctrl/Cmd+Shift+Z` and Windows/Linux `Ctrl+Y` redo outside a focused text control. Focused fields retain native caret-aware history.
- Screen creation, dimensions, and removal live in each compact Screen menu.

Pointer click and keyboard Enter/Space both toggle synchronously. Browsers construct a double-click from ordinary clicks, so the first click is deliberately meaningful: double-clicking from Operate takes that slide and enters Edit; double-clicking from Edit takes that slide and returns to Operate. There is no timer, pending cue, or separate per-card gesture state.

### Paste flow

Paste first behaves like normal plaintext editing: the complete result is immediately stored on the current slide. The parser then recognizes Intro, Verse, Chorus, Bridge, Pre-Chorus, Instrumental, Interlude, Outro, Ending, Vamp, and Tag headings.

When the paste can make multiple useful slides, one confirmation asks whether to split it. Rejecting does nothing further, so all pasted text remains on the one slide. Accepting atomically replaces the current slide with labeled chunks, retains the v1 3/4/5-line chunking heuristic, extracts trailing `Song #` attribution, and remaps the live cue only when the replaced slide was already live. Undo first returns to the unsplit paste, then restores the pre-paste text.

## User-flow review

The architecture is simpler than v1, but the interaction design is not uniformly resolved. Deletion safety and document history are now resolved: removal of live content enters standby, and bounded deck Undo/Redo is available from the top bar and keyboard. The remaining rows are current behaviors, not hidden implementation notes:

| Priority | Inconsistency or friction | Why it matters | Simplest direction |
| --- | --- | --- | --- |
| Medium | Video has two controls: one global selected source and one mode per screen. A source can be active while every screen is Off; a screen can say Cover with no source. | Both states are valid, but the operator must infer why a preview is black. | Show the selected source name beside each screen's video mode, or explicitly show “Cover · no source.” |
| Medium | The alignment legend says With video whenever mode is Cover/Contain, even if no source exists. The bank follows configured mode, not visible pixels. | The label describes an outcome that may not currently exist. | Rename the context to “Video layout” / “Words-only layout,” making it clear that this is a remembered policy. |
| Medium | Attribution is set-level, rendered only on the first slide, and edited after the entire slide grid. | In a long set it is visually far from both the title it belongs to and the only slide that displays it. | Put attribution in the set header's edit affordances while keeping the same data model and first-slide rule. |
| Medium | Deck/set/slide is the UI vocabulary, while imported JSON still calls sets `presentations`. | Compatibility terminology leaks into architecture discussions and makes “single deck” ambiguous. | Keep Deck, Set, and Slide everywhere user-facing; mention `presentations` only in the compatibility/schema section. |
| Accepted tradeoff | Camera permission and multiple preview streams begin on startup. | It can interrupt first use and consumes camera resources, but hiding discovery would violate the requirement that sources be immediately visible. | Keep eager discovery, explain the permission prompt, use modest constraints, and retain complete cleanup. |

The next architectural work should address the high-priority rows before adding more controls. The composition model, generic screens, stable identities, and media request ordering do not need replacement; the remaining problems are mostly interaction-policy inconsistencies at their edges.

## Layout and visual system

The CSS is intentionally small and native: system fonts, a dark neutral workspace, one warm live accent, and deterministic muted label colors. There is no icon font or component framework.

On desktop the application is a fixed-height live workspace. The deck scrolls independently in the large left region, the horizontal video-source strip stays visible below it, and the screen rail scrolls independently at right. The page returns to ordinary vertical flow below 900 px so touch devices do not inherit nested viewport traps.

The pinned top bar has two stable bands: editable deck identity plus live-cue status, then global mode plus Undo, Redo, and document actions. In Operate mode structural actions disappear without moving the bands. Disabled history buttons remain rendered during Edit so command geometry stays fixed. The slide grid always consumes the complete available deck width. Its lower-right control combines the explicit `Slide preview` screen reference with a slider that changes `repeat(n, minmax(0, 1fr))` from 2 to 10 columns; there are no special thumbnail widths.

Slide-label color is structural information. Labels are trimmed, whitespace-collapsed, lowercased, and hashed into a fixed muted palette. Equal labels always have the same color after reload, import, or reorder. Color appears only in controller chrome and never changes the output.

At widths below 900 px the source strip and output rail move below the deck. At 390 px, the deck remains two columns, toolbar actions stay on their second line, previews use the full viewport width, and the document has no horizontal overflow.

## Arbitrary aspect ratios and text sizing

Resolution is data, not a named preset. Every canvas uses the screen's `width / height` as CSS `aspect-ratio`; the standalone viewer uses the same ratio to choose the largest contained rectangle inside the physical window. A 16:9 screen on a 4:3 monitor letterboxes. A portrait, square, 4:3, 3:2, or ultrawide screen goes through exactly the same code.

CSS container units make text relative to the logical canvas rather than to the browser window. The text-row slider is a readability control, not a raw pixel-size control. It defaults to 8 and ranges from 1 to 20. Its computed size is:

```text
safeHeight = screenHeight × (1 − safeTop − safeBottom)
fontPixels = safeHeight × safety / (rows × lineHeight)
fontCqw    = 100 × fontPixels / screenWidth
```

Current constants are 6% horizontal safe margins, 7% top, 13% bottom, line height 1.18, and a 0.98 safety factor. The DOM remains the source of truth for wrapping. Overflow measurement compares the rendered text box with the safe region and warns the operator; it does not silently shrink words or duplicate browser typography in canvas code.

The nine-way position grid sits below each screen preview at lower left, and the row slider sits opposite it at lower right—the controls are physically attached to the composition they change. Arrow glyphs express the eight directions and a dot expresses center.

Each screen stores two independent 3×3 position banks:

- without video, default `center-center`;
- with video (`cover` or `contain`), default `bottom-center`.

The visible grid edits the bank for the screen's current video mode. Switching video mode reveals the other remembered value. This is the 18-state model: nine positions in each of two visual contexts, without an 18-button interface.

The geometry suite verifies 1920×1080, 1024×768, 2560×1080, and 1080×1920 in controller and viewer paths. A separate Chromium context at `deviceScaleFactor: 2` verifies that device-pixel subscaling changes raster density, not CSS composition. No renderer branch depends on DPR or a known ratio.

## Video lifecycle

There is exactly one selected source, but the source strip intentionally keeps every available camera preview visible. On controller startup, Presently requests modest 640×360, 15 fps streams for each enumerated camera. This matches the original's immediate visual choice while bounding preview cost. `Refresh` acquires a complete replacement inventory before stopping the old one when possible, preserves selection by stable device ID, and stops every superseded track. A small hide control stops one preview until the next refresh.

Clicking a camera card selects it for outputs; clicking the selected card returns outputs to no source without destroying the preview inventory. Shared display is represented by the same kind of card. Cancelling or failing display sharing preserves the current source.

Requests are ordered independently for camera inventory and source choice. Every resolved stream is immediately pending, adopted into the inventory, or stopped. If a slow refresh/share resolves after newer intent—or after root disposal—its tracks are stopped and it cannot replace current state. A source is selected by stable key and derived from the current inventory, so refresh can replace a camera stream without synchronizing a second source object.

Ended handling uses exact stream identity. An inactive ended display disappears without clearing a selected camera, an ended selected source clears only video selection, and a late ended event from a replaced stream cannot remove its replacement. Page cleanup is terminal and idempotent: it invalidates requests and stops owned, partially acquired, and later-resolving tracks.

Each screen independently selects:

- `Off`: no video layer;
- `Cover`: fill the canvas and allow cropping;
- `Contain`: preserve the complete source and letterbox.

Clearing selection affects only the words and attribution. Video can continue in previews and viewers with an empty text layer.

## Output synchronization

`?screen=<id>` branches before controller/media creation and mounts the same `OutputCanvas` inside a full-window viewer. The output owner keeps a map from stable screen ID to window plus the latest complete payload per screen. A late viewer connection receives cached state immediately; disconnects are accepted only from the exact registered window; closed, failed, and removed targets are retired. Open reuses a live destination.

Viewer receiver installation, opener registration, page lifecycle, and cleanup are one protocol. A viewer disconnects while entering the back-forward cache, reconnects once on `pageshow`, and removes its receiver on final disposal. The controller republishes current full state when restored.

Viewer payloads contain plain composition data plus the same-origin `MediaStream` reference. They do not contain the whole deck or operator UI state. Popup-blocked and media failures use scoped notices so unrelated panels do not display the wrong error.

## Why Solid and what was inspected

`solid-js` 1.9.14 is pinned exactly as a dev dependency because its browser source is both the vendored runtime and part of the architectural review. Playwright 1.61.1 is also pinned exactly. The installed `dist/solid.js`, `store/dist/store.js`, `web/dist/web.js`, and `html/dist/html.js` files were reviewed and copied byte-for-byte into `vendor/solid-js/`.

- Signals notify dependent computations instead of rerunning component functions.
- Store setters can target nested records by predicate, allowing narrow ID-based updates without cloning the deck.
- Array replacement notifies the correct property/length nodes for ordering changes.
- `render()` creates the owner synchronously and returns the disposer that empties the mount node; controllers are therefore created inside its callback and register explicit browser cleanup with `onCleanup()`.
- Common DOM events are delegated by the web runtime.
- `solid-js/html` compiles and caches tagged templates at runtime. A zero-argument component prop is treated as a getter, so dynamic values use thunks while callback props accept at least one parameter.

The last point is a buildless maintenance rule, not style trivia. Confusing getters and callbacks can invoke an action while binding a component. Tests cover the direct-edit and output-sync boundaries where that mistake is most costly.

The runtime template compiler uses `new Function`. A future strict Content Security Policy must allow that behavior or move to precompiled Solid templates. Vendoring makes deployment self-contained but also makes upgrading Solid an explicit source-review and copy operation. Both tradeoffs are accepted to keep development and operation buildless.

## Invariants for future work

- Never make Stage, Audience, or another label imply behavior.
- Never persist selection, streams, popup handles, or device objects in deck JSON.
- Never read DOM order back into state.
- Never address durable records by mutable array position.
- Never select a neighboring slide as a side effect of deletion or history repair.
- Never include cues, sources, screens, streams, or popup handles in deck Undo/Redo.
- Never render operator instructions inside an output canvas.
- Never stop video merely because words are cleared.
- Never special-case a named aspect ratio or DPR in the renderer.
- Keep one composition path for thumbnails, previews, and viewers.
- Keep domain transformations pure and browser interaction thin.
- Keep every implementation change inside `v2/`.
