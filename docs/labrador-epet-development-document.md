# Development Document — `dsh-labrador`
## A desktop e-pet whose photographs *are* its actions

**Prepared for:** Raymond
**Workspace:** `D:\桌宠`
**Revision:** v2 — supersedes v1 (daily-photo rotation). The core concept changed on your instruction: the images no longer drive a calendar, they define the animal's repertoire.
**Status:** Proposal — awaiting confirmation. No code has been written. Nothing has been scaffolded in `D:\桌宠`.
**Basis:** verified against the installed DSH 0.8.2 build and the `web` profile. §12 states what I have *not* yet verified.

---

## 1. The proposal, restated

Each photograph you own is a **pose**. A pose belongs to an **action** — sitting, walking, begging, asleep, mid-bark. The plugin is a small state machine that decides what the dog is doing at any moment, plays the action from whatever frames that action owns, and holds the whole thing together so that a set of loose snapshots reads as one animal living on your desktop.

Instead of "one random photo per day", the pet runs a continuous loop: it idles, occasionally decides to do something, does it, and settles back to idling. Your photographs are the entire vocabulary it draws from.

Everything is local. No upload, no network call, and — unless you turn on one optional feature — no model cost.

---

## 2. What the house already has

| Fact | Evidence |
| --- | --- |
| DSH Desktop 0.8.2, Electron shell | `D:\DeepSeekHarness\DSH Desktop\resources\app\package.json` |
| The GUI runs as a `dsh web` profile named `web` | `$DSH_HOME\profiles\web\` |
| Plugins install as npm packages into that profile | `dsh plugin --profile web add <name>` — confirmed in `dsh-desktop-market-installer/index.js` line 516 |
| A plugin marketplace is installed | `dshmarket` 1.45.1 |
| **A working desktop pet is already installed** | `dsh-pet` 0.2.8, `$DSH_HOME\profiles\.generations\live\dsh-pet+0.2.8+10a00d05eace\node_modules\dsh-pet\` |
| **It is currently switched off** | `$DSH_HOME\profiles\web\cordis.patch.yml` → `- id: pet` / `disabled: true` |
| Two other third-party plugins installed | `dsh-better-sidebar` 0.19.1, `@kenz1117/dsh-ui-usage-billing` 1.3.0 |
| Leftover state from an earlier pet | `$DSH_HOME\dsh-pet\memory.json` — belongs to the disabled plugin; left untouched |
| **No images in the workspace yet** | `D:\桌宠` is empty — the folder convention in §6 is still ours to set |

`dsh-pet` matters for one reason: it has already solved, in shipping code on this machine, the floating window, the host↔browser split and the settings page. It is a reference for the mechanism. Its *content model* — a pool of seamless video clips — is exactly what we are not doing.

---

## 3. The plugin architecture of DSH, as actually implemented

### 3.1 Manifest

```jsonc
{
  "type": "module",
  "main": "lib/index.js",
  "exports": { "./client": "./lib/client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-connection"],
      "platform": "web"
    }
  },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1", "react": "^18.2.0" }
}
```

### 3.2 Mounting

`cordis.patch.yml` inserts one row into the profile's config tree:

```yaml
- insert:
    - id: labrador
      name: 'dsh-labrador'
```

That row loads the host half; `dsh.client` is what makes the module system also serve `/plugins/dsh-labrador/client.js` to the page.

### 3.3 Host half (Node, in the DSH process)

`export const name`, `export const inject`, `export function apply(ctx)`.
`inject: ['webServer', 'commands']`, plus `llm` only if the optional AI feature is enabled.
Services confirmed in use by the reference plugin: `webServer`, `commands`, `llm`, `credentials`, `agentDefaultModel`. Disposal-scoped work goes in `ctx.effect(...)`; harness activity arrives via `ctx.on('session/event', ...)`. Local images reach the page through one route:

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix', path: '/labrador-1234',
  handler: async (req, res) => { /* serve frames, thumbnails, status JSON */ },
}), 'dsh-labrador: asset route')
```

### 3.4 Browser half (React, in the GUI page)

A plain side-effect script — no top-level ESM `import`/`export`; React comes from the factory's `require`:

