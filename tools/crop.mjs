// Tight-crop the raw Labrador photographs to a hand-estimated box around the dog.
// Why: cropping is the prerequisite for matting, and needs no model download at all.
// Boxes are normalised (0..1) against the SOURCE image, so they survive any resize.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('D:/DeepSeekHarness/DSH Desktop/resources/app/node_modules/sharp');

const SRC = 'D:/桌宠/Raw Lab Image';
const OUT = 'D:/桌宠/assets/crops';

// First-pass boxes, estimated by eye. Generous on purpose: clipping the dog is the
// only unrecoverable mistake, and the matting pass removes background anyway.
// box = [x0, y0, x1, y1] in fractions, or null to keep the whole frame.
const SHEET = [
  { i: 1, file: '微信图片_20260914130401.jpg', slug: 'stand', box: [0.09, 0.36, 0.84, 0.74], note: 'screenshot: photo area only' },
  { i: 2, file: '微信图片_20260914130402.jpg', slug: 'lick', box: null },
  { i: 3, file: '微信图片_20260914130404.jpg', slug: 'rest', box: [0.0, 0.05, 1.0, 1.0] },
  { i: 4, file: '微信图片_20260914130405.jpg', slug: 'look-up', box: [0.22, 0.58, 0.95, 1.0] },
  { i: 5, file: '微信图片_20260914130406.jpg', slug: 'walk', box: [0.02, 0.52, 1.0, 1.0] },
  { i: 6, file: '微信图片_20260914130407.jpg', slug: 'car-a', box: [0.18, 0.15, 0.66, 0.62], note: 'bust: plaid seat excluded' },
  { i: 7, file: '微信图片_20260914130408.jpg', slug: 'car-b', box: [0.14, 0.04, 0.68, 0.54], note: 'bust: plaid seat excluded' },
  { i: 8, file: '微信图片_20260914130409.jpg', slug: 'pant', box: null },
  { i: 9, file: '微信图片_20260914130412.jpg', slug: 'sit-side', box: [0.48, 0.42, 1.0, 1.0] },
  { i: 10, file: '微信图片_20260914130413.jpg', slug: 'sit-a', box: [0.42, 0.33, 1.0, 1.0] },
  { i: 11, file: '微信图片_20260914130414.jpg', slug: 'sit-b', box: [0.28, 0.24, 0.88, 1.0] },
  { i: 12, file: '微信图片_20260914130415.jpg', slug: 'sniff', box: [0.38, 0.06, 1.0, 0.99], note: 'whole head inside frame: edge-touching subjects get dropped by the model' },
  { i: 13, file: '微信图片_20260914130416.jpg', slug: 'sit-c', box: [0.18, 0.20, 0.82, 1.0] },
  { i: 14, file: '微信图片_20260914130417.jpg', slug: 'lie-sofa-a', box: [0.0, 0.22, 1.0, 1.0] },
  { i: 15, file: '微信图片_20260914130419.jpg', slug: 'lie-sofa-b', box: [0.0, 0.22, 1.0, 1.0] },
  { i: 16, file: '微信图片_20260914130420.jpg', slug: 'lie-away', box: [0.0, 0.35, 1.0, 1.0] },
  { i: 17, file: '微信图片_202609141304201.jpg', slug: 'sleep-sofa', box: [0.0, 0.22, 1.0, 1.0] },
  { i: 18, file: '微信图片_20260914130422.jpg', slug: 'portrait', box: [0.04, 0.18, 1.0, 1.0] },
  { i: 19, file: '微信图片_202609141304221.jpg', slug: 'cone-lying', box: [0.18, 0.20, 0.92, 0.95] },
  { i: 20, file: '微信图片_20260914130516.jpg', slug: 'cone-face', box: null },
];

const pad = (n) => String(n).padStart(2, '0');
await mkdir(OUT, { recursive: true });

// Optional index arguments re-crop only those entries, leaving the rest untouched.
const wanted = process.argv.slice(2).map((n) => pad(n));
const items = wanted.length > 0 ? SHEET.filter((s) => wanted.includes(pad(s.i))) : SHEET;

const produced = [];
for (const item of items) {
  const src = join(SRC, item.file);
  const meta = await sharp(src).metadata();
  const [x0, y0, x1, y1] = item.box ?? [0, 0, 1, 1];
  // Clamp to the source: an unclamped box can round one pixel past the edge and
  // sharp rejects the whole extract.
  const left = Math.min(Math.round(x0 * meta.width), meta.width - 1);
  const top = Math.min(Math.round(y0 * meta.height), meta.height - 1);
  const width = Math.min(Math.round((x1 - x0) * meta.width), meta.width - left);
  const height = Math.min(Math.round((y1 - y0) * meta.height), meta.height - top);
  const out = join(OUT, `${pad(item.i)}-${item.slug}.png`);
  await sharp(src).extract({ left, top, width, height }).png().toFile(out);
  produced.push({ ...item, out, width, height });
  console.log(`${pad(item.i)} ${item.slug.padEnd(13)} ${String(width).padStart(5)}x${String(height).padEnd(5)} <- ${item.box ? 'box' : 'full frame'}`);
}

// Contact sheet: one image holding all twenty crops, so the whole set can be
// reviewed in a single look rather than twenty.
const CELL = 300;
const LABEL = 22;
const GAP = 8;
const COLS = 5;
const ROWS = Math.ceil(produced.length / COLS);
const sheetW = COLS * CELL + (COLS + 1) * GAP;
const sheetH = ROWS * (CELL + LABEL) + (ROWS + 1) * GAP;

const composites = [];
for (let n = 0; n < produced.length; n++) {
  const col = n % COLS;
  const row = Math.floor(n / COLS);
  const x = GAP + col * (CELL + GAP);
  const y = GAP + row * (CELL + LABEL + GAP);
  const cellBuf = await sharp(produced[n].out)
    .resize(CELL, CELL, { fit: 'contain', background: { r: 40, g: 40, b: 44, alpha: 1 } })
    .toBuffer();
  composites.push({ input: cellBuf, left: x, top: y });
  const label = Buffer.from(
    `<svg width="${CELL}" height="${LABEL}"><text x="4" y="16" font-family="Segoe UI, sans-serif" font-size="14" fill="#dddddd">${pad(produced[n].i)} ${produced[n].slug}</text></svg>`,
  );
  composites.push({ input: label, left: x, top: y + CELL });
}

const sheet = join(OUT, '_contact-sheet.png');
await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: { r: 20, g: 20, b: 24 } } })
  .composite(composites)
  .png()
  .toFile(sheet);

await writeFile(join(OUT, 'boxes.json'), JSON.stringify(SHEET, null, 2));
console.log(`\ncontact sheet: ${sheet}`);
console.log(`crops: ${produced.length}`);
