// The browser half of dsh-labrador: the dog herself.
//
// This file must stay a plain side-effect script: no top-level ESM import or
// export, and React arrives through the factory's require. It is served to the
// page as /plugins/dsh-labrador/client.js and has to be self-contained.
//
// Everything it draws lives inside one slot registration owned by this plugin's
// fiber, so unloading or disabling the plugin takes the dog with it.
//
// The state machine below is pure: no React, no DOM, no timers. The component
// drives it with ticks, and the offline tests drive it directly.
window.__ModuleLoader__.load({
  id: 'dsh-labrador',
  factory: (require) => {
    const React = require('react');
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // Slots is the only framework service this half needs.
    const inject = ['slots'];

    /** Where the host half serves the library. Mirrors ROUTE_PREFIX there. */
    const ROUTE_PREFIX = '/labrador';

    /** How long one photograph takes to replace another. */
    const FADE_MS = 140;

    /** How often the component advances the machine. */
    const TICK_MS = 200;

    /** Fallback frame size, used only until the library reports the real one. */
    const CANVAS_FALLBACK = { width: 445, height: 328 };

    /** How far the stage is held from the window edges when it is at home. */
    const HOME_MARGIN = { right: 24, bottom: 18 };

    /** How much she squashes when poked, and for how long. */
    const SQUASH_SCALE = 0.9;
    const SQUASH_MS = 140;

    /** Phases the dog can be in. */
    const PHASES = ['idle', 'acting', 'moving', 'sleeping', 'reacting', 'dragging', 'thrown'];

    /** A throw slower than this is a gentle put-down, not a throw. */
    const THROW_SPEED = 400;

    /** Thrown-dog physics. Plain numbers, tuned to feel like a small animal. */
    const GRAVITY = 1400;
    const RESTITUTION = 0.78;
    const GROUND_FRICTION = 2.5;
    /** Below this speed on the ground, she has stopped rather than landed. */
    const SETTLE_SPEED_X = 30;
    const SETTLE_SPEED_Y = 60;
    /** An impact slower than this is settling, not a bounce worth showing. */
    const BOUNCE_FLOOR = 150;

    /**
     * Temperaments: what kind of dog this is.
     *
     * `actAfterMs` is how long she will stand doing nothing before choosing
     * something to do; `sleepAfterMs` is how long she stays awake after being
     * roused; `bias` multiplies individual action weights, so a lively dog barely
     * sleeps and a calm one stops investigating things.
     */
    const TEMPERAMENTS = {
      calm: { actAfterMs: [12000, 40000], sleepAfterMs: 300000, bias: { sleep: 1.6, 'look-up': 0.6, sniff: 0.5 } },
      attentive: { actAfterMs: [5000, 18000], sleepAfterMs: 480000, bias: {} },
      lively: { actAfterMs: [2500, 9000], sleepAfterMs: 900000, bias: { sleep: 0.25, 'look-up': 2, sniff: 1.5 } },
    };

    // -----------------------------------------------------------------------
    // The state machine.
    // -----------------------------------------------------------------------

    /**
     * The dog's starting condition.
     * @param {() => number} rng
     * @returns {Record<string, unknown>}
     */
    function initialState(rng = Math.random) {
      return {
        phase: 'idle',
        actionId: null,
        frameIndex: 0,
        facing: 1,
        phaseMs: 0,
        idleMs: 0,
        awakeMs: 0,
        actAfterMs: randomBetween(rng, TEMPERAMENTS.attentive.actAfterMs),
        lastActionId: null,
      };
    }

    /**
     * A random number in a range.
     * @param {() => number} rng @param {[number, number]} range
     */
    function randomBetween(rng, [min, max]) {
      return min + rng() * (max - min);
    }

    /**
     * The actions the dog may choose from on its own.
     * @param {Array<any>} actions
     */
    function ambientActions(actions) {
      return actions.filter((a) => a.category === 'ambient' && (a.weight ?? 0) > 0);
    }

    /**
     * The actions available for a category, used by the explicit triggers.
     * @param {Array<any>} actions @param {string} category
     */
    function actionsIn(actions, category) {
      return actions.filter((a) => a.category === category);
    }

    /**
     * The pose she holds while doing nothing.
     *
     * Without one she would be invisible: idle is a resting state, not an absence,
     * and a dog that vanishes between poses reads as a fault rather than a pet.
     * @param {Array<any>} actions @param {() => number} rng @param {any} temperament
     * @param {string | null} avoid
     */
    function restingPose(actions, rng, temperament, avoid) {
      return pickWeighted(actionsIn(actions, 'idle'), rng(), temperament.bias, avoid);
    }

    /**
     * The pose she holds while asleep, preferring an action that declares itself one.
     * @param {Array<any>} actions @param {() => number} rng @param {any} temperament
     */
    function sleepingPose(actions, rng, temperament) {
      return actions.find((a) => a.sleepPose === true) ?? restingPose(actions, rng, temperament, null);
    }

    /**
     * Draw one action, weighted, avoiding an immediate repeat when it can.
     * Pure apart from the injected rng, so the distribution is testable.
     * @param {Array<any>} candidates @param {number} roll @param {Record<string, number>} bias
     * @param {string | null} avoid
     */
    function pickWeighted(candidates, roll, bias = {}, avoid = null) {
      const withoutRepeat = candidates.length > 1 ? candidates.filter((a) => a.id !== avoid) : candidates;
      const pool = withoutRepeat.length > 0 ? withoutRepeat : candidates;
      if (pool.length === 0) return null;
      const weights = pool.map((a) => Math.max(0, (a.weight ?? 0) * (bias[a.id] ?? 1)));
      const total = weights.reduce((sum, w) => sum + w, 0);
      if (total <= 0) {
        // Categories that are never drawn at random — click reactions and event
        // poses — carry no weights at all. Treat those as equally likely rather
        // than unpickable, or a click could never produce a reaction.
        return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
      }
      let threshold = roll * total;
      for (let i = 0; i < pool.length; i++) {
        threshold -= weights[i];
        if (threshold <= 0) return pool[i];
      }
      return pool[pool.length - 1];
    }

    /** The action a given id refers to. @param {Array<any>} actions @param {string | null} id */
    function actionById(actions, id) {
      return actions.find((a) => a.id === id) ?? null;
    }

    /** The frame the dog is showing, or null when she is between poses. */
    function currentFrame(state, actions) {
      const action = actionById(actions, state.actionId);
      if (action === null) return null;
      return action.frames[state.frameIndex] ?? null;
    }

    /**
     * Return to idle, having settled. Every phase that can be interrupted leaves
     * through here, which is what stops one pose snapping into another — and the
     * resting pose is chosen immediately, so she is never briefly invisible.
     * @param {Record<string, any>} state @param {() => number} rng @param {any} temperament
     * @param {Array<any>} actions
     */
    function toIdle(state, rng, temperament, actions) {
      const pose = restingPose(actions, rng, temperament, state.lastActionId);
      return {
        ...state,
        phase: 'idle',
        actionId: pose?.id ?? null,
        frameIndex: 0,
        phaseMs: 0,
        idleMs: 0,
        actAfterMs: randomBetween(rng, temperament.actAfterMs),
      };
    }

    /** Begin playing an action. @param {Record<string, any>} state @param {any} action @param {string} phase */
    function beginAction(state, action, phase) {
      return {
        ...state,
        phase,
        actionId: action.id,
        frameIndex: 0,
        phaseMs: 0,
        idleMs: 0,
        lastActionId: action.id,
      };
    }

    /**
     * Whether an event is one this machine understands. Unknown events are
     * ignored rather than guessed at, so a future caller cannot half-drive it.
     * @param {{ type: string }} event
     */
    function isKnownEvent(event) {
      return event.type === 'tick' || event.type === 'dragStart' || event.type === 'dragEnd'
        || event.type === 'click' || event.type === 'wake' || event.type === 'harness'
        || event.type === 'landed' || event.type === 'bounce';
    }

    /**
     * Advance the dog by one event.
     *
     * Legal transitions, and deliberately no others:
     *   idle      -> acting | moving | sleeping | reacting | dragging
     *   acting    -> idle (or dragging/reacting when the action allows it)
     *   moving    -> idle
     *   sleeping  -> idle          (waking is a transition, never a jump)
     *   reacting  -> idle | dragging
     *   dragging  -> thrown | idle
     *   thrown    -> idle
     *
     * @param {Record<string, any>} state
     * @param {{ actions: Array<any>, rng?: () => number, temperament?: string, movementEnabled?: boolean }} ctx
     * @param {{ type: string, dtMs?: number, speed?: number }} event
     * @returns {Record<string, any>}
     */
    function step(state, ctx, event) {
      const rng = ctx.rng ?? Math.random;
      const temperament = TEMPERAMENTS[ctx.temperament ?? 'attentive'] ?? TEMPERAMENTS.attentive;
      const actions = ctx.actions ?? [];

      // A drag is never interrupted by anything. She keeps whatever pose she was
      // holding: a dog who vanishes when picked up is the same fault as one who
      // vanishes when idle.
      if (event.type === 'dragStart') {
        if (state.phase === 'dragging') return state;
        return { ...state, phase: 'dragging', phaseMs: 0 };
      }
      if (isKnownEvent(event) === false) return state;

      switch (event.type) {
        case 'landed': {
          // The component owns the physics; it tells us when she has stopped.
          if (state.phase !== 'thrown') return state;
          return toIdle(state, rng, temperament, actions);
        }

        case 'bounce': {
          // Hitting something mid-flight changes her face. She stays in the air —
          // only the pose swaps, so a throw looks like a struggle rather than a
          // sequence of separate events.
          if (state.phase !== 'thrown') return state;
          const reactions = actionsIn(actions, 'click');
          const pool = reactions.length > 0 ? reactions : ambientActions(actions);
          const pose = pickWeighted(pool, rng(), temperament.bias, state.lastActionId);
          if (pose === null) return state;
          // Her flight time is preserved across the impact: beginAction would reset
          // it, and the backstop that rescues a lost dog counts from here.
          return { ...beginAction(state, pose, 'thrown'), phaseMs: state.phaseMs };
        }

        case 'dragEnd': {
          if (state.phase !== 'dragging') return state;
          // A slow release is a gentle put-down; a fast one becomes a throw.
          if ((event.speed ?? 0) <= THROW_SPEED) return toIdle(state, rng, temperament, actions);
          // She keeps her pose while flying: the physics settles her on landing.
          return { ...state, phase: 'thrown', phaseMs: 0 };
        }

        case 'click':
        case 'wake': {
          // Waking is a transition, never a jump straight into another pose.
          if (state.phase === 'sleeping') {
            return { ...toIdle(state, rng, temperament, actions), awakeMs: 0 };
          }
          if (state.phase !== 'idle' && state.phase !== 'acting') return state;
          if (state.phase === 'acting') {
            const acting = actionById(actions, state.actionId);
            if (acting?.interruptible === false) return state;
          }
          const reaction = pickWeighted(actionsIn(actions, 'click'), rng(), temperament.bias, state.lastActionId);
          if (reaction === null) return { ...state, awakeMs: 0 };
          return { ...beginAction(state, reaction, 'reacting'), awakeMs: 0 };
        }

        case 'harness': {
          // An event action is drawn from the category named by the event, but it
          // still respects an uninterruptible pose already in progress.
          if (state.phase === 'acting') {
            const acting = actionById(actions, state.actionId);
            if (acting?.interruptible === false) return state;
          }
          if (state.phase === 'dragging' || state.phase === 'thrown') return state;
          const chosen = actionById(actions, event.actionId) ?? pickWeighted(actionsIn(actions, 'event'), rng());
          if (chosen === null) return state;
          return { ...beginAction(state, chosen, 'acting'), awakeMs: 0 };
        }

        case 'tick': {
          const dt = event.dtMs ?? 0;
          let moved = {
            ...state,
            phaseMs: state.phaseMs + dt,
            awakeMs: state.awakeMs + dt,
            idleMs: state.idleMs + dt,
          };

          // A resting dog must still show a pose. If a resting phase somehow has
          // nothing to display — most often on the very first tick, before any
          // action has been chosen — pick one now rather than render nothing.
          if (moved.actionId === null && (state.phase === 'idle' || state.phase === 'sleeping')) {
            const pose = state.phase === 'sleeping'
              ? sleepingPose(actions, rng, temperament)
              : restingPose(actions, rng, temperament, state.lastActionId);
            if (pose !== null) moved = { ...moved, actionId: pose.id, frameIndex: 0, lastActionId: pose.id };
          }

          switch (state.phase) {
            case 'sleeping':
              return moved;

            case 'acting': {
              const action = actionById(actions, state.actionId);
              if (action === null) return toIdle(moved, rng, temperament, actions);
              const frame = action.frames[state.frameIndex];
              const hold = Math.max(400, frame?.durationMs ?? 4000);
              if (moved.phaseMs < hold) return moved;
              const lastFrame = state.frameIndex + 1 >= action.frames.length;
              if (!lastFrame) return { ...moved, frameIndex: state.frameIndex + 1, phaseMs: 0 };
              // Only a repeating action can keep the dog in one phase indefinitely;
              // 'hold' and 'once' release her back to idle to choose again.
              if (action.loop === 'loop' || action.loop === 'pingpong') {
                return { ...moved, frameIndex: 0, phaseMs: 0 };
              }
              return toIdle(moved, rng, temperament, actions);
            }

            case 'moving':
              // Movement is only reachable when a move action has enough frames
              // to show a stride; see the load-time warning in the host half.
              return toIdle(moved, rng, temperament, actions);

            case 'reacting':
              if (moved.phaseMs < 2000) return moved;
              return toIdle(moved, rng, temperament, actions);

            case 'thrown':
              // The physics tells us when she has landed; this is only a backstop
              // so a lost animation frame can never strand her mid-air.
              if (moved.phaseMs < 5000) return moved;
              return toIdle(moved, rng, temperament, actions);

            case 'dragging':
              return moved;

            case 'idle':
            default: {
              if (moved.awakeMs >= temperament.sleepAfterMs) {
                const pose = sleepingPose(actions, rng, temperament);
                return {
                  ...moved,
                  phase: 'sleeping',
                  actionId: pose?.id ?? null,
                  frameIndex: 0,
                  phaseMs: 0,
                  idleMs: 0,
                  lastActionId: pose?.id ?? moved.lastActionId,
                };
              }
              if (moved.idleMs < state.actAfterMs) return moved;
              const candidate = pickWeighted(ambientActions(actions), rng(), temperament.bias, state.lastActionId);
              if (candidate === null) {
                return { ...moved, actAfterMs: randomBetween(rng, temperament.actAfterMs), idleMs: 0 };
              }
              const phase = candidate.category === 'move' && ctx.movementEnabled === true ? 'moving' : 'acting';
              return beginAction(moved, candidate, phase);
            }
          }
        }

        default:
          return state;
      }
    }

    // -----------------------------------------------------------------------
    // Floor geometry and physics.
    // -----------------------------------------------------------------------

    /**
     * How one photograph is placed on the floor.
     *
     * Every normalised frame is the same canvas, so the rule is simply: fill the
     * stage and sit its bottom-centre on the stage's bottom-centre. That is what
     * makes pose changes invisible — same size, same centre, same floor line.
     *
     * Pure, so the geometry can be tested without a browser.
     * @param {{scale?: number, anchorX?: number} | undefined} calibration
     * @param {number} stageHeight - the stage's height in CSS pixels.
     * @returns {Record<string, string | number>}
     */
    function frameStyle(calibration, stageHeight) {
      const scale = calibration?.scale ?? 1;
      const anchorX = calibration?.anchorX ?? 0.5;
      const offset = `${anchorX * 100}%`;
      return {
        position: 'absolute',
        bottom: 0,
        left: offset,
        transform: `translateX(-${offset})`,
        height: stageHeight * scale,
        width: 'auto',
        display: 'block',
      };
    }

    /**
     * Place the dog's interactive area over the part of the canvas she occupies.
     *
     * Without this a click anywhere in the transparent margin would count as
     * touching her, and she would swallow clicks meant for the app behind her.
     * Pure, so the geometry can be tested.
     * @param {{left: number, top: number, width: number, height: number} | null} hit
     * @param {{width: number, height: number}} canvas
     */
    function hitStyle(hit, canvas, scale = 1) {
      if (hit === null || hit === undefined) {
        // No manifest to consult: fall back to the whole canvas rather than make
        // her untouchable. Slightly greedy beats impossible to pet.
        return { position: 'absolute', left: 0, top: 0, width: canvas.width, height: canvas.height };
      }
      // The manifest is in frame pixels, so a scaled pet needs a scaled hit box.
      return {
        position: 'absolute',
        left: hit.left * scale,
        top: hit.top * scale,
        width: hit.width * scale,
        height: hit.height * scale,
      };
    }

    /**
     * One step of thrown-dog physics.
     *
     * Mutates `vel`, which is the caller's live velocity, and reports whether she
     * has come to rest. No DOM and no timers, so it is testable directly.
     * @param {{x: number, y: number}} pos @param {{x: number, y: number}} vel
     * @param {number} dt @param {{left: number, top: number, right: number, floor: number, width: number, height: number}} bounds
     */
    function integrate(pos, vel, dt, bounds) {
      vel.y += GRAVITY * dt;
      let x = pos.x + vel.x * dt;
      let y = pos.y + vel.y * dt;
      let grounded = false;
      // A bounce is an impact, not merely resting. Without the threshold below,
      // gravity would push her into the floor every frame and she would "bounce"
      // continuously while sitting still.
      let bounced = false;
      if (y + bounds.height > bounds.floor) {
        y = bounds.floor - bounds.height;
        if (Math.abs(vel.y) > BOUNCE_FLOOR) bounced = true;
        vel.y = -vel.y * RESTITUTION;
        grounded = true;
      }
      if (y < bounds.top) {
        y = bounds.top;
        if (Math.abs(vel.y) > BOUNCE_FLOOR) bounced = true;
        vel.y = -vel.y * RESTITUTION;
      }
      if (x < bounds.left) {
        x = bounds.left;
        if (Math.abs(vel.x) > BOUNCE_FLOOR) bounced = true;
        vel.x = -vel.x * RESTITUTION;
      }
      if (x + bounds.width > bounds.right) {
        x = bounds.right - bounds.width;
        if (Math.abs(vel.x) > BOUNCE_FLOOR) bounced = true;
        vel.x = -vel.x * RESTITUTION;
      }
      if (grounded) vel.x *= Math.max(0, 1 - GROUND_FRICTION * dt);
      const settled = grounded && Math.abs(vel.x) < SETTLE_SPEED_X && Math.abs(vel.y) < SETTLE_SPEED_Y;
      if (settled) {
        vel.x = 0;
        vel.y = 0;
      }
      return { x, y, settled, bounced };
    }

    /** Last time a fault was reported, so a repeating one cannot flood the log. */
    let lastReport = 0;

    /**
     * Tell the host half that something went wrong on this side.
     *
     * The browser console is invisible to anyone reading the harness log, so a
     * client-side fault has to be posted back to be seen at all. Throttled, because
     * the fault being reported is usually one that repeats every frame.
     * @param {string} reason @param {Record<string, unknown>} detail
     */
    function reportFault(reason, detail) {
      const now = Date.now();
      if (now - lastReport < 1000) return;
      lastReport = now;
      console.warn(`dsh-labrador: ${reason}`, detail);
      fetch(`${ROUTE_PREFIX}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, detail }),
      }).catch(() => {
        // A failed report must never become a second fault.
      });
    }

    // -----------------------------------------------------------------------
    // Presentation.
    // -----------------------------------------------------------------------

    /** True when the user has asked for less movement. */
    function prefersReducedMotion() {
      return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * Fetch the action library from the host half, retrying while it still scans.
     * @returns {Promise<{actions: Array<any>, temperament?: string}>}
     */
    async function loadLibrary() {
      let lastError = 'library unavailable';
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const response = await fetch(`${ROUTE_PREFIX}/library.json`, { cache: 'no-store' });
          if (response.ok) return await response.json();
          lastError = `HTTP ${response.status}`;
          // A 503 means the scan is still running; anything else is a real fault.
          if (response.status !== 503) break;
        } catch (error) {
          lastError = error?.message ?? String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(lastError);
    }

    /**
     * The stage: the dog, deciding for herself what to do, and putting up with
     * being poked, petted, dragged and thrown.
     * @param {{temperament?: string}} props
     */
    function LabradorStage({ temperament: initialTemperament = 'attentive' } = {}) {
      // Re-rendered whenever the settings change, so a saved setting takes effect
      // without a reload.
      const [, refresh] = React.useReducer((n) => n + 1, 0);
      const [error, setError] = React.useState(null);
      const [state, setState] = React.useState(() => initialState());
      const [outgoing, setOutgoing] = React.useState(null);
      const [pos, setPos] = React.useState(null);
      const [squash, setSquash] = React.useState(false);
      const [menu, setMenu] = React.useState(null);
      const [bubble, setBubble] = React.useState(null);

      const posRef = React.useRef(null);
      const vel = React.useRef({ x: 0, y: 0 });
      const drag = React.useRef(null);
      const suppressClick = React.useRef(false);
      const still = prefersReducedMotion();

      React.useEffect(() => store.subscribe(() => refresh()), []);

      React.useEffect(() => {
        ensureLoaded().catch((cause) => {
          console.error(`dsh-labrador: ${cause.message}`);
          setError(cause.message);
        });
      }, []);

      const payload = store.library;
      const config = store.config;

      // Bust frames are head-and-shoulders: they belong in a speech bubble, not
      // standing on the floor, so the floor rotation leaves them out entirely.
      // Disabled actions and weight overrides are applied here, in one place.
      const actions = applyConfig(payload?.actions ?? [], config);
      const temperament = config?.temperament ?? payload?.temperament ?? initialTemperament;
      const movementEnabled = actions.some((a) => a.category === 'move' && a.frames.length >= 2);
      const context = { actions, temperament, movementEnabled };

      // The interval below outlives any single render, so it has to read the
      // current context rather than the one captured when it was created. Without
      // this, a weight changed in the settings would not take effect until the
      // number of actions happened to change — a fault that would look like the
      // settings page being broken.
      const contextRef = React.useRef(context);
      contextRef.current = context;

      // One heartbeat drives everything: the machine decides, the component obeys.
      React.useEffect(() => {
        if (payload === null) return undefined;
        const timer = setInterval(
          () => setState((s) => step(s, contextRef.current, { type: 'tick', dtMs: TICK_MS })),
          TICK_MS,
        );
        return () => clearInterval(timer);
      }, [payload, temperament]);

      // A pose that is not in the list renders as nothing at all, which looks
      // exactly like the pet vanishing. Rather than blank, fall back to a pose that
      // does exist — and say so, because a dangling id is a fault worth knowing
      // about rather than papering over in silence.
      let action = actions.find((a) => a.id === state.actionId) ?? null;
      if (action === null && actions.length > 0) {
        reportFault('dangling-action', { wanted: state.actionId, phase: state.phase, used: actions[0].id });
        action = actions[0];
      }
      let frame = action?.frames?.[state.frameIndex] ?? null;
      if (action !== null && frame === null) {
        // The frame index ran past the end of the action's frames.
        reportFault('frame-out-of-range', {
          action: action.id,
          frameIndex: state.frameIndex,
          frames: action.frames.length,
          phase: state.phase,
        });
        frame = action.frames[0] ?? null;
      }
      const src = frame?.url ?? null;

      // Remember what we came from — at its own size — so it fades out rather
      // than snapping.
      const previous = React.useRef(null);
      React.useEffect(() => {
        const before = previous.current;
        previous.current = src === null ? null : { src, calibration: action?.calibration };
        if (before !== null && before.src !== src) {
          setOutgoing(before);
          const timer = setTimeout(() => setOutgoing(null), FADE_MS);
          return () => clearTimeout(timer);
        }
        return undefined;
      }, [src, action]);

      // Every normalised frame is the same canvas, so the stage is simply that
      // canvas, scaled to whatever size the settings ask for. Reserved once; no
      // pose can change its size.
      const petScale = config?.size ?? 1;
      const canvas = {
        width: (frame?.width ?? CANVAS_FALLBACK.width) * petScale,
        height: (frame?.height ?? CANVAS_FALLBACK.height) * petScale,
      };

      /** Where she sits when nobody has moved her, clamped into the window. */
      const homePos = React.useCallback(() => {
        const vw = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
        const vh = typeof window.innerHeight === 'number' ? window.innerHeight : 800;
        return {
          x: Math.max(0, vw - HOME_MARGIN.right - canvas.width),
          y: Math.max(0, vh - HOME_MARGIN.bottom - canvas.height),
        };
      }, [canvas.width, canvas.height]);

      React.useEffect(() => {
        if (pos !== null) return;
        const start = homePos();
        posRef.current = start;
        setPos(start);
      }, [pos, homePos]);

      // Changing the pet's size can leave her hanging off the edge of the window,
      // and once lost from view she cannot be dragged back. Pull her in.
      React.useEffect(() => {
        if (pos === null) return;
        const vw = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
        const vh = typeof window.innerHeight === 'number' ? window.innerHeight : 800;
        const x = Math.min(Math.max(0, pos.x), Math.max(0, vw - canvas.width));
        const y = Math.min(Math.max(0, pos.y), Math.max(0, vh - canvas.height));
        if (x !== pos.x || y !== pos.y) {
          posRef.current = { x, y };
          setPos({ x, y });
        }
        // Deliberately keyed on the size alone: re-running on every move would
        // fight the drag.
      }, [canvas.width, canvas.height]);

      /** Move her, keeping her wholly inside the window. */
      const place = React.useCallback((next) => {
        if (still) {
          const home = homePos();
          posRef.current = home;
          setPos(home);
          return;
        }
        posRef.current = next;
        setPos(next);
      }, [still, homePos]);

      /** Say something, in dog. @param {string} mood */
      const say = React.useCallback((mood) => {
        setBubble({ text: speak(mood, Math.random()), id: Math.random() });
      }, []);

      // A spoken sound fades on its own; she does not hold a thought for long.
      React.useEffect(() => {
        if (bubble === null) return undefined;
        const timer = setTimeout(() => setBubble(null), BUBBLE_MS);
        return () => clearTimeout(timer);
      }, [bubble]);

      // Occasionally she mutters to herself when she settles on something to do,
      // but not so often that it becomes noise.
      const lastSpoken = React.useRef(null);
      React.useEffect(() => {
        if (state.phase !== 'acting' || state.actionId === null) return;
        if (lastSpoken.current === state.actionId) return;
        lastSpoken.current = state.actionId;
        if (Math.random() < 0.25) say('content');
      }, [state.phase, state.actionId, say]);

      const poke = (event) => {
        event.preventDefault();
        // A drag ends with a click event too, and being thrown is not the same as
        // being poked. Swallow the click that follows any real movement.
        if (suppressClick.current) return;
        if (still) return;
        setSquash(true);
        setTimeout(() => setSquash(false), SQUASH_MS);
        say('pleased');
        setState((s) => step(s, context, { type: 'click' }));
      };

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        // Touching her means the menu is no longer wanted.
        setMenu(null);
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        drag.current = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          originX: posRef.current?.x ?? 0,
          originY: posRef.current?.y ?? 0,
          lastX: event.clientX,
          lastY: event.clientY,
          lastT: now,
        };
        vel.current = { x: 0, y: 0 };
        if (event.currentTarget.setPointerCapture !== undefined) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        setState((s) => step(s, context, { type: 'dragStart' }));
      };

      const onPointerMove = (event) => {
        const held = drag.current;
        if (held === null) return;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsed = Math.max(1, now - held.lastT);
        // Velocity in pixels per second, from where the cursor just was. Recorded
        // continuously because at the moment of release the pointer has barely
        // moved, and measuring then would always say nought.
        vel.current = {
          x: ((event.clientX - held.lastX) / elapsed) * 1000,
          y: ((event.clientY - held.lastY) / elapsed) * 1000,
        };
        held.lastX = event.clientX;
        held.lastY = event.clientY;
        held.lastT = now;
        place({
          x: held.originX + (event.clientX - held.pointerX),
          y: held.originY + (event.clientY - held.pointerY),
        });
      };

      const onPointerUp = (event) => {
        const held = drag.current;
        if (held === null) return;
        drag.current = null;
        const travelled = Math.hypot(event.clientX - held.pointerX, event.clientY - held.pointerY);
        // Anything beyond a few pixels was a drag, not a poke.
        suppressClick.current = travelled > 4;
        setTimeout(() => { suppressClick.current = false; }, 0);
        const speed = Math.hypot(vel.current.x, vel.current.y);
        // A slow release is a gentle put-down; a fast one is a throw.
        if (speed > THROW_SPEED && still === false) say('startled');
        setState((s) => step(s, context, { type: 'dragEnd', speed }));
      };

      // While she is in the air, the physics runs.
      React.useEffect(() => {
        if (state.phase !== 'thrown' || still) return undefined;
        let frameId;
        let last = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const loop = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          const vw = typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
          const vh = typeof window.innerHeight === 'number' ? window.innerHeight : 800;
          const bounds = { left: 0, top: 0, right: vw, floor: vh, width: canvas.width, height: canvas.height };
          const next = integrate(posRef.current ?? homePos(), vel.current, dt, bounds);
          posRef.current = { x: next.x, y: next.y };
          setPos({ x: next.x, y: next.y });
          if (next.bounced) {
            // Every impact swaps her face, so a throw looks like a scramble
            // through the air rather than one photograph sliding about.
            setState((s) => step(s, contextRef.current, { type: 'bounce' }));
            say('startled');
          }
          if (next.settled) {
            setState((s) => step(s, context, { type: 'landed' }));
            say('content');
            return;
          }
          frameId = requestAnimationFrame(loop);
        };
        frameId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frameId);
      }, [state.phase, still, canvas.width, canvas.height, homePos]);

      const stage = {
        position: 'fixed',
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        width: canvas.width,
        height: canvas.height,
        opacity: config?.opacity ?? 1,
        userSelect: 'none',
        // The stage itself stays transparent to clicks; only the dog's own area
        // below opts back in, so the margin around her remains click-through.
        pointerEvents: 'none',
        transformOrigin: 'bottom center',
        transition: squash ? `transform ${SQUASH_MS}ms ease-out` : 'none',
        transform: squash ? `scaleY(${SQUASH_SCALE})` : 'none',
      };

      if (error !== null) {
        // Loud, never silent: a pet that failed to load must not simply be absent.
        return React.createElement('div', {
          title: `dsh-labrador: ${error}`,
          style: { ...stage, width: 18, height: 18, borderRadius: '50%', background: '#c0392b' },
        });
      }

      if (src === null) return null;

      const placement = frameStyle(action?.calibration, canvas.height);
      // Mirroring is skipped for actions flagged noMirror: a photograph carrying
      // readable text must not be flipped.
      const facing = action?.noMirror === true ? 1 : state.facing;
      return React.createElement(
        'div',
        { style: stage, title: `${action?.id ?? ''} (${state.phase})` },
        // Deliberately no key on this image. With one, React unmounts and rebuilds
        // the element every time her pose changes, and a fresh element has no
        // bitmap to paint until the new one has decoded. During a throw the pose
        // changes on every bounce — which is exactly when she blinked out of view.
        React.createElement('img', {
          src,
          alt: '',
          draggable: false,
          style: { ...placement, transform: `${placement.transform} scaleX(${facing})` },
        }),
        outgoing !== null && !still
          ? React.createElement('img', {
              key: `out-${outgoing.src}`,
              src: outgoing.src,
              alt: '',
              draggable: false,
              style: {
                ...frameStyle(outgoing.calibration, canvas.height),
                opacity: 0,
                transition: `opacity ${FADE_MS}ms linear`,
              },
            })
          : null,
        // The dog's own area: the only part of the stage that accepts the pointer.
        React.createElement('div', {
          key: 'hit',
          title: action?.id ?? 'labrador',
          style: {
            ...hitStyle(frame?.hit, canvas, petScale),
            pointerEvents: 'auto',
            cursor: state.phase === 'dragging' ? 'grabbing' : 'grab',
          },
          onContextMenu: (event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          },
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onClick: poke,
        }),
        // A bark above her head: vocalisations only, never words.
        bubble !== null
          ? React.createElement('div', {
              key: `bubble-${bubble.id}`,
              style: {
                position: 'absolute',
                bottom: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginBottom: 6,
                padding: '3px 10px',
                borderRadius: 12,
                border: '1px solid var(--line, rgba(128, 128, 128, 0.35))',
                background: 'var(--card, #232323)',
                color: 'var(--ink, #e6e6e6)',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              },
            }, bubble.text)
          : null,
        menu !== null
          ? React.createElement(ActionMenu, {
              key: 'menu',
              x: menu.x,
              y: menu.y,
              actions,
              onClose: () => setMenu(null),
              onHome: () => {
                const home = homePos();
                posRef.current = home;
                setPos(home);
                setMenu(null);
              },
              onPick: (id) => {
                setMenu(null);
                setState((s) => step(s, context, { type: 'harness', actionId: id }));
              },
              onPet: () => {
                setMenu(null);
                // Petting is a friendly thing: a pleased noise and a reaction.
                say('pleased');
                setState((s) => step(s, context, { type: 'click' }));
              },
            })
          : null,
      );
    }

    // -----------------------------------------------------------------------
    // Shared state, and the settings the dog obeys.
    // -----------------------------------------------------------------------

    /**
     * A tiny store.
     *
     * The pet and the settings page are two separate registrations living in this
     * one module, so they share this rather than a framework. When a setting is
     * saved, the dog follows immediately without a reload.
     */
    const store = {
      library: null,
      config: null,
      listeners: new Set(),
      subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      publish() {
        for (const listener of this.listeners) listener();
      },
      setLibrary(next) {
        this.library = next;
        this.publish();
      },
      setConfig(next) {
        this.config = next;
        this.publish();
      },
    };

    /** In-flight load, so the pet and the settings page do not each fetch. */
    let loading = null;

    /**
     * Load the library and the configuration once, retrying while the host scans.
     * @returns {Promise<void>}
     */
    function ensureLoaded() {
      if (store.library !== null && store.config !== null) return Promise.resolve();
      if (loading !== null) return loading;
      loading = (async () => {
        store.setLibrary(await loadLibrary());
        const response = await fetch(`${ROUTE_PREFIX}/config.json`, { cache: 'no-store' });
        if (response.ok === false) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        store.setConfig(payload.config ?? payload);
      })().catch((error) => {
        // Let a later attempt try again rather than caching the failure.
        loading = null;
        throw error;
      });
      return loading;
    }

    /**
     * What the dog may actually do, once the settings have had their say:
     * disabled actions removed, weight overrides applied, bust frames kept off the
     * floor.
     * Pure, so the rules can be tested without a browser.
     * @param {Array<any>} actions @param {{disabledActions?: string[], weights?: Record<string, number>} | null} config
     */
    function applyConfig(actions, config) {
      const disabled = new Set(config?.disabledActions ?? []);
      const weights = config?.weights ?? {};
      return actions
        .filter((action) => action.bust !== true && disabled.has(action.id) === false)
        .map((action) => {
          const override = weights[action.id];
          return override === undefined ? action : { ...action, weight: override };
        });
    }

    /**
     * What the dog says.
     *
     * Vocalisations only, never words: a bark, a woof, a whine, a grumble. Mood is
     * carried by which sound is chosen and by the pose played with it, so nothing
     * here needs translating and nothing can accidentally turn into speech.
     */
    const VOCABULARY = {
      content: ['woof.', 'hff.', 'mmm.'],
      pleased: ['woof woof!', 'arf!', 'wuff!'],
      startled: ['yip!', 'arf arf!', 'wuff!'],
      cross: ['grrr.', 'ruff!'],
      sleepy: ['hhmmm...', 'hff...'],
    };

    /** How long a spoken sound stays on screen. */
    const BUBBLE_MS = 1400;

    /**
     * Pick a sound for a mood.
     * Pure, so the vocabulary can be tested without a browser.
     * @param {string} mood @param {number} roll
     */
    function speak(mood, roll) {
      const pool = VOCABULARY[mood] ?? VOCABULARY.content;
      return pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
    }

    /** Words, in the two languages the harness ships. */
    const LABELS = {
      en: {
        title: 'Labrador',
        subtitle: 'The dog living in the corner of this window.',
        temperament: 'Temperament',
        size: 'Size',
        opacity: 'Opacity',
        actions: 'Actions',
        enabled: 'Shown',
        onDemand: 'Right-click the dog to play any action at once.',
        pet: 'Pet her',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved.',
        savedWithWarnings: 'Saved, with notes',
        saveFailed: 'Could not save',
        home: 'Back to the corner',
        calm: 'Calm',
        attentive: 'Attentive',
        lively: 'Lively',
        category: { idle: 'Resting', ambient: 'Its own ideas', click: 'Reactions', move: 'Moving', event: 'Occasions' },
      },
      zh: {
        title: '拉布拉多',
        subtitle: '住在窗口角落里的那只狗。',
        temperament: '性格',
        size: '大小',
        opacity: '不透明度',
        actions: '动作',
        enabled: '启用',
        onDemand: '右键点击狗，可以立刻播放任意动作。',
        pet: '摸摸它',
        save: '保存',
        saving: '保存中…',
        saved: '已保存。',
        savedWithWarnings: '已保存，但有几处说明',
        saveFailed: '保存失败',
        home: '回到角落',
        calm: '安静',
        attentive: '警觉',
        lively: '活泼',
        category: { idle: '休息', ambient: '自选动作', click: '回应', move: '移动', event: '特殊时刻' },
      },
    };

    /** The active language, taken from the harness when it can be reached. */
    let language = 'en';

    /** One word, in the current language. @param {string} key */
    function t(key) {
      const dict = LABELS[language] ?? LABELS.en;
      return dict[key] ?? LABELS.en[key] ?? String(key);
    }

    /** A label for an action's category. @param {string} category */
    function categoryLabel(category) {
      const dict = LABELS[language] ?? LABELS.en;
      return dict.category?.[category] ?? category;
    }

    /**
     * The right-click menu: every action, playable at once.
     * @param {{x: number, y: number, actions: Array<any>, onPick: (id: string) => void, onPet: () => void, onClose: () => void, onHome: () => void}} props
     */
    function ActionMenu({ x, y, actions, onPick, onPet, onClose, onHome }) {
      const categories = [...new Set(actions.map((a) => a.category))];
      const width = 190;
      const style = {
        position: 'fixed',
        left: Math.max(8, Math.min(x, (window.innerWidth ?? 1280) - width - 8)),
        top: Math.max(8, Math.min(y, (window.innerHeight ?? 800) - 280)),
        minWidth: width,
        maxHeight: 300,
        overflowY: 'auto',
        padding: '6px 0',
        border: '1px solid var(--line, rgba(128, 128, 128, 0.35))',
        borderRadius: 10,
        background: 'var(--card, #232323)',
        color: 'var(--ink, #e6e6e6)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
        fontSize: 13,
        zIndex: 10,
        pointerEvents: 'auto',
      };
      const row = { padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' };
      const head = { padding: '6px 12px 2px', opacity: 0.55, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.06 };
      return React.createElement(
        'div',
        { style, onMouseLeave: onClose, onContextMenu: (event) => event.preventDefault() },
        React.createElement('div', { style: row, onClick: onPet }, t('pet')),
        React.createElement('div', { style: row, onClick: onHome }, t('home')),
        React.createElement('div', { style: { height: 1, background: 'var(--line, rgba(128,128,128,0.35))', margin: '4px 0' } }),
        categories.map((category) => React.createElement(
          'div',
          { key: category },
          React.createElement('div', { style: head }, categoryLabel(category)),
          actions.filter((a) => a.category === category).map((a) => React.createElement('div', {
            key: a.id,
            style: row,
            onClick: () => onPick(a.id),
          }, a.id)),
        )),
      );
    }

    /**
     * The settings page, registered into DSH's settings.
     */
    function LabradorSettings() {
      const [, refresh] = React.useReducer((n) => n + 1, 0);
      const [draft, setDraft] = React.useState(null);
      const [status, setStatus] = React.useState('');

      React.useEffect(() => store.subscribe(() => refresh()), []);
      React.useEffect(() => {
        ensureLoaded().catch((error) => setStatus(`${t('saveFailed')}: ${error.message}`));
      }, []);
      React.useEffect(() => {
        if (draft === null && store.config !== null) setDraft(structuredClone(store.config));
      }, [draft]);

      const sectionTitle = { margin: '16px 0 4px', fontSize: 13, opacity: 0.75 };
      const field = { display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' };
      const name = { width: 110, opacity: 0.8, fontSize: 12 };

      const setWeight = (id, value) => {
        const weights = { ...draft.weights };
        if (value === '') delete weights[id];
        else weights[id] = Number(value);
        setDraft({ ...draft, weights });
      };

      const toggle = (id, enabled) => {
        const disabled = new Set(draft.disabledActions);
        if (enabled) disabled.delete(id);
        else disabled.add(id);
        setDraft({ ...draft, disabledActions: [...disabled] });
      };

      const save = async () => {
        setStatus(t('saving'));
        try {
          const response = await fetch(`${ROUTE_PREFIX}/config.json`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(draft),
          });
          const payload = await response.json();
          if (response.ok === false) throw new Error(payload.error ?? `HTTP ${response.status}`);
          store.setConfig(payload.config);
          setDraft(structuredClone(payload.config));
          setStatus(payload.warnings?.length > 0
            ? `${t('savedWithWarnings')}: ${payload.warnings.join('; ')}`
            : t('saved'));
        } catch (error) {
          // A save that failed must never look like a save that worked.
          setStatus(`${t('saveFailed')}: ${error.message}`);
        }
      };

      const header = [
        React.createElement('div', { key: 'h', style: { fontSize: 14, fontWeight: 600 } }, t('title')),
        React.createElement('div', { key: 's', style: { fontSize: 12, opacity: 0.6, marginTop: 2 } }, t('subtitle')),
      ];

      if (draft === null) {
        return React.createElement('div', { style: { padding: '4px 2px 16px' } },
          ...header,
          React.createElement('div', { style: { marginTop: 10, opacity: 0.7, fontSize: 12 } }, t('saving')));
      }

      const actions = (store.library?.actions ?? []).filter((a) => a.bust !== true);

      return React.createElement(
        'div',
        { style: { padding: '4px 2px 16px' } },
        ...header,

        React.createElement('div', { style: sectionTitle }, t('temperament')),
        React.createElement('select', {
          value: draft.temperament,
          onChange: (event) => setDraft({ ...draft, temperament: event.target.value }),
        }, ['calm', 'attentive', 'lively'].map((key) => React.createElement('option', { key, value: key }, t(key)))),

        React.createElement('div', { style: sectionTitle }, t('size')),
        React.createElement('input', {
          type: 'range', min: 0.4, max: 2, step: 0.05, value: draft.size,
          onChange: (event) => setDraft({ ...draft, size: Number(event.target.value) }),
        }),

        React.createElement('div', { style: sectionTitle }, t('opacity')),
        React.createElement('input', {
          type: 'range', min: 0.2, max: 1, step: 0.05, value: draft.opacity,
          onChange: (event) => setDraft({ ...draft, opacity: Number(event.target.value) }),
        }),

        React.createElement('div', { style: sectionTitle }, t('actions')),
        React.createElement('div', { style: { fontSize: 12, opacity: 0.6, marginBottom: 6 } }, t('onDemand')),
        actions.map((action) => React.createElement(
          'div',
          { key: action.id, style: field },
          React.createElement('span', { style: name }, action.id),
          React.createElement('input', {
            type: 'number', min: 0, step: 1,
            value: draft.weights[action.id] ?? action.weight,
            onChange: (event) => setWeight(action.id, event.target.value),
            style: { width: 68 },
          }),
          React.createElement('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 } },
            React.createElement('input', {
              type: 'checkbox',
              checked: draft.disabledActions.includes(action.id) === false,
              onChange: (event) => toggle(action.id, event.target.checked),
            }),
            t('enabled')),
        )),

        React.createElement('div', { style: { marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' } },
          React.createElement('button', { type: 'button', onClick: save }, t('save')),
          React.createElement('span', { style: { fontSize: 12, opacity: 0.7 } }, status)),
      );
    }

    /**
     * Register the pet's seat in the GUI.
     * @param {any} ctx - the plugin's own context.
     */
    function apply(ctx) {
      // The settings page follows the harness's active language. Asked for
      // optionally: a missing locale service must not stop the pet loading.
      const locale = ctx.get?.('locale');
      const active = locale?.getLocale?.()?.id;
      language = typeof active === 'string' && active.startsWith('zh') ? 'zh' : 'en';

      // shell.overlay is the additive, click-through floating layer — the pet's
      // home. Never register into 'root': that is a single slot and replaces the
      // entire app frame, taking every seat it declares with it.
      //
      // The registration belongs to this plugin's fiber, so disabling or unloading
      // the plugin removes the row and unmounts the dog with it.
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'labrador', order: 100 }, LabradorStage));

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'labrador', order: 60, label: () => t('title') },
          LabradorSettings,
        ));
    }

    exports.apply = apply;
    exports.inject = inject;
    // Exposed for the offline tests only; the runtime never reads it.
    exports.__internals = {
      PHASES,
      TEMPERAMENTS,
      initialState,
      step,
      pickWeighted,
      frameStyle,
      hitStyle,
      integrate,
      currentFrame,
      speak,
      applyConfig,
      VOCABULARY,
      ROUTE_PREFIX,
      FADE_MS,
      CANVAS_FALLBACK,
      THROW_SPEED,
    };
    return module.exports;
  },
});