```js
window.__ModuleLoader__.load({
  id: 'dsh-labrador',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'labrador', order: 100 }, LabradorPet))
    }
    module.exports = { apply, inject }
    return module.exports
  },
})
```

### 3.5 The slots that matter

From the harness's own generated catalogue (`dsh-cordis-client-runner/lib/client.js`, `CLIENT_SLOT_API`):

| Slot | Kind | Use |
| --- | --- | --- |
| `shell.overlay` | list | **The pet's home in the GUI.** Shipped description: "frame-wide floating layer, above every column and outside their scroll containers … the layer itself is click-through — entries opt back into pointer events." Additive, so no shipped UI is displaced. |
| `settings.section` | list | The "拉布拉多 / Labrador" settings page. |
| `conversation.input.dock` | list | Optional: today's pose next to the composer. |
| `root`, `conversation`, `sidebar` | single | **Never register here** — occupied by shipped UI; registering replaces it. Explicitly warned against in the catalogue. |

Client services: `layout`, `locale`, `sessions`, `slots`, `theme`, `timer`, `uiWorkspace`, `workspaces`. Client events: `theme/change`, `locale/change`, `slots/changed`, `connection/reset`. Injected hooks: `useSessions`, `useWorkspaces`, `useSessionPendingInteraction`.

### 3.6 The detached desktop window

The GUI page cannot paint outside its own window, so a pet floating over *other applications* needs a second one. The only proven route here is the reference plugin's: the host half spawns its own Electron child process which creates a frameless, transparent, always-on-top, taskbar-skipping window, sized to the pet's bounding box, with `setIgnoreMouseEvents` so everything but the body is click-through. It costs a real Electron binary (~100 MB, resolved via env var → local package → `$DSH_HOME/electron`, auto-downloaded) and needs restart backoff and a circuit breaker. Milestone M4.

---

## 4. Decision

**Standalone `dsh-labrador`** — as you instructed, and as I recommended. The plugin owns its own action model rather than borrowing `dsh-pet`'s clip pool. Built in stages, in-GUI first, desktop window at M4.

---

## 5. The action model — the heart of this design

This section is the design. Everything else is plumbing.

### 5.1 An action

An action is a named thing the dog can do, owning **one or more frames**. One frame is one of your photographs.

```jsonc
// actions/walk/action.json
{
  "id": "walk",
  "label": { "zh": "走路", "en": "Walk" },
  "category": "move",
  "frames": [
    { "src": "walk-01.png", "durationMs": 170 },
    { "src": "walk-02.png", "durationMs": 170 },
    { "src": "walk-03.png", "durationMs": 170 },
    { "src": "walk-04.png", "durationMs": 170 }
  ],
  "loop": "loop",                 // loop | once | pingpong | hold
  "weight": 5,                    // relative likelihood in its category
  "noMirror": false,              // true for anything with readable text or a side-specific pose
  "interruptible": true,
  "bubble": null,                 // optional speech text pool for this action
  "movement": { "minDist": 120, "maxDist": 420, "leadMs": 200, "tailMs": 200 }
}
```

**One image is a perfectly valid action.** It holds for its duration with the idle breathing applied, and it is how most poses will be authored:

```jsonc
// actions/sit/action.json
{ "id": "sit", "category": "ambient", "frames": [{ "src": "sit.png", "durationMs": 4000 }],
  "loop": "hold", "weight": 20, "interruptible": true }
```

So the two cases you might have — *one photo per action*, or *a burst of photos per action* — are the same mechanism with a different frame count. Nothing has to be decided up front.

### 5.2 Categories — how the dog chooses what to do

Directly modelled on the reference plugin's proven pool structure, because that part of its design is sound:

| Category | Meaning | Example actions |
| --- | --- | --- |
| `idle` | The resting loop. Runs underneath everything else. | `breathe`, `look-around` |
| `ambient` | The weighted random pool. What the dog decides to do on its own. | `sit`, `lie-down`, `scratch`, `shake`, `yawn`, `sniff`, `wag`, `beg`, `roll-over`, `sleep`, `bark` |
| `move` | Actions that actually translate the dog across the screen. | `walk`, `trot`, `run` |
| `turn` | Direction changes; mirrored left/right. | `turn` |
| `drag` | While held by the cursor. | `dangle`, `flail` |
| `click` | Reactions to being clicked. | `happy`, `surprised`, `annoyed` |
| `event` | Never chosen at random; only triggered explicitly. | `working`, `approval`, `done`, `error`, `greeting` |

