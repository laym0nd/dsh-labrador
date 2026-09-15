/**
 * The pet's configuration: read, validate, and write back.
 *
 * One file, at $DSH_HOME/dsh-labrador/main-config.json. Nothing here invents a
 * value silently — an illegal setting is reported, because a pet that quietly
 * ignores what you asked for is worse than one that refuses.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Temperaments must match the ones the rules module knows. */
export const TEMPERAMENTS = ['calm', 'attentive', 'lively'];

/** Bounds for the pet's on-screen size and opacity. */
export const SIZE_RANGE = [0.4, 2];
export const OPACITY_RANGE = [0.2, 1];

export const DEFAULT_CONFIG = {
  temperament: 'attentive',
  size: 1,
  opacity: 1,
  weights: {},
  disabledActions: [],
};

/** The config file's path. @param {string} homeDir */
export function configPath(homeDir) {
  return join(homeDir, 'main-config.json');
}

/** Is this a number inside a range? @param {unknown} value @param {[number, number]} range */
function inRange(value, [min, max]) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Check one candidate configuration and report everything wrong with it.
 * Pure, so the rules can be tested without touching a disk.
 * @param {unknown} raw
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[] }}
 */
export function validateConfig(raw) {
  const config = structuredClone(DEFAULT_CONFIG);
  const warnings = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { config, warnings: ['configuration must be an object; using the defaults'] };
  }

  if (raw.temperament === undefined) {
    // Absent is fine: the default is a real choice, not a guess.
  } else if (TEMPERAMENTS.includes(raw.temperament)) {
    config.temperament = raw.temperament;
  } else {
    warnings.push(`temperament "${raw.temperament}" is not one of ${TEMPERAMENTS.join(', ')}; using "${DEFAULT_CONFIG.temperament}"`);
  }

  if (raw.size === undefined) {
    // as above
  } else if (inRange(raw.size, SIZE_RANGE)) {
    config.size = raw.size;
  } else {
    warnings.push(`size must be a number between ${SIZE_RANGE[0]} and ${SIZE_RANGE[1]}; using ${DEFAULT_CONFIG.size}`);
  }

  if (raw.opacity === undefined) {
    // as above
  } else if (inRange(raw.opacity, OPACITY_RANGE)) {
    config.opacity = raw.opacity;
  } else {
    warnings.push(`opacity must be a number between ${OPACITY_RANGE[0]} and ${OPACITY_RANGE[1]}; using ${DEFAULT_CONFIG.opacity}`);
  }

  if (raw.weights === undefined) {
    // as above
  } else if (raw.weights !== null && typeof raw.weights === 'object' && Array.isArray(raw.weights) === false) {
    for (const [id, weight] of Object.entries(raw.weights)) {
      if (typeof weight === 'number' && Number.isFinite(weight) && weight >= 0) config.weights[id] = weight;
      else warnings.push(`weight for "${id}" must be a number of 0 or more; ignoring it`);
    }
  } else {
    warnings.push('weights must be an object of action id to number; ignoring it');
  }

  if (raw.disabledActions === undefined) {
    // as above
  } else if (Array.isArray(raw.disabledActions) && raw.disabledActions.every((id) => typeof id === 'string')) {
    config.disabledActions = [...raw.disabledActions];
  } else {
    warnings.push('disabledActions must be a list of action ids; ignoring it');
  }

  if (raw.display !== undefined) {
    // Say so rather than ignore it: a setting that silently does nothing is how
    // people lose an evening wondering why the dog will not move.
    warnings.push('"display" no longer has any effect: the dog lives in the harness window. Remove it to silence this.');
  }

  return { config, warnings };
}

/**
 * Read and validate the configuration.
 * @param {string} homeDir - $DSH_HOME/dsh-labrador
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[] }}
 */
export function readConfig(homeDir) {
  const file = configPath(homeDir);
  if (!existsSync(file)) return { config: structuredClone(DEFAULT_CONFIG), warnings: [] };

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      warnings: [`main-config.json is not valid JSON (${error.message}); ignoring it`],
    };
  }
  return validateConfig(raw);
}

/**
 * Write the configuration back, atomically.
 *
 * Written to a neighbouring file and renamed into place, so an interrupted save
 * cannot leave a half-written configuration behind for the next start to choke on.
 * @param {string} homeDir @param {unknown} candidate
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[] }}
 */
export function writeConfig(homeDir, candidate) {
  const { config, warnings } = validateConfig(candidate);
  const file = configPath(homeDir);
  // The directory only exists once something has created it, and a first save
  // used to fail with ENOENT because nothing had. Create it rather than refuse.
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
  return { config, warnings };
}
