// Cut the dog out of the cropped photographs: transparent PNGs, trimmed to the dog.
// Why: these become the pet's action frames, so the background must be gone.
// Usage: node tools/matte.mjs [index ...]   (no arguments = every crop)
import { createRequire } from 'node:module';
import { readdir, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { removeBackground } from '@imgly/background-removal-node';

const require = createRequire(import.meta.url);
// Reuse the sharp already shipped inside DSH: no second native build needed.
const sharp = require('D:/DeepSeekHarness/DSH Desktop/resources/app/node_modules/sharp');

const CROPS = 'D:/桌宠/assets/crops';
const OUT = 'D:/桌宠/assets/cutout';
const ALPHA_FLOOR = 16; // ignore near-transparent haze when measuring the subject
// The package resolves model files against cwd by default; pin them to its own dist.
const PUBLIC_PATH = pathToFileURL(join(import.meta.dirname, 'node_modules/@imgly/background-removal-node/dist')).href + '/';
// small | medium | large — this build renamed what older docs called isnet variants.
// Only small and medium ship inside the package; large lives on their CDN.
const MODEL = process.env.MATTE_MODEL ?? 'medium';

await mkdir(OUT, { recursive: true });

const wanted = process.argv.slice(2);
// --sheet rebuilds the review sheet from existing cut-outs without re-running the model.
const sheetOnly = wanted.includes('--sheet');
let files = sheetOnly ? [] : (await readdir(CROPS)).filter((n) => /^\d\d-.*\.png$/.test(n)).sort();
if (!sheetOnly && wanted.length > 0) {
  const set = new Set(wanted.map((n) => String(n).padStart(2, '0')));
  files = files.filter((n) => set.has(n.slice(0, 2)));
}
console.log(sheetOnly ? 'rebuilding sheet only' : `matting ${files.length} file(s)`);

/** Bounding box of everything the model kept, in pixels. */
async function alphaBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > ALPHA_FLOOR) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, width, height };
}

/**
 * Push the alpha channel to a decision: faint haze becomes nothing, solid subject
 * becomes opaque, and only the narrow middle band keeps a soft edge.
 * Why: the model leaves seat and cushion ghosts at 20-60% alpha, which read as grey
 * smudges against a desktop. The band is deliberately narrow so fur keeps its edge.
 */
async function hardenAlpha(buf, lo = 100, hi = 180) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    data[i] = a <= lo ? 0 : a >= hi ? 255 : Math.round(((a - lo) * 255) / (hi - lo));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const done = [];
for (const name of files) {
  const src = join(CROPS, name);
  const started = Date.now();
  try {
    // Hand over a typed Blob: a bare Buffer reaches their decoder with no mime type.
    const input = new Blob([await readFile(src)], { type: 'image/png' });
    const blob = await removeBackground(input, {
      model: MODEL,
      publicPath: PUBLIC_PATH,
      output: { format: 'image/png', type: 'foreground' },
    });
    const raw = await hardenAlpha(Buffer.from(await blob.arrayBuffer()));
    const box = await alphaBox(raw);
    if (box === null) {
      console.log(`${name}  EMPTY MASK - nothing kept, skipped`);
      continue;
    }
    // Small breathing margin so the trim never kisses the fur.
    const padX = Math.round((box.x1 - box.x0) * 0.02);
    const padY = Math.round((box.y1 - box.y0) * 0.02);
    const left = Math.max(0, box.x0 - padX);
    const top = Math.max(0, box.y0 - padY);
    const width = Math.min(box.width - left, box.x1 - box.x0 + 1 + padX * 2);
    const height = Math.min(box.height - top, box.y1 - box.y0 + 1 + padY * 2);

    const out = join(OUT, basename(name));
    await sharp(raw).extract({ left, top, width, height }).png({ compressionLevel: 9 }).toFile(out);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${name.padEnd(20)} ${String(width).padStart(5)}x${String(height).padEnd(5)} ${secs}s  kept=${(((box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1)) / (box.width * box.height) * 100).toFixed(0)}% of frame`);
    done.push(out);
  } catch (e) {
    console.log(`${name}  FAILED: ${e.message}`);
  }
}

if (sheetOnly) {
  const existing = (await readdir(OUT)).filter((n) => /^\d\d-.*\.png$/.test(n)).sort();
  for (const n of existing) done.push(join(OUT, n));
}
if (done.length === 0) process.exit(0);

// Contact sheet over a checkerboard, so transparency is actually visible.
const CELL = 320;
const LABEL = 22;
const GAP = 8;
const COLS = 4;
const ROWS = Math.ceil(done.length / COLS);
const W = COLS * CELL + (COLS + 1) * GAP;
const H = ROWS * (CELL + LABEL) + (ROWS + 1) * GAP;

const check = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const v = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? 90 : 130;
    const i = (y * W + x) * 3;
    check[i] = v; check[i + 1] = v; check[i + 2] = v;
  }
}

const composites = [];
for (let n = 0; n < done.length; n++) {
  const col = n % COLS;
  const row = Math.floor(n / COLS);
  const x = GAP + col * (CELL + GAP);
  const y = GAP + row * (CELL + LABEL + GAP);
  const cell = await sharp(done[n]).resize(CELL, CELL, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  composites.push({ input: cell, left: x, top: y });
  const label = Buffer.from(
    `<svg width="${CELL}" height="${LABEL}"><text x="4" y="16" font-family="Segoe UI, sans-serif" font-size="14" fill="#f0f0f0">${basename(done[n], '.png')}</text></svg>`,
  );
  composites.push({ input: label, left: x, top: y + CELL });
}

const sheet = join(OUT, '_contact-sheet.png');
await sharp(check, { raw: { width: W, height: H, channels: 3 } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(sheet);
await writeFile(join(OUT, 'README.txt'),
  'Transparent cut-outs produced by tools/matte.mjs.\nModel: isnet_fp16 via @imgly/background-removal-node.\nTrimmed to the subject with a 2% margin.\n');
console.log(`\ncontact sheet: ${sheet}`);