`ambient` weights decide the temperament: `sleep` at weight 2 and `wag` at weight 20 is a lively dog; the reverse is an old one. That is one number per action, editable in the settings page, and it is how you tune the animal without touching a photograph.

### 5.3 The state machine

The piece `dsh-pet` does not have, because a continuous video clip does not need one. Stills do — a photograph of a sitting dog cannot be made to walk by sliding it.

```
IDLE ──(timer elapses, weighted draw)──► ACTING ──(action ends)──► IDLE
IDLE/ACTING ──(move chosen)──► MOVING ──(distance reached)──► IDLE
any ──(pointer down)──► DRAGGING ──(released)──► THROWN ──(settled)──► IDLE
any ──(click)──► REACTING ──(reaction ends)──► previous state
IDLE ──(idle timeout, awake long enough)──► ASLEEP ──(click / harness activity)──► IDLE
```

Rules that keep it from looking wrong:

- An action declaring `interruptible: false` runs to completion before anything else may start.
- `sleep` may not be drawn within N minutes of waking, and a wake cannot be immediately followed by `sleep`.
- A `move` action must be preceded by a brief settle, so the dog never snaps from lying down into a walk.
- `event` actions pre-empt `ambient` but never pre-empt `drag`.
- Every transition cross-fades over ~120 ms with double-buffering, so there is never a blank frame between two photographs.

### 5.4 Facing

All frames mirror for a left-facing dog, exactly as the reference plugin mirrors its clips. Actions flagged `noMirror` are skipped when the dog faces the other way. This doubles the apparent size of your library for free, and it matters more here than in a video-based pet, because two photographs of the same pose from different angles can be genuinely different actions.

### 5.5 Calibration — the part that decides whether this looks alive or broken

This is the largest risk in the design, and I want it stated plainly rather than discovered in M2.

Your photographs were taken at different distances, at different angles, with the dog at different positions in each frame. Dropped in naively, the dog will change size and jump around the screen every time it changes action. The fix is calibration, and it has two levels:

