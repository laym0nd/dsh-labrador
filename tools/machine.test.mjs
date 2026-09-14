// The state machine's contract, tested directly rather than through the GUI.
// Run with: node --test tools/machine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClient } from './load-client.mjs';

const { module: client } = loadClient();
const { step, initialState, pickWeighted, PHASES, TEMPERAMENTS } = client.__internals;

/** One action, one frame, held for a second. */
const mk = (id, category, weight, extra = {}) => ({
  id,
  category,
  weight,
  loop: 'hold',
  frames: [{ durationMs: 1000, url: `${id}.png`, width: 445, height: 328 }],
  ...extra,
});

const LIBRARY = [
  mk('sit', 'idle', 30),
  mk('look-up', 'ambient', 20),
  mk('sniff', 'ambient', 10),
  mk('sleep', 'ambient', 5, { sleepPose: true }),
  mk('look-at-you', 'click', 0, { bust: true }),
  mk('cone-lying', 'event', 0),
  mk('walk', 'move', 0),
];
const CTX = { actions: LIBRARY, rng: () => 0.5, temperament: 'attentive', movementEnabled: false };
const tick = (state, dtMs, ctx = CTX) => step(state, ctx, { type: 'tick', dtMs });

test('starts idle, facing right, with nothing playing', () => {
  const state = initialState(() => 0.5);
  assert.equal(state.phase, 'idle');
  assert.equal(state.facing, 1);
  assert.equal(state.actionId, null);
});

test('waits before doing anything', () => {
  const state = tick(initialState(() => 0.5), 1000);
  assert.equal(state.phase, 'idle');
});

test('chooses something once the wait elapses', () => {
  const state = tick(initialState(() => 0.5), 20000);
  assert.equal(state.phase, 'acting');
  assert.ok(state.actionId !== null, 'an action should have been chosen');
  assert.equal(LIBRARY.find((a) => a.id === state.actionId).category, 'ambient');
});

test('releases the pose when its hold expires, rather than freezing', () => {
  let state = tick(initialState(() => 0.5), 20000);
  assert.equal(state.phase, 'acting');
  const played = state.actionId;
  state = tick(state, 1200);
  assert.equal(state.phase, 'idle', 'a held pose must return to idle');
  assert.equal(LIBRARY.find((a) => a.id === state.actionId)?.category, 'idle',
    'idle holds a resting pose, not nothing');
  assert.notEqual(state.actionId, played, 'the finished action is not held on into idle');
});

test('a repeating action stays in phase across its loop', () => {
  const looping = { ...LIBRARY[1], id: 'loop-test', loop: 'loop' };
  const ctx = { ...CTX, actions: [...LIBRARY, looping] };
  let state = { ...initialState(() => 0.5), phase: 'acting', actionId: 'loop-test', frameIndex: 0, phaseMs: 0 };
  state = tick(state, 1200, ctx);
  assert.equal(state.phase, 'acting');
  assert.equal(state.frameIndex, 0, 'a single repeating frame restarts rather than ending');
});

test('falls asleep after staying awake too long', () => {
  const sleepAfter = TEMPERAMENTS.attentive.sleepAfterMs;
  const state = tick(initialState(() => 0.5), sleepAfter + 1000);
  assert.equal(state.phase, 'sleeping');
});

test('waking is a transition to idle, never a jump into another pose', () => {
  let state = tick(initialState(() => 0.5), TEMPERAMENTS.attentive.sleepAfterMs + 1000);
  assert.equal(state.phase, 'sleeping');
  state = step(state, CTX, { type: 'click' });
  assert.equal(state.phase, 'idle', 'waking must settle first');
  assert.equal(LIBRARY.find((a) => a.id === state.actionId)?.category, 'idle',
    'he wakes into a resting pose, not straight into a reaction');
});

test('a click while idle plays a click action', () => {
  const state = step(initialState(() => 0.5), CTX, { type: 'click' });
  assert.equal(state.phase, 'reacting');
  assert.equal(state.actionId, 'look-at-you');
});

