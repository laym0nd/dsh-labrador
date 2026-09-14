# dsh-labrador

A Labrador that lives in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) window.

He is made of **seventeen cut-out photographs of my dog**, driven by a small state machine. He decides for himself what to do, he can be poked, dragged and thrown, he speaks in dog, and he can be tuned from a settings page.

> **The frames are photographs of one specific dog.** Installing this plugin puts that dog in your window. If you want your own, replace the frames — see [Using your own photographs](#using-your-own-photographs).

## Install

```sh
dsh plugin --profile web add dsh-labrador
```

Then restart the harness. He appears in the bottom-right corner of the window.

## What he does

- **Decides for himself.** A state machine moves between seven phases — idle, acting, moving, sleeping, reacting, dragging and thrown — and draws from a weighted pool of poses. There are no transitions to a pose that is not reachable from the one he is in: a sleeping dog wakes to idle, never straight into a pose.
- **Poses.** Seventeen actions, twelve of which can stand on the floor: sitting, standing, looking up, lying on the sofa, asleep, sniffing, in the car, in a cone.
- **Being handled.** Click to poke him. Drag to move him, kept inside the window. Throw him and he flies — gravity, a bounce off the walls and floor, friction on landing — and **changes his face on each impact**.
- **Speaks dog.** `woof.` `hff.` `woof woof!` `yip!` `grrr.` and so on, in a bubble above his head. Vocalisations only; there are no words and so nothing to translate.
- **Right-click** for a menu: pet him, play any action at once, or send him back to his corner.
- **Reacts to the pointer only on his own body**, not on the transparent margin around him.

## Settings

**Settings → 拉布拉多 / Labrador**

Temperament (calm, attentive, lively), size, opacity, and every action with its own weight and a shown/hidden switch. Saving writes to `$DSH_HOME/dsh-labrador/main-config.json` atomically, and the dog follows without a reload.

```json
{
  "temperament": "attentive",
  "size": 1,
  "opacity": 1,
  "weights": { "sleep": 2 },
  "disabledActions": []
}
```

An illegal value is reported in the log and falls back to the documented default; nothing is silently ignored.

## How it is built

- `lib/index.js` — the host half: builds the action library and serves the frames and the settings over one HTTP route.
- `lib/client.js` — the client half: the state machine, the floor geometry, the physics, and the UI. The machine is pure — no React, no DOM, no timers — and the tests drive it directly.
- `lib/repertoire.js` — the seventeen actions, as data. Tuning his behaviour means editing this, not the engine.
- `lib/library.js` — resolves the frames, warns loudly about anything broken, and never throws away a dog quietly.
- `assets/frames/` — the normalised frames. Every one is the same 445×328 canvas with the dog at the same size, on the same floor line and the same centre, so changing pose cannot make him jump or resize.

## Using your own photographs

Drop a folder at `$DSH_HOME/dsh-labrador/actions/`. Each folder inside is an action; the images in it are its frames; an optional `action.json` overrides the defaults:

```jsonc
// $DSH_HOME/dsh-labrador/actions/sit/action.json
{
  "category": "ambient",   // idle | ambient | move | click | event
  "weight": 20,
  "loop": "hold",
  "bust": false            // true if head-and-shoulders: it cannot stand on the floor
}
```

Frames are served straight from that folder, so nothing needs rebuilding.

## Tests

```sh
npm test
```

Forty-four tests of the state machine and the physics, six of the configuration, and thirty-six smoke checks over both halves. They run by being executed directly rather than through `node --test`, because that runner spawns a child process per file and is blocked in some sandboxed environments.

## Known limitations

- **Movement is disabled.** It needs a walk action with several frames to show a stride, and there is only one walking photograph, so he stays put rather than sliding sideways. A load-time warning says so.
- **One frame is a fragment.** The `sniff` pose lost its head when it was cut out, so it looks like a piece of dog. It is included anyway, at low weight.
- The pet lives in the harness window only. There is no detached always-on-top desktop window.

## License

MIT
