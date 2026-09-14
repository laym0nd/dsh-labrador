// Offline smoke test: prove both halves load, the library builds, and the asset
// route answers correctly — without needing the harness to restart.
// Run with: node tools/smoke.mjs
import { pathToFileURL } from 'node:url';
import { loadClient } from './load-client.mjs';

const ROOT = 'D:/桌宠';
let failures = 0;

/** @param {string} label @param {boolean} ok @param {string} detail */
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

// --- browser half ---------------------------------------------------------
const { module: mod, id: moduleId } = loadClient();
check('client module id', moduleId === 'dsh-labrador', `got ${moduleId}`);
check('client half exports apply()', typeof mod.apply === 'function');
check('client half injects slots', Array.isArray(mod.inject) && mod.inject.includes('slots'));

const seen = [];
mod.apply({
  slots: {
    inject: (key, cb) => { seen.push(`inject:${key}`); cb(); return () => {}; },
    register: (opts, component) => {
      seen.push(`register:${opts.name}:${opts.id}`);
      seen.push(`component:${typeof component}`);
      return () => {};
    },
  },
});
check('registers into shell.overlay', seen.includes('inject:shell.overlay'), seen.join(' | '));
check('registers into settings.section', seen.includes('inject:settings.section'), seen.join(' | '));
check('uses a fresh id, not a shipped one', seen.some((s) => s === 'register:shell.overlay:labrador'));
check('the settings page has its own id', seen.some((s) => s === 'register:settings.section:labrador'));
// Never register into a single slot: that replaces shipped UI rather than adding.
check('does not register into a single slot', !seen.some((s) => /register:(root|sidebar|conversation):/.test(s)));

// The registration must be gated by the fiber-owned inject. If it were not, the
// dog would survive the plugin being disabled or unloaded.
let registeredOutsideInject = false;
mod.apply({
  slots: {
    inject: () => () => {},
    register: () => { registeredOutsideInject = true; return () => {}; },
  },
});
check('registration is gated by the fiber-owned inject', registeredOutsideInject === false);

// Calibration and geometry: every pose must stand on the same floor line.
const { frameStyle, hitStyle } = mod.__internals ?? {};
const STAGE = 328;
const full = frameStyle({ scale: 1, anchorX: 0.5 }, STAGE);
const half = frameStyle({ scale: 0.5, anchorX: 0.5 }, STAGE);
check('a larger scale renders a taller dog', full.height > half.height, `${full.height} vs ${half.height}`);
check('every pose shares the floor line', full.bottom === 0 && half.bottom === 0);
check('the anchor shifts the photograph', frameStyle({ anchorX: 0.25 }, STAGE).left === '25%');
check('an uncalibrated frame fills the stage', frameStyle(undefined, STAGE).height === STAGE);
const CANVAS = { width: 445, height: 328 };
check('the hit area follows the dog, not the canvas',
  hitStyle({ left: 165, top: 12, width: 115, height: 300 }, CANVAS).width === 115);
check('without a manifest she is still touchable', hitStyle(null, CANVAS).width === CANVAS.width);

// --- host half ------------------------------------------------------------
const host = await import(pathToFileURL(`${ROOT}/lib/index.js`).href);
check('host half exports name', host.name === 'labrador', `got ${host.name}`);
check('host half injects webServer', Array.isArray(host.inject) && host.inject.includes('webServer'));

let route;
const hostCtx = {
  effect: (fn) => { fn(); },
  webServer: { register: (options) => { route = options; return () => {}; } },
};
host.apply(hostCtx);
check('host half registers a prefix route', route?.kind === 'prefix' && route?.path === '/labrador', `${route?.kind} ${route?.path}`);

/** A response stand-in with just enough Writable surface for stream.pipe(). */
function fakeRes() {
  const state = { status: 0, headers: null, chunks: [], ended: false };
  const res = {
    writeHead(status, headers) { state.status = status; state.headers = headers; return res; },
    write(chunk) { state.chunks.push(chunk); return true; },
    end(chunk) { if (chunk) state.chunks.push(chunk); state.ended = true; return res; },
    on() { return res; },
    once() { return res; },
    emit() { return true; },
    removeListener() { return res; },
    destroy() {},
  };
  return { res, state };
}

/** Call the route the way the web server would. */
async function request(path) {
  const { res, state } = fakeRes();
  await route.handler({ url: path, method: 'GET' }, res);
  return state;
}

// The library builds asynchronously; poll rather than guess at a delay.
let library;
for (let attempt = 0; attempt < 40; attempt++) {
  const state = await request('/labrador/library.json');
  if (state.status === 200) {
    library = JSON.parse(state.chunks.join(''));
    break;
  }
  await new Promise((r) => setTimeout(r, 50));
}
check('library.json answers', library !== undefined);
check('library carries every action', library?.actions?.length === 17, `got ${library?.actions?.length}`);
check('library reports its source', library?.source === 'package', `got ${library?.source}`);

const byId = new Map((library?.actions ?? []).map((a) => [a.id, a]));
check('sit is an idle action', byId.get('sit')?.category === 'idle');
check('walk is a move action', byId.get('walk')?.category === 'move');
check('bust frames are flagged as bust', byId.get('cone-face')?.bust === true && byId.get('sit')?.bust === false);
check('frames carry durations', (byId.get('sit')?.frames?.[0]?.durationMs ?? 0) > 0);

// The deleted photographs must not linger as actions.
for (const gone of ['lick', 'rest', 'lie-away']) {
  check(`deleted action "${gone}" is absent`, byId.get(gone) === undefined);
}

// Every normalised frame must share one canvas: that is what stops her jumping.
const shapes = new Set((library?.actions ?? []).flatMap((a) => a.frames.map((f) => `${f.width}x${f.height}`)));
check('every frame shares one canvas', shapes.size === 1, [...shapes].join(' '));
check('frames carry pixel dimensions', /^\d+x\d+$/.test([...shapes][0] ?? ''));
check('no action needs extra calibration', (library?.actions ?? []).every((a) => a.calibration?.scale === 1));

// The route must refuse anything the library never promised.
check('unknown frame is refused', (await request('/labrador/frame/nope.png')).status === 404);
check('traversal is refused', (await request('/labrador/frame/..%2F..%2Fpackage.json')).status === 404);
check('unknown route is refused', (await request('/labrador/nonsense')).status === 404);
check('another prefix is refused', (await request('/elsewhere/frame/x.png')).status === 404);

const frameUrl = byId.get('sit')?.frames?.[0]?.url ?? '';
const frameState = await request(frameUrl);
check('a promised frame is served', frameState.status === 200 && frameState.headers?.['content-type'] === 'image/png',
  `${frameState.status} ${frameState.headers?.['content-type']}`);
// Frames are immutable, and her pose is swapped several times a second during a
// throw: "no-cache" would make the browser revalidate on every single swap.
check('frames are cached hard', /immutable/.test(frameState.headers?.['cache-control'] ?? ''),
  frameState.headers?.['cache-control']);

console.log(failures === 0 ? '\nSmoke: all checks passed' : `\nSmoke: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
