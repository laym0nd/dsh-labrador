# dsh-labrador — Implementation Plan

> **Change of direction, recorded here so the plan does not lie.** The detached
> desktop window — M5, items 41 to 48 — was built and verified running, and then
> **abandoned at Raymond's direction**: the dog lives inside the harness window and
> nowhere else. The helper process, its Electron window, its probe and the
> `display` setting have all been removed. The rules it used — the state machine,
> the floor geometry and the throw physics — live in `lib/client.js` and are
> untouched, so the desktop path could be rebuilt from them without rewriting any
> of them.
>
> `display` is consequently gone from the configuration; `temperament` remains.

**Purpose:** the concrete list of functions I intend to build, in build order. Strike any number and I will not build it.
**Basis:** the twenty cut-outs in `assets\cutout\`, the plugin architecture verified against DSH 0.8.2, and the action model in `docs\labrador-epet-development-document.md`.
**Build style:** plain ESM for the host half, a hand-written `window.__ModuleLoader__` bundle for the browser half. **No bundler and no npm lifecycle scripts** — the sandbox refuses the piped stdio those need, and this project does not require them.

---

## Repertoire from your photographs

Nineteen clean sprites plus one partial. Proposed assignment:

| sprite | proposed action | category |
| --- | --- | --- |
| 01 stand | `stand` | idle |
| 10 sit-a | `sit` (the main pose) | idle |
| 13 sit-c, 11 sit-b, 09 sit-side | `sit-alt` | ambient |
| 04 look-up | `look-up` | ambient / approval |
| 03 rest, 17 sleep-sofa | `rest`, `sleep` | ambient |
| 14/15 lie-sofa, 16 lie-away | `lie-sofa`, `lie-away` | ambient |
| 05 walk | `walk` — **movement off by default**, single frame | move |
| 02 lick | `lick` — click reaction | click |
| 18 portrait | `look-at-you` — click reaction | click / bust |
| 06 car-a, 07 car-b | `car` | ambient (bust) |
| 08 pant | `pant` | bust |
| 19 cone-lying | `cone-lying` — occasional mood | event |
| 20 cone-face | `cone-face` | bust |
| 12 sniff | `sniff` — partial, use with care | ambient |

---

## Voice — a hard rule

The dog speaks dog language and nothing else. Any text she emits is a
**vocalisation** — a bark, a woof, a whine, a grumble, a soft huff — never a human
word, never a translated phrase, never a sentence. Mood is carried by *which*
sound is chosen and by the pose played with it: a low whine with `rest` is
discomfort, a short repeated bark with `stand` is alarm, a single soft huff with
`lie-sofa` is contentment. The pool stays short, lowercase and language-neutral,
so that no locale switch can turn it into speech.

This constrains item 33 (context-menu labels stay human words — those are the
settings surface, not the dog), item 38 (bubble pools) and item 50 (approval).

---

## M0 — Skeleton (the plugin loads and unloads cleanly)

1. Package manifest with `dsh.bundle.patch` and `dsh.client` declarations.
2. `cordis.patch.yml` inserting the plugin row (`id: labrador`).
3. Host half entry: `name` / `inject` / `apply`, loading with no console error.
4. Browser half bundle: a side-effect script registering an empty overlay occupant.
5. Browser half registers into `shell.overlay` only — never `root`, `sidebar` or `conversation`.
6. Verify install into the `web` profile, appearance in Settings → Plugins, and clean unload.

## M1 — The actions play

7. Scan `$DSH_HOME/dsh-labrador/actions/` — folder = action, files = frames, natural sort.
8. Parse per-action `action.json`; derive sensible defaults from the folder name when absent.
9. Copy the twenty cut-outs into that tree as the initial repertoire (originals untouched).
10. Playback timing: per-frame `durationMs` plus a global speed multiplier.
11. Loop modes: `loop`, `once`, `pingpong`, `hold`.
12. One-image actions hold their pose with breathing applied — the common case here.
13. Double-buffered cross-fade between frames and between actions; no blank frame.
14. Preload the current and next action; never decode more than two actions' worth.
15. Load-time warnings, loud and specific: unreadable file, missing category, duplicate id, a `move` action with only one frame.
16. Asset route: `ctx.webServer.register({ kind: 'prefix' })` serving frames and a status JSON.

## M2 — Calibration (what decides whether it looks alive)

17. Global floor line and display scale for the pet.
18. Per-action/frame `scale`, `anchorX`, `feetY`, optional `crop`.
19. **Automatic initial calibration** from the alpha bounding box — every sprite is already trimmed to the subject, so the floor line is derivable rather than hand-guessed.
20. Calibration preview: all actions side by side on one canvas, so scale inconsistencies are visible at a glance.

## M3 — The dog decides

21. State machine: IDLE / ACTING / MOVING / DRAGGING / THROWN / REACTING / ASLEEP.
22. Weighted random draw within `ambient`.
23. `interruptible` flag; clicks and events pre-empt, drag never does.
24. Settle between states so poses never snap unnaturally.
25. Idle timeout → asleep; any activity wakes it.
26. Facing left/right with mirroring; `noMirror` respected for text-bearing sprites.
27. Movement geometry: distance, margin, body never leaves the screen — **shipped disabled** until you supply a walk burst.
28. Temperament presets (lively / sleepy / attentive) that rewrite the weights.
29. Pure logic in a `shared/` module with unit tests (`node --test`), so both shells run identical rules.

## M4 — It engages, and it is configurable

30. Click reaction from the `click` category, with squash-and-stretch.
31. Drag to move; held pose from the `drag` category; position remembered.
32. Throw physics: release velocity, parabola, edge bounce, ground friction, settle.
33. Right-click menu: play any action on demand, position, quiet, hide, settings.
34. Size and opacity controls.
35. Position by corner plus margins, with edge snapping.
36. `prefers-reduced-motion`: no breathing, no bounce, no physics.
37. Settings page in DSH Settings ("拉布拉多 / Labrador") via `settings.section`.
38. Settings content: action browser with live preview, per-action enable/disable, weight sliders, temperament, calibration editor, config paths shown.
39. Live application — changes take effect without restarting DSH.
40. Chinese and English registered through `ctx.locale`.

## M5 — It lives on the desktop

41. Electron helper process spawned by the host half, stopped on plugin unload.
42. Frameless, transparent, always-on-top window, skipped from the taskbar.
43. Window sized to the pet's bounding box, never full-screen (a full-screen transparent window blacks out under Windows DWM).
44. Click-through except the body, via `setIgnoreMouseEvents` with a hover hit-flip.
45. Multi-monitor placement and DPI-correct scaling.
46. Helper lifecycle: restart with backoff, circuit breaker, graceful shutdown.
47. stdio bridge between host and helper; both shells share one set of pure functions so they cannot drift apart.
48. `display` toggle: GUI only / desktop only / both / neither, with **no silent fallback** for an illegal value.

## M6 — Reacting to the harness, and finishing

49. Host subscribes to `session/event`; the dog plays `working` while a turn runs.
50. Approval requested → `approval` action and a bubble pointing at the prompt.
51. Turn finished / failed / truncated → matching action.
52. `/dog` commands: `play <action>`, `list`, `calm`, `hide`.
53. Config at `$DSH_HOME/dsh-labrador/main-config.json` with atomic writes.
54. Loud failure everywhere: no default dog, no silently skipped action.
55. Packaging, README, and a documented uninstall listing exactly what remains in `$DSH_HOME`.
56. Idle CPU discipline: nothing renders when hidden or minimised.

---

## Deliberately not built

- Multi-pet (>1 dog on screen), pet-versus-pet collision, throw-and-score.
- Any AI or model call. No tokens are spent by anything above.
- Movement animation from single frames — 05 will not slide sideways.
- Multiple monitors beyond correct placement (no walking across displays).
- Short video clips as actions.

---

## What this depends on from you

- Confirmation that the repertoire mapping in the table above is right.
- Whether the desktop window is wanted now (M5) or after you have lived with the in-GUI pet (M0–M4).