- **Global:** one display scale and one **floor line** for the whole pet — the y-coordinate the dog's feet sit on. Every frame is drawn so its feet meet that line.
- **Per frame:** `scale` (how much to enlarge this particular photograph), `anchorX` (where the body's centre sits), `feetY` (where in this image the paws are), and an optional `crop`.

Getting `feetY` right for each photograph is the difference between a dog standing on your desktop and a dog hovering near it. I am therefore treating the **calibration editor (F4)** as part of the product, not a nicety: a preview canvas, a draggable floor line, a scale slider, and all actions previewed side by side so inconsistencies are visible at a glance.

### 5.6 What one photograph per action will and will not do

Stated honestly, because it affects what you should prepare:

| Action type | One photo enough? | Result |
| --- | --- | --- |
| Poses — sit, lie, beg, sleep, look | **Yes** | Perfect. A held pose with breathing reads correctly. |
| Reactions — happy, surprised | **Yes** | Fine, with a squash-and-stretch on the click. |
| Turn, drag | **Yes** | Fine. |
| **Walk / trot / run** | **No, not really** | A still dog sliding sideways looks like a bug. Options, in order of quality: 3–6 burst frames at 150–200 ms (best); one frame plus a horizontal bob and bobbing stride (acceptable); no movement at all (safest). |
| Bark / tail wag | Partly | Two frames (mouth open/closed, tail up/down) at ~150 ms reads well. One frame plus a small vertical bounce reads as a bark, weakly. |

The plugin will **warn loudly at load** if a `move` action has only one frame, rather than moving the dog and quietly looking wrong.

---

## 6. Import convention and authoring pipeline

The workspace is empty, so the convention is ours to set. Proposed layout — a folder is an action, the files inside it are the frames, sorted naturally (`walk-1`, `walk-2`, … `walk-10` sorts correctly):

```
$DSH_HOME/dsh-labrador/
├─ actions/
│  ├─ sit/     sit.png
│  ├─ walk/    walk-01.png  walk-02.png  walk-03.png  walk-04.png
│  ├─ sleep/   sleep.png
│  └─ beg/     beg.png
├─ actions.jsonc          # optional: categories, weights, movement, overrides
└─ derived/               # generated: thumbnails, prepared frames; safe to delete
```

Rules:

- A folder with an `action.json` uses it; a folder without one gets a sensible default derived from its name (`walk` → `category: move`, `click-*` → `category: click`), and the derived default is **shown in the settings page** so nothing is silently guessed.
- Missing categories are simply absent. The dog has less repertoire; the plugin says which categories it found and which it did not. It never substitutes a default dog.
- A malformed action is skipped with a visible error naming the file — never silently dropped.

**The import wizard (H1)** takes a folder of loose photographs and proposes an action per file (filename heuristics, plus date/time clustering to spot bursts), which you then correct in the calibration editor. This is what turns 200 unsorted photographs into a repertoire without hand-writing 200 JSON files.

---

## 7. Feature catalogue

Revised. The daily-photo machinery is gone; the action machinery replaces it. Priority: **P0** required to be worth having · **P1** first update · **P2** later · **Shelf** your call.

### A. Action library

| # | Function | P |
| --- | --- | --- |
| A1 | Scan `actions/` — folder = action, files = frames, natural sort | P0 |
| A2 | Per-action `action.json`, with a derived default when absent | P0 |
| A3 | Playback: `loop` / `once` / `pingpong` / `hold`, per-frame durations, global speed multiplier | P0 |
| A4 | One-image actions hold with breathing — the common case | P0 |
| A5 | Double-buffered cross-fade between frames and between actions; no blank frame | P0 |
| A6 | Preload the current and next action's frames; never decode more than two actions' worth | P0 |
| A7 | Loud load-time warnings: missing category, unreadable file, `move` action with a single frame, duplicate ids | P0 |
| A8 | Multi-frame flipbook from a photo burst | P1 |
| A9 | `pingpong` looping for two-frame actions (tail up / tail down) | P1 |
| A10 | Hot reload of the library without a DSH restart | P1 |
| A11 | Per-action bubble text pool | P2 |
| A12 | Short video clip as an action, alongside stills | Shelf |

### B. Behaviour and the state machine

| # | Function | P |
| --- | --- | --- |
| B1 | Full state machine: IDLE / ACTING / MOVING / DRAGGING / THROWN / REACTING / ASLEEP | P0 |
| B2 | Weighted random draw within `ambient` | P0 |
| B3 | Interrupt rules: `interruptible` flag, pre-emption by clicks and events | P0 |
| B4 | Idle timeout → asleep; any activity wakes it | P1 |
| B5 | Transitions between states pass through a settle, so poses never snap unnaturally | P1 |
| B6 | Facing left/right with mirroring; `noMirror` respected | P0 |
| B7 | Walking: distance and margin geometry, body never leaves the screen | P1 |
| B8 | A short "considering" beat before acting | P2 |
| B9 | Temperament presets (lively / sleepy / attentive) that rewrite ambient weights | P1 |
| B10 | The dog stays awake while the harness is working | P2 |

### C. Engagement with you

| # | Function | P |
| --- | --- | --- |
| C1 | Click reaction from the `click` category, with squash-and-stretch | P0 |
| C2 | Drag to move; held pose from the `drag` category | P1 |
| C3 | Throw: release velocity, parabola, edge bounce, ground friction, settle. Pure functions, shared by both shells | P1 |
| C4 | Right-click menu: play any action on demand, favourite poses, position, hide, settings | P0 |
| C5 | Hover reaction | P2 |
| C6 | Sleep after N minutes idle; wake on click or on harness activity | P1 |
| C7 | Throw-and-score, particles | Shelf |
| C8 | Multiple pets colliding | Shelf |
| C9 | A ball or toy the dog can be nudged toward | Shelf |

### D. Reacting to the harness — what makes it *DSH's* pet

| # | Function | P |
| --- | --- | --- |
| D1 | Host subscribes to `session/event`; the dog plays `working` while a turn runs | P1 |
| D2 | Approval requested → `approval`, with a bubble pointing at the prompt | P1 |
| D3 | Turn finished / failed / truncated → matching action | P1 |
| D4 | Optional system notification, using a pose as the icon | P2 |
| D5 | `/dog` command family: `/dog play <action>`, `/dog list`, `/dog calm`, `/dog hide` | P1 |
| D6 | Showing token or balance state as a mood (the installed billing plugin does a variant of this) | Shelf |

### E. Presentation

| # | Function | P |
| --- | --- | --- |
| E1 | Pet in `shell.overlay`, click-through except the dog's hit area | P0 |
| E2 | **Cut-out mode** — background removed, standing on the desktop with a soft contact shadow | P0 for the look you want; see §9 |
| E3 | **Framed mode** — the photograph presented as a mounted print. Works with no background removal at all | P0, as the fallback |
| E4 | Per-frame calibration: scale, anchorX, feetY, crop | P0 |
| E5 | Global floor line shared by every action | P0 |
| E6 | Breathing and micro-bob applied to held poses, anchored at the feet | P0 |
| E7 | Size and opacity; position by corner plus margins; snap to edges; remembered drag position | P0 |
| E8 | Multi-instance: several dogs, each with its own size, position and action subset | P1 |
| E9 | Multi-monitor and DPI-correct placement | P1 |
| E10 | Toggle: GUI only / desktop only / both / neither | P1 |
| E11 | Theme-aware tint following `theme/change` | P2 |
| E12 | Honour `prefers-reduced-motion`: no breathing, no bounce, no physics | P0 |

### F. Desktop window and calibration tooling

| # | Function | P |
| --- | --- | --- |
| F1 | Frameless transparent always-on-top window, skipped from the taskbar | P1 |
| F2 | Click-through except the body, via `setIgnoreMouseEvents` with hover hit-flip | P1 |
| F3 | Window sized to the pet's bounding box, not the screen (a full-screen transparent window blacks out under Windows DWM) | P1 |
| F4 | **Calibration editor** — preview canvas, draggable floor line, per-frame scale, all actions side by side | P0 |
| F5 | Helper lifecycle: spawn, restart with backoff, circuit breaker, stop on plugin unload | P1 |
| F6 | The two shells share one set of pure functions, so GUI and desktop cannot drift apart | P0 |

### G. Settings and configuration

| # | Function | P |
| --- | --- | --- |
| G1 | "拉布拉多 / Labrador" section in DSH Settings via `settings.section` | P0 |
| G2 | Action browser: every action listed with its frame count, category, weight, and a live preview | P0 |
| G3 | Weight sliders per action; category enable/disable | P0 |
| G4 | Live application — no restart | P0 |
| G5 | Config paths printed in the page | P0 |
| G6 | Chinese and English via `ctx.locale` | P1 |
| G7 | Import/export configuration; reset to default | P2 |

### H. Import and content preparation

| # | Function | P |
| --- | --- | --- |
| H1 | Import wizard: pick a folder, propose an action per photograph, cluster bursts | P1 |
| H2 | Batch calibration: one floor line and scale across a whole category, then correct individually | P1 |
| H3 | Automatic derivative sizes and thumbnails, cached in `derived/` | P1 |
| H4 | Automatic background removal → cut-out frames | P2 — needs a model, see §9 |
| H5 | Duplicate detection on import | P2 |
| H6 | Optional AI labelling of poses | Shelf — the only token-spending feature |

### I. Storage, quality, packaging

| # | Function | P |
| --- | --- | --- |
| I1 | Config, state and library confined to `$DSH_HOME/dsh-labrador/` | P0 |
| I2 | Atomic writes | P0 |
| I3 | Pure logic (state machine, playback timing, movement geometry, physics, config validation) in `shared/`, unit-tested | P0 |
| I4 | Idle CPU: stop rendering when hidden or minimised; no decode when nothing changes | P0 |
| I5 | Loud failure, never a silent fallback — no default dog, no silent skip | P0 |
| I6 | Packaged as ESM with `dsh.bundle.patch` + `dsh.client`; `files` whitelist | P0 |
| I7 | Documented install and uninstall, including exactly what remains in `$DSH_HOME` | P1 |
| I8 | A mock host server so the browser half can be developed without DSH | P2 |

---

## 8. Data model

```
$DSH_HOME/dsh-labrador/
├─ main-config.json       # user settings (size, position, weights, physics, reactions)
├─ actions.jsonc          # action metadata and weights; package default lives in the plugin
├─ actions/               # one folder per action; the frames inside are your photographs
├─ derived/               # generated thumbnails and prepared frames; safe to delete
├─ state/state.json       # last position, asleep/awake, current action
└─ logs/
```

```jsonc
{
  "library": { "path": "actions", "hotReload": true },
  "pets": [
    { "id": "default", "size": 320, "opacity": 1, "display": "both",
      "position": { "corner": "bottom-right", "marginX": 24, "marginY": 24 },
      "presentation": "cutout",           // cutout | framed
      "actions": { "categories": ["idle", "ambient", "move", "click", "drag", "event"],
                   "disabled": [] } }
  ],
  "behaviour": {
    "speedMultiplier": 1.0,
    "idleTimeoutMs": 90000,
    "idleBeforeAct": { "minMs": 4000, "maxMs": 20000 },
    "temperament": "lively",              // lively | sleepy | attentive | custom
    "reducedMotionRespect": true
  },
  "reactToHarness": { "working": true, "approval": true, "completion": true },
  "physics": { "gravity": 1400, "restitution": 0.78, "groundFriction": 2.5, "throwPower": 1.0 },
  "llm": { "enabled": false }             // the only token-spending switch; off by default
}
```

`presentation` and `display` are required with **no fallback**: an illegal value is a configuration error, reported loudly. That is the reference plugin's hard-won lesson and I intend to keep it.

---

## 9. Risks — the honest list

1. **Calibration is the whole game.** Stills from a real camera do not share a scale, an angle or a floor line. Without E4/E5 and F4 the dog will change size and float between actions. This is why the calibration editor is P0 and why I would build it early rather than at the end.
2. **Movement cannot be faked from one still.** Covered in §5.6. If you have no bursts, I recommend shipping with movement disabled — a stationary dog that poses is far better than a sliding one.
3. **Cut-out versus framed is the real visual fork.** Cut-out makes every action cohere into one animal on your desktop, and it is what makes mixed backgrounds (kitchen, grass, sofa) acceptable together. Framed mode needs no model and shows your actual photographs, but reads as a photo widget rather than a creature. My recommendation: build **both**, default to cut-out once H4 exists, and let framed mode be the working default until then.
4. **Background removal is a real dependency, not a free feature.** It needs a segmentation model, local or paid. Cost and installation are yours to approve. Until then: hand-cut a few favourite poses, or accept framed mode.
5. **HEIC.** If the photographs come off an iPhone they will be `.heic`, and this machine's stack has no built-in decoder. Convert on import (one extra tool) or export as JPEG. Unreadable files will be *reported*, never skipped silently.
6. **The desktop window is the expensive half** — its own Electron (~100 MB), and the failure modes the reference plugin had to solve: transparent full-screen windows black out under Windows DWM, so the window must track the pet's bounding box; and `setIgnoreMouseEvents` must flip on hover or the pet swallows clicks. Hence M4, not M1.
7. **Ambient variety needs a repertoire.** A state machine with eight actions feels alive; with three it feels like a loop. That is a content problem, not a code problem, and it is worth knowing before M2 rather than after.
8. **Two pet plugins.** `dsh-pet` is installed and disabled. If you re-enable it you will have two creatures and two settings pages competing for the same corner. Recommendation: leave it disabled, and say so in our README.
9. **`$DSH_HOME\dsh-pet\memory.json` is not mine to touch.** It belongs to the disabled plugin. I will not read it into this design and I will not delete it.

---

## 10. Milestones

| M | Deliverable | Acceptance test |
| --- | --- | --- |
| **M0** | Skeleton: manifest, `cordis.patch.yml`, host half that starts, browser half registering an empty overlay, build pipeline | Installs into the `web` profile, appears in Settings → Plugins, loads with no console error, unloads cleanly |
| **M1** | **Actions play.** Library scan, `action.json` parsing, playback modes, cross-fade, calibration applied, one action looping in the GUI | Drop in 6 action folders, including a 4-frame walk and three single-image poses; each plays correctly; all frames sit on the same floor line at the same scale; an unreadable file and a one-frame `move` action both produce visible warnings |
| **M2** | **The dog decides.** Full state machine, weighted ambient draw, transitions, facing, walking geometry, idle → asleep → wake | A 30-minute observation: no stuck state, no impossible transition (asleep → walk), the dog never leaves the screen, and the action distribution matches the configured weights within reason |
| **M3** | **It engages.** Click and drag reactions, throw physics, context menu, actions on demand, settings page with the action browser and weight sliders, zh/en locale | Physics unit tests pass; the menu can play any action; weight changes take effect live; both languages render |
| **M4** | **It lives on the desktop.** Electron helper process, transparent always-on-top window, click-through, multi-monitor, lifecycle and unload | Floats over another application; clicks pass through transparent areas; killing the helper restarts it without taking down DSH; unloading the plugin stops it |
| **M5** | **It is usable by you.** Import wizard, calibration editor, batch calibration, packaging, README, uninstall | 50 loose photographs become a working repertoire without hand-editing JSON; a fresh install on a clean profile works from the documented commands alone |
| **M6** | Optional: cut-out pipeline, AI pose labelling, video clips, scoring, multi-pet collision | Yours to choose |

M1 is the first point at which you can judge the look. I would want your eyes on it before M2 shapes the behaviour around it.

---

## 11. What I need before starting

You have already answered the big one — standalone plugin, action-driven. These remain. Anything left blank, I will decide and state the default.

1. **Do you want movement at all?** If you have burst photographs, walking is possible and worth it. If not, I recommend shipping with movement off, and building the warning instead of the slide.
2. **Cut-out or framed** — or both, as I recommend? If cut-out, are you willing to accept a local background-removal dependency (installed later, not now)?
3. **What can the dog actually do?** A list of the actions you have photographs for, in your words. Chinese is fine — I will use your names as the labels. If nothing is sorted yet, the import wizard (M5) will propose them, and M1–M4 can be built against a handful of placeholder folders.
4. **One photograph per action, or bursts?** Either is supported; it changes what M1 must prove.
5. **Where do the photographs live now**, and roughly how many? A path is enough. Any HEIC?
6. **Temperament** — a lively young Labrador or a settled older one? It sets the default weights.
7. **Harness reactions (D1–D3)** — wanted? It costs nothing and it is what makes this DSH's pet rather than a photo widget.
8. **Repertoire control** — per-action weight sliders (more UI, more control), or three temperament presets (less UI, less fiddling)?
9. **Name.** The plugin id is `dsh-labrador` unless you prefer otherwise. Does the dog have a name I should use in bubbles and the settings page?

---

## 12. Verification status

**Verified by reading the installed code:** the manifest shape, the bundle patch, the host/client split, the `__ModuleLoader__` contract; the slot catalogue including that `shell.overlay` is an additive click-through list slot and that `root` must not be registered into; `ctx.webServer.register({ kind: 'prefix' })`; the install command and profile layout; that a detached always-on-top window is achievable and by what mechanism; and that `dsh-pet` provides a working reference for every one of those seams.

**Not yet verified — I will confirm during M0 before promising them:**
- the exact peer-dependency versions this build expects (the installed `dsh-pet` pins `^0.1.1-rc.2`/`^0.1.2-rc.1` while the desktop ships 0.8.2);
- whether this build offers a convenient local (non-npm) plugin install path, or whether the profile must be linked by hand during development;
- the client-plugin reload behaviour under this build's HMR — I will not promise live reload until I have seen it.

---

## 13. How I will report

No work is reported as finished until I have run it. Each milestone ends with the files changed, the exact commands to see the result yourself, and whatever did not pass, stated plainly. If a milestone slips, you hear about it at the point it slips.

I will not scaffold anything in `D:\桌宠` until you answer §11.
