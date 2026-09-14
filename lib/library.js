/**
 * Build the action library the pet actually plays.
 *
 * Two sources, in order:
 *   1. $DSH_HOME/dsh-labrador/actions/<action>/ — the user's own library, when it
 *      exists. Folders are actions, the images inside are frames, and an optional
 *      action.json overrides the derived defaults.
 *   2. the packaged repertoire over assets/cutout — the twenty photographs that
 *      shipped with the plugin.
 *
 * Failures are collected as warnings rather than thrown, so that one bad frame
 * cannot take the whole pet down; the caller decides how loudly to report them.
 */
import { existsSync } from 'node:fs';
import { readdir, open, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { DEFAULT_REPERTOIRE, DEFAULT_CALIBRATION } from './repertoire.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CATEGORIES = new Set(['idle', 'ambient', 'move', 'click', 'event']);

const PNG_SIGNATURE = 0x89504e47;

/**
 * Read a PNG's pixel size straight from its header, without an image library.
 * Why: the plugin must not depend on sharp, and the browser wants to know a
 * frame's shape before loading it, so the stage can reserve the right space.
 * @param {string} file
 * @returns {Promise<{width: number, height: number} | null>}
 */
async function pngSize(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const header = Buffer.alloc(24);
    await handle.read(header, 0, 24, 0);
    if (header.readUInt32BE(0) !== PNG_SIGNATURE) return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

/**
 * Sort frame file names the way a person reads them: walk-2 before walk-10.
 * @param {string} a @param {string} b
 */
function naturalCompare(a, b) {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * Read one action folder into an action definition.
 * @param {string} dir - absolute path to the action folder.
 * @param {string} id - the action id, taken from the folder name.
 * @param {string[]} files - image file names inside it.
 */
async function readActionFolder(dir, id, files) {
  const frames = files.sort(naturalCompare).map((src) => ({ src, durationMs: 6000 }));
  const manifestPath = join(dir, 'action.json');
  if (!existsSync(manifestPath)) return { id, category: 'ambient', weight: 10, loop: 'hold', frames };
  try {
    const raw = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'));
    return {
      id,
      category: CATEGORIES.has(raw.category) ? raw.category : 'ambient',
      weight: Number.isFinite(raw.weight) ? raw.weight : 10,
      loop: raw.loop ?? 'hold',
      bust: raw.bust === true,
      noMirror: raw.noMirror === true,
      movement: raw.movement,
      frames: Array.isArray(raw.frames) && raw.frames.length > 0 ? raw.frames : frames,
    };
  } catch (error) {
    return { id, category: 'ambient', weight: 10, loop: 'hold', frames, broken: `action.json unreadable: ${error.message}` };
  }
}

/**
 * Scan the user's own action folders.
 * @param {string} actionsDir - absolute path to $DSH_HOME/dsh-labrador/actions.
 * @returns {Promise<{ actions: object[], warnings: string[] }>}
 */
async function scanUserLibrary(actionsDir) {
  const actions = [];
  const warnings = [];
  for (const entry of (await readdir(actionsDir, { withFileTypes: true })).filter((e) => e.isDirectory())) {
    const dir = join(actionsDir, entry.name);
    const files = (await readdir(dir)).filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()));
    if (files.length === 0) {
      warnings.push(`action "${entry.name}" has no images and was skipped`);
      continue;
    }
    const action = await readActionFolder(dir, entry.name, files);
    if (action.broken) warnings.push(`action "${entry.name}": ${action.broken}`);
    actions.push(action);
  }
  return { actions, warnings };
}

/**
 * Resolve the packaged default, checking that every promised frame exists.
 * @param {string} frameRoot - absolute path to assets/cutout.
 */
async function readPackagedLibrary(frameRoot) {
  const warnings = [];
  const present = new Set(await readdir(frameRoot));
  const actions = [];
  for (const action of DEFAULT_REPERTOIRE) {
    const frames = action.frames.filter((f) => {
      if (present.has(f.src)) return true;
      warnings.push(`action "${action.id}": frame "${f.src}" is missing from ${frameRoot}`);
      return false;
    });
    if (frames.length === 0) {
      warnings.push(`action "${action.id}" was dropped: none of its frames exist`);
      continue;
    }
    actions.push({ ...action, frames });
  }
  return { actions, warnings };
}

/**
 * Build the library.
 * @param {{ homeDir: string, packageRoot: string }} paths
 * @returns {Promise<{ source: string, frameRoot: string, actions: object[], warnings: string[] }>}
 */
export async function buildLibrary({ homeDir, packageRoot }) {
  const userDir = join(homeDir, 'actions');
  // assets/frames/ holds the normalised frames: one canvas, one floor line, one centre.
  const packagedRoot = join(packageRoot, 'assets', 'frames');

  const built = existsSync(userDir) && (await readdir(userDir)).length > 0
    ? { ...(await scanUserLibrary(userDir)), source: 'user', frameRoot: userDir }
    : { ...(await readPackagedLibrary(packagedRoot)), source: 'package', frameRoot: packagedRoot };

  const warnings = [...built.warnings];

  // Ids must be unique: the state machine addresses actions by id.
  const seen = new Set();
  for (const action of built.actions) {
    if (seen.has(action.id)) warnings.push(`duplicate action id "${action.id}"`);
    seen.add(action.id);
  }

  // A movement action carrying a single still cannot show a stride.
  for (const action of built.actions) {
    if (action.category === 'move' && action.frames.length < 2) {
      warnings.push(`move action "${action.id}" has one frame; movement will look like sliding, so it stays disabled`);
    }
  }

  // Attach calibration and the real pixel size of every frame. The browser needs
  // both before it loads anything: calibration to stand him on the floor, and the
  // dimensions to reserve space without the layout jumping.
  //
  // The manifest, when present, says where the dog actually sits inside each
  // canvas. That box becomes his interactive area; without it a click anywhere in
  // the transparent margin would count as touching him.
  let placements = null;
  const manifestPath = join(built.frameRoot, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      placements = JSON.parse(await readFile(manifestPath, 'utf8')).frames ?? null;
    } catch (error) {
      warnings.push(`manifest.json could not be read: ${error.message}`);
    }
  }

  const actions = [];
  for (const action of built.actions) {
    const calibration = { ...DEFAULT_CALIBRATION, ...(action.calibration ?? {}) };
    const frames = [];
    for (const f of action.frames) {
      const size = await pngSize(join(built.frameRoot, f.src));
      if (size === null) warnings.push(`action "${action.id}": could not read the size of "${f.src}"`);
      const key = f.src.replace(/\.[^.]+$/, '');
      frames.push({
        ...f,
        width: size?.width ?? null,
        height: size?.height ?? null,
        hit: placements?.[key] ?? null,
      });
    }
    actions.push({ ...action, calibration, frames });
  }

  return { source: built.source, frameRoot: built.frameRoot, actions, warnings };
}