test('an uninterruptible action refuses to be interrupted', () => {
  const stubborn = mk('stubborn', 'ambient', 20, { interruptible: false });
  const ctx = { ...CTX, actions: [...LIBRARY, stubborn] };
  const acting = { ...initialState(() => 0.5), phase: 'acting', actionId: 'stubborn', phaseMs: 0 };
  const after = step(acting, ctx, { type: 'click' });
  assert.equal(after.phase, 'acting');
  assert.equal(after.actionId, 'stubborn');
});

test('a drag pre-empts every phase', () => {
  for (const phase of ['idle', 'acting', 'sleeping', 'reacting']) {
    const state = { ...initialState(() => 0.5), phase, actionId: phase === 'acting' ? 'look-up' : null };
    assert.equal(step(state, CTX, { type: 'dragStart' }).phase, 'dragging', `from ${phase}`);
  }
});

test('a drag is never interrupted by a click', () => {
  const dragging = step(initialState(() => 0.5), CTX, { type: 'dragStart' });
  const after = step(dragging, CTX, { type: 'click' });
  assert.equal(after.phase, 'dragging');
});

test('a slow release settles; a fast one is thrown', () => {
  const dragging = step(initialState(() => 0.5), CTX, { type: 'dragStart' });
  assert.equal(step(dragging, CTX, { type: 'dragEnd', speed: 10 }).phase, 'idle');
  assert.equal(step(dragging, CTX, { type: 'dragEnd', speed: 900 }).phase, 'thrown');
});

test('a thrown dog waits for the physics rather than a timer', () => {
  const thrown = { ...initialState(() => 0.5), phase: 'thrown', phaseMs: 0 };
  assert.equal(tick(thrown, 700).phase, 'thrown', 'the fall is the component\'s to report');
  assert.equal(step(tick(thrown, 700), CTX, { type: 'landed' }).phase, 'idle');
});

test('a harness event plays its action', () => {
  const state = step(initialState(() => 0.5), CTX, { type: 'harness', actionId: 'cone-lying' });
  assert.equal(state.actionId, 'cone-lying');
  assert.equal(state.phase, 'acting');
});

test('movement is never entered while it is disabled', () => {
  // A move action with a single frame cannot show a stride, so the dog must stay put.
  let state = initialState(() => 0.5);
  for (let i = 0; i < 400; i++) state = tick(state, 500, { ...CTX, movementEnabled: false });
  assert.notEqual(state.phase, 'moving');
});

test('unknown events are ignored rather than guessed at', () => {
  const state = initialState(() => 0.5);
  assert.deepEqual(step(state, CTX, { type: 'nonsense' }), state);
});

// A resting dog with no pose renders as nothing at all, which looks like a fault.
// These four exist because that is exactly what happened on screen.
test('the very first tick gives him something to show', () => {
  let state = initialState(() => 0.5);
  assert.equal(state.actionId, null, 'nothing is chosen before he has ticked');
  state = tick(state, 200);
  assert.equal(state.phase, 'idle');
  assert.ok(state.actionId !== null, 'idle must hold a resting pose');
  assert.equal(LIBRARY.find((a) => a.id === state.actionId).category, 'idle');
});

test('an action ending does not leave him invisible', () => {
  let state = tick(initialState(() => 0.5), 20000);
  assert.equal(state.phase, 'acting');
  state = tick(state, 1200);
  assert.equal(state.phase, 'idle');
  assert.ok(state.actionId !== null, 'idle must hold a resting pose, not nothing');
});

test('a sleeping dog shows the sleep pose', () => {
  const state = tick(initialState(() => 0.5), TEMPERAMENTS.attentive.sleepAfterMs + 1000);
  assert.equal(state.phase, 'sleeping');
  assert.equal(state.actionId, 'sleep');
});

