/**
 * The dog's default repertoire.
 *
 * Each action owns one or more frames; a frame is one photograph. This is the
 * packaged default only — a user library under $DSH_HOME replaces it entirely.
 *
 * Why data rather than code: the whole pet is described here, so tuning its
 * temperament never means touching the engine.
 *
 * Frames point at assets/frames/, which are normalised: every one is the same
 * 445x328 canvas, with the dog the same size, on the same floor line and at the
 * same centre. That sizing is baked in by tools/normalize.mjs from
 * tools/normalize.recipe.json, so nothing here needs to know about posture or
 * camera distance. Source sprites live untouched in assets/cutout/.
 *
 * Fields:
 *   id           stable name, used by the state machine and the settings page
 *   category     idle | ambient | move | click | event  (see the development document)
 *   frames       ordered frames, each with its own hold time
 *   loop         hold | loop | pingpong | once
 *   weight       relative odds inside the ambient draw
 *   bust         true when the frame is head-and-shoulders, so it cannot stand on the floor
 *   noMirror     true when mirroring would make readable text backwards
 *   calibration  optional per-action override; the normalised frames need none
 *
 * Deleted by Raymond as poor performers: lick (02), rest (03), lie-away (16).
 */

/** Hold times are judgements to be corrected on screen, not measurements. */
const HOLD = 6000;

/**
 * One frame, held.
 * @param {string} src - file name inside the frame root.
 * @param {number} durationMs - how long to hold it.
 */
const frame = (src, durationMs = HOLD) => ({ src, durationMs });

export const DEFAULT_REPERTOIRE = [
  // --- the resting poses: the dog spends most of its time here -----------------
  { id: 'sit', category: 'idle', weight: 30, loop: 'hold', frames: [frame('sit.png', 8000)] },
  { id: 'stand', category: 'idle', weight: 12, loop: 'hold', frames: [frame('stand.png')] },

  // --- ambient: what it decides to do on its own ------------------------------
  { id: 'look-up', category: 'ambient', weight: 16, loop: 'hold', frames: [frame('look-up.png')] },
  { id: 'sit-c', category: 'ambient', weight: 10, loop: 'hold', frames: [frame('sit-c.png')] },
  { id: 'lie-sofa', category: 'ambient', weight: 10, loop: 'hold', frames: [frame('lie-sofa.png')] },
  { id: 'sit-b', category: 'ambient', weight: 8, loop: 'hold', frames: [frame('sit-b.png')] },
  { id: 'sleep', category: 'ambient', weight: 8, loop: 'hold', sleepPose: true, frames: [frame('sleep.png', 12000)] },
  { id: 'lie-sofa-b', category: 'ambient', weight: 8, loop: 'hold', frames: [frame('lie-sofa-b.png')] },
  { id: 'sit-side', category: 'ambient', weight: 6, loop: 'hold', frames: [frame('sit-side.png')] },
  { id: 'sniff', category: 'ambient', weight: 6, loop: 'hold', frames: [frame('sniff.png', 4000)] },

  // --- the car and the cone are their own little moods ------------------------
  { id: 'car-a', category: 'ambient', weight: 5, loop: 'hold', bust: true, frames: [frame('car-a.png')] },
  { id: 'car-b', category: 'ambient', weight: 5, loop: 'hold', bust: true, frames: [frame('car-b.png')] },
  { id: 'pant', category: 'ambient', weight: 5, loop: 'hold', bust: true, frames: [frame('pant.png', 4000)] },
  { id: 'cone-lying', category: 'event', weight: 0, loop: 'hold', frames: [frame('cone-lying.png')] },
  { id: 'cone-face', category: 'event', weight: 0, loop: 'hold', bust: true, noMirror: true, frames: [frame('cone-face.png')] },

  // --- reactions ---------------------------------------------------------------
  { id: 'look-at-you', category: 'click', weight: 0, loop: 'hold', bust: true, frames: [frame('look-at-you.png', 4000)] },

  // --- movement: one frame only, so it stays disabled until a burst exists -----
  { id: 'walk', category: 'move', weight: 0, loop: 'hold', movement: { minDist: 120, maxDist: 420 }, frames: [frame('walk.png')] },
];

/** Calibration applied to any action that does not carry its own. */
export const DEFAULT_CALIBRATION = { scale: 1, anchorX: 0.5 };
