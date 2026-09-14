/**
 * Host half of dsh-labrador.
 *
 * The pet lives in the browser. This half owns only what the browser cannot: the
 * action library on disk, and the route that serves the frames to the page. From
 * M5 it will own the detached desktop window as well.
 *
 * Kept deliberately thin, so that a fault here cannot take the pet's rendering
 * down with it.
 */
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLibrary } from './library.js';
import { readConfig, writeConfig } from './config.js';

/** Cordis plugin name. Matches the row id in cordis.patch.yml. */
export const name = 'labrador';

/** Services this half needs. */
export const inject = ['webServer'];

/** Where the frames are served from. Kept in one place: the browser half mirrors it. */
const ROUTE_PREFIX = '/labrador';

/** Only these extensions are ever served. */
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** $DSH_HOME, with the same fallback the reference plugin uses. */
function dshHomeDir() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

/**
 * Send one JSON body.
 * @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/**
 * Send one file, streamed.
 * @param {import('node:http').ServerResponse} res @param {string} file @param {string} contentType
 */
function sendFile(res, file, contentType) {
  // Frames never change once produced, so they are cached hard. "no-cache" would
  // make the browser revalidate on every single pose change, and during a throw
  // that is several times a second.
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable' });
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/**
 * Read a request body into a string, with a bound so a stray request cannot
 * exhaust memory.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Load the host half: build the library once, then serve it.
 * @param {any} ctx - the plugin's own context.
 */
export function apply(ctx) {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  const home = join(dshHomeDir(), 'dsh-labrador');
  const packagedFrameRoot = join(packageRoot, 'assets', 'frames');

  let library;
  let frameRoot;
  // Files the resolved library promised; nothing outside this set is ever served.
  let allowedFrames;

  // Configuration is read once, and anything wrong with it is said out loud. The
  // settings page can replace it later, so it is deliberately not constant.
  const loaded = readConfig(home);
  let config = loaded.config;
  for (const warning of loaded.warnings) console.warn(`dsh-labrador: ${warning}`);

  ctx.effect(() => {
    let disposed = false;

    (async () => {
      const built = await buildLibrary({ homeDir: home, packageRoot });
      if (disposed) return;
      library = built.actions;
      frameRoot = built.frameRoot;
      allowedFrames = new Set(built.actions.flatMap((action) => action.frames.map((f) => f.src)));

      // Warnings go to the console so they land in the harness log, not in a drawer.
      console.info(`dsh-labrador: library from ${built.source} (${library.length} actions, ${allowedFrames.size} frames), temperament=${config.temperament}`);
      for (const warning of built.warnings) console.warn(`dsh-labrador: ${warning}`);
    })().catch((error) => {
      // Loud, never silent: a broken library must not look like an empty pet.
      console.error(`dsh-labrador: library failed to build: ${error?.message ?? error}`);
    });

    const registration = ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (!url.pathname.startsWith(ROUTE_PREFIX)) {
            sendJson(res, 404, { error: 'not found' });
            return;
          }
          const rest = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '');

          // Faults on the browser side are invisible to anyone reading this log,
          // so the client posts them back here.
          if (rest === 'report') {
            const body = await readBody(req);
            let payload;
            try {
              payload = JSON.parse(body === '' ? '{}' : body);
            } catch {
              // A malformed report is still worth seeing verbatim.
              payload = { reason: 'unparseable report', detail: body.slice(0, 200) };
            }
            console.warn(`dsh-labrador: client reported ${payload.reason ?? 'a problem'}: ${JSON.stringify(payload.detail ?? {})}`);
            res.writeHead(204);
            res.end();
            return;
          }

          // The settings page reads and writes this; so does the pet, to follow
          // changes without a reload.
          if (rest === 'config.json') {
            if (req.method === 'PUT' || req.method === 'POST') {
              const body = await readBody(req);
              let candidate;
              try {
                candidate = JSON.parse(body === '' ? '{}' : body);
              } catch (error) {
                sendJson(res, 400, { error: `configuration is not valid JSON: ${error.message}` });
                return;
              }
              try {
                const written = writeConfig(home, candidate);
                config = written.config;
                for (const warning of written.warnings) console.warn(`dsh-labrador: ${warning}`);
                sendJson(res, 200, { config: written.config, warnings: written.warnings });
              } catch (error) {
                // A failed save must be reported, not swallowed: the user would
                // otherwise believe a setting had been kept when it had not.
                console.error(`dsh-labrador: configuration could not be saved: ${error?.message ?? error}`);
                sendJson(res, 500, { error: `could not save the configuration: ${error?.message ?? error}` });
              }
              return;
            }
            sendJson(res, 200, { config });
            return;
          }

          if (rest === 'library.json') {
            if (library === undefined) {
              // The page can ask before the first scan finishes; say so rather than lie.
              sendJson(res, 503, { error: 'library still loading' });
              return;
            }
            sendJson(res, 200, {
              prefix: ROUTE_PREFIX,
              source: frameRoot === packagedFrameRoot ? 'package' : 'user',
              temperament: config.temperament,
              actions: library.map((action) => ({
                id: action.id,
                category: action.category,
                weight: action.weight,
                loop: action.loop,
                bust: action.bust === true,
                noMirror: action.noMirror === true,
                sleepPose: action.sleepPose === true,
                movement: action.movement ?? null,
                calibration: action.calibration,
                frames: action.frames.map((f) => ({
                  url: `${ROUTE_PREFIX}/frame/${encodeURIComponent(f.src)}`,
                  durationMs: f.durationMs,
                  width: f.width,
                  height: f.height,
                  hit: f.hit,
                })),
              })),
            });
            return;
          }

          if (rest.startsWith('frame/')) {
            const wanted = decodeURIComponent(rest.slice('frame/'.length));
            // Traversal is impossible by construction: the name must be one the
            // library already promised, and it must not escape the frame root.
            if (allowedFrames === undefined || !allowedFrames.has(wanted)) {
              sendJson(res, 404, { error: 'no such frame' });
              return;
            }
            const file = resolve(frameRoot, normalize(wanted));
            if (!file.startsWith(resolve(frameRoot) + sep)) {
              sendJson(res, 403, { error: 'forbidden' });
              return;
            }
            sendFile(res, file, MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
            return;
          }

          sendJson(res, 404, { error: 'not found' });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    });

    return () => {
      disposed = true;
      registration?.();
    };
  }, 'dsh-labrador: action library and asset route');
}