test('a resting dog is never left without a pose', () => {
  let seed = 987654;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let state = initialState(rng);
  for (let i = 0; i < 2000; i++) {
    state = step(state, { ...CTX, rng }, { type: 'tick', dtMs: 250 });
    if (state.phase === 'idle' || state.phase === 'sleeping') {
      assert.ok(state.actionId !== null, `invisible while ${state.phase} at step ${i}`);
    }
  }
});

// --- being touched ---------------------------------------------------------

test('a dog with a pose keeps it while being handled', () => {
  // The same fault as an invisible idle: clearing the pose mid-drag would make
  // him vanish the moment he is picked up.
  const holding = { ...initialState(() => 0.5), phase: 'idle', actionId: 'sit', frameIndex: 0 };
  const dragged = step(holding, CTX, { type: 'dragStart' });
  assert.equal(dragged.actionId, 'sit', 'still holding his pose while held');
  const flying = step(dragged, CTX, { type: 'dragEnd', speed: 1200 });
  assert.equal(flying.phase, 'thrown');
  assert.equal(flying.actionId, 'sit', 'still holding his pose in flight');
});

test('landing settles a thrown dog, and only a thrown one', () => {
  const thrown = { ...initialState(() => 0.5), phase: 'thrown', actionId: null, phaseMs: 0 };
  const landed = step(thrown, CTX, { type: 'landed' });
  assert.equal(landed.phase, 'idle');
  assert.ok(landed.actionId !== null, 'he lands into a pose, not into nothing');

  const idle = initialState(() => 0.5);
  assert.deepEqual(step(idle, CTX, { type: 'landed' }), idle);
});

test('a lost animation frame cannot strand him in the air', () => {
  const thrown = { ...initialState(() => 0.5), phase: 'thrown', actionId: null, phaseMs: 0 };
  assert.equal(tick(thrown, 1000).phase, 'thrown', 'the backstop must not fire early');
  assert.equal(tick(thrown, 6000).phase, 'idle', 'the backstop must eventually rescue him');
});

const { hitStyle, integrate, THROW_SPEED: SPEED } = client.__internals;
const CANVAS = { width: 445, height: 328 };

test('the hit area follows the dog, not the canvas', () => {
  const style = hitStyle({ left: 165, top: 12, width: 115, height: 300 }, CANVAS);
  assert.equal(style.left, 165);
  assert.equal(style.width, 115);
  assert.notEqual(style.width, CANVAS.width, 'the transparent margin must not be clickable');
});

test('without a manifest he is still touchable', () => {
  const style = hitStyle(null, CANVAS);
  assert.equal(style.width, CANVAS.width);
  assert.equal(style.height, CANVAS.height);
});

test('a throw rises and falls under gravity', () => {
  const vel = { x: 0, y: -600 };
  const bounds = { left: 0, top: 0, right: 1280, floor: 800, width: 445, height: 328 };
  const after = integrate({ x: 100, y: 400 }, vel, 0.1, bounds);
  assert.ok(after.y < 400, 'he should have moved upward first');
  assert.ok(vel.y > -600, 'gravity should be slowing his rise');
});

test('a thrown dog bounces off the floor and is never left outside the window', () => {
  const bounds = { left: 0, top: 0, right: 1280, floor: 800, width: 445, height: 328 };
  const vel = { x: 900, y: 900 };
  let pos = { x: 400, y: 300 };
  for (let i = 0; i < 400; i++) {
    const next = integrate(pos, vel, 0.016, bounds);
    pos = { x: next.x, y: next.y };
    assert.ok(pos.x >= bounds.left - 0.001, 'escaped left');
    assert.ok(pos.x + bounds.width <= bounds.right + 0.001, 'escaped right');
    assert.ok(pos.y + bounds.height <= bounds.floor + 0.001, 'fell through the floor');
    assert.ok(pos.y >= bounds.top - 0.001, 'escaped the ceiling');
    if (next.settled) break;
  }
});

test('a slow dog on the ground comes to rest', () => {
  const bounds = { left: 0, top: 0, right: 1280, floor: 800, width: 445, height: 328 };
  const vel = { x: 5, y: 0 };
  const resting = { x: 100, y: bounds.floor - bounds.height };
  const after = integrate(resting, vel, 0.016, bounds);
  assert.equal(after.settled, true);
  assert.equal(vel.x, 0);
});

test('the throw threshold distinguishes a put-down from a throw', () => {
  const dragging = step(initialState(() => 0.5), CTX, { type: 'dragStart' });
  assert.equal(step(dragging, CTX, { type: 'dragEnd', speed: SPEED - 1 }).phase, 'idle');
  assert.equal(step(dragging, CTX, { type: 'dragEnd', speed: SPEED + 1 }).phase, 'thrown');
});

// --- hitting things ---------------------------------------------------------

test('a bounce swaps his face without ending the flight', () => {
  const flying = { ...initialState(() => 0.5), phase: 'thrown', actionId: 'sit', phaseMs: 0 };
  const bounced = step(flying, CTX, { type: 'bounce' });
  assert.equal(bounced.phase, 'thrown', 'he is still in the air');
  assert.notEqual(bounced.actionId, 'sit', 'the impact should change the pose');
  assert.ok(LIBRARY.find((a) => a.id === bounced.actionId), 'and to something that exists');
});

test('a bounce outside a flight is ignored', () => {
  for (const phase of ['idle', 'acting', 'sleeping', 'dragging']) {
    const state = { ...initialState(() => 0.5), phase };
    assert.deepEqual(step(state, CTX, { type: 'bounce' }), state, `from ${phase}`);
  }
});

test('repeated bounces do not strand him in the air', () => {
  let state = { ...initialState(() => 0.5), phase: 'thrown', actionId: 'sit', phaseMs: 0 };
  for (let i = 0; i < 20; i++) state = step(state, CTX, { type: 'bounce' });
  assert.equal(state.phase, 'thrown');
  assert.equal(step(state, CTX, { type: 'landed' }).phase, 'idle');
});

test('a bounce does not buy him extra time in the air', () => {
  // Resetting the flight clock on every impact would push the rescue backstop
  // further away with each bounce, and a dog who never landed would never be
  // rescued either.
  const late = { ...initialState(() => 0.5), phase: 'thrown', actionId: 'sit', phaseMs: 4000 };
  const bounced = step(late, CTX, { type: 'bounce' });
  assert.equal(bounced.phaseMs, 4000, 'the clock keeps running through the impact');
  assert.equal(tick(bounced, 1200).phase, 'idle', 'the backstop still fires on schedule');
});

// --- the physics reporting a bounce -----------------------------------------

test('an impact is reported as a bounce, but resting is not', () => {
  const bounds = { left: 0, top: 0, right: 1280, floor: 800, width: 445, height: 328 };
  // Just above the floor and falling fast, so one step really does collide: a
  // frame at this speed advances only about fifteen pixels.
  const falling = { x: 100, y: bounds.floor - bounds.height - 2 };
  const fast = integrate(falling, { x: 0, y: 900 }, 0.016, bounds);
  assert.equal(fast.bounced, true, 'a real impact is a bounce');
  // Already resting: gravity nudges him into the floor every frame, and that must
  // not read as an endless series of bounces.
  const resting = { x: 100, y: bounds.floor - bounds.height };
  const still = integrate(resting, { x: 0, y: 0 }, 0.016, bounds);
  assert.equal(still.bounced, false, 'resting is not bouncing');
});

// --- what he says -----------------------------------------------------------

const { speak, applyConfig, VOCABULARY } = client.__internals;

test('every sound is a dog sound, and never empty', () => {
  for (const mood of Object.keys(VOCABULARY)) {
    for (const roll of [0, 0.5, 0.999]) {
      const said = speak(mood, roll);
      assert.equal(typeof said, 'string');
      assert.ok(said.length > 0, `${mood} must say something`);
      assert.ok(VOCABULARY[mood].includes(said), `${mood} must use its own vocabulary`);
    }
  }
});

test('an unknown mood still makes a sound rather than nothing', () => {
  const said = speak('existential', 0.5);
  assert.ok(VOCABULARY.content.includes(said));
});

// --- what the settings do to the repertoire ---------------------------------

test('disabled actions are dropped, weight overrides applied, busts kept off the floor', () => {
  const configured = applyConfig(LIBRARY, { disabledActions: ['sleep'], weights: { 'look-up': 99 } });
  assert.equal(configured.find((a) => a.id === 'sleep'), undefined, 'a disabled action is gone');
  assert.equal(configured.find((a) => a.id === 'look-up').weight, 99, 'the override wins');
  assert.equal(configured.find((a) => a.id === 'look-at-you'), undefined, 'a bust frame never stands on the floor');
  assert.equal(configured.find((a) => a.id === 'sit').weight, 30, 'untouched actions keep their weight');
});

test('with no settings at all, only the bust frames are removed', () => {
  const configured = applyConfig(LIBRARY, null);
  assert.equal(configured.length, LIBRARY.filter((a) => a.bust !== true).length);
});

test('the configuration never mutates the library it is given', () => {
  const before = JSON.stringify(LIBRARY);
  applyConfig(LIBRARY, { weights: { 'look-up': 1 }, disabledActions: ['sit'] });
  assert.equal(JSON.stringify(LIBRARY), before, 'the library must be left alone');
});

test('the weighted draw respects its weights', () => {
  const pool = [mk('a', 'ambient', 90), mk('b', 'ambient', 10)];
  assert.equal(pickWeighted(pool, 0.5, {}, null).id, 'a');
  assert.equal(pickWeighted(pool, 0.95, {}, null).id, 'b');
});

test('the weighted draw avoids repeating the last action when it can', () => {
  const pool = [mk('a', 'ambient', 90), mk('b', 'ambient', 10)];
  assert.equal(pickWeighted(pool, 0.5, {}, 'a').id, 'b');
});

test('the weighted draw returns nothing from an empty pool', () => {
  assert.equal(pickWeighted([], 0.5, {}, null), null);
});

test('a temperament can bias the draw', () => {
  const pool = [mk('sleep', 'ambient', 50), mk('look-up', 'ambient', 50)];
  // A lively dog barely sleeps, so the same roll should prefer the other action.
  assert.equal(pickWeighted(pool, 0.5, TEMPERAMENTS.lively.bias, null).id, 'look-up');
  assert.equal(pickWeighted(pool, 0.5, TEMPERAMENTS.calm.bias, null).id, 'sleep');
});

test('no sequence of events produces an unknown phase', () => {
  // A small deterministic generator, so a failure is reproducible.
  let seed = 12345;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const events = [
    { type: 'tick', dtMs: 500 },
    { type: 'tick', dtMs: 30000 },
    { type: 'click' },
    { type: 'dragStart' },
    { type: 'dragEnd', speed: rng() * 2000 },
    { type: 'bounce' },
    { type: 'harness', actionId: 'cone-lying' },
    { type: 'wake' },
  ];
  let state = initialState(rng);
  for (let i = 0; i < 3000; i++) {
    const event = events[Math.floor(rng() * events.length)];
    const before = state;
    state = step(state, { ...CTX, rng, movementEnabled: rng() > 0.5 }, event);
    assert.ok(PHASES.includes(state.phase), `unknown phase after ${event.type}: ${state.phase}`);
    // A sleeping dog may only wake; it must never snap into another pose.
    if (before.phase === 'sleeping' && state.phase !== 'sleeping') {
      assert.ok(state.phase === 'idle' || state.phase === 'dragging',
        `sleeping went straight to ${state.phase}`);
    }
    assert.ok(state.frameIndex >= 0, 'frame index must stay sane');
  }
});
