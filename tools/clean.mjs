// Remove frame-spanning debris from a cut-out (e.g. the cone rim in 20-cone-face).
// Why a structural rule rather than a geometric crop: the dog's muzzle crosses the
// rim, so any box or ellipse would clip him. The rim, however, is the only dark
// shape whose bounding box covers the whole frame.
// Usage: node tools/clean.mjs <index> [lumaThreshold]
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const sharp = require('D:/DeepSeekHarness/DSH Desktop/resources/app/node_modules/sharp');

const OUT = 'D:/桌宠/assets/cutout';
const index = String(process.argv[2] ?? '').padStart(2, '0');
const LUMA = Number(process.argv[3] ?? 90);
// A rim is a hollow ring: large, wide, and filling very little of its own bounding
// box. A dark body part (shadowed chest, strap) is solid and fills most of it.
const MIN_PX = 4000;
const WIDE = 0.4;
const TALL = 0.35;
const MAX_FILL = Number(process.argv[4] ?? 0.25);
const ALPHA_FLOOR = 128;

const dir = await (await import('node:fs/promises')).readdir(OUT);
// Exact match only: a looser test once picked up a .bak file and cut that instead.
const name = dir.find((n) => n.startsWith(`${index}-`) && n.endsWith('.png') && !n.includes('.bak'));
if (!name) throw new Error(`no cut-out for ${index}`);
const file = `${OUT}/${name}`;
const dry = process.argv.includes('--dry');

const { data, info } = await sharp(await readFile(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

// Candidate pixels: opaque enough to matter, and dark enough to be the rim.
const dark = new Uint8Array(width * height);
for (let i = 0, p = 0; p < width * height; p++, i += 4) {
  if (data[i + 3] < ALPHA_FLOOR) continue;
  const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  if (luma < LUMA) dark[p] = 1;
}

// Label 4-connected components.
const labels = new Int32Array(width * height).fill(-1);
const boxes = [];
const queue = new Int32Array(width * height);
for (let p = 0; p < width * height; p++) {
  if (dark[p] === 0 || labels[p] !== -1) continue;
  const id = boxes.length;
  let head = 0, tail = 0;
  queue[tail++] = p;
  labels[p] = id;
  let x0 = width, y0 = height, x1 = 0, y1 = 0, count = 0;
  while (head < tail) {
    const q = queue[head++];
    const x = q % width, y = (q - x) / width;
    count++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (x > 0 && dark[q - 1] && labels[q - 1] === -1) { labels[q - 1] = id; queue[tail++] = q - 1; }
    if (x < width - 1 && dark[q + 1] && labels[q + 1] === -1) { labels[q + 1] = id; queue[tail++] = q + 1; }
    if (y > 0 && dark[q - width] && labels[q - width] === -1) { labels[q - width] = id; queue[tail++] = q - width; }
    if (y < height - 1 && dark[q + width] && labels[q + width] === -1) { labels[q + width] = id; queue[tail++] = q + width; }
  }
  boxes.push({ id, count, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 });
}

const fill = (b) => b.count / (b.w * b.h);
const shown = [...boxes].sort((a, b) => b.count - a.count).slice(0, 6);
console.log(`components: ${boxes.length}  image: ${width}x${height}`);
for (const b of shown) {
  console.log(`  #${b.id} px=${b.count} box=${b.w}x${b.h} (${(b.w / width * 100).toFixed(0)}%x${(b.h / height * 100).toFixed(0)}%) fill=${fill(b).toFixed(2)}`);
}
const doomed = boxes.filter(
  (b) => b.count >= MIN_PX && (b.w > width * WIDE || b.h > height * TALL) && fill(b) < MAX_FILL,
);
if (doomed.length === 0) {
  console.log('no hollow frame-spanning component found - left unchanged');
  process.exit(0);
}
for (const b of doomed) console.log(`removing component #${b.id} (${b.count}px, fill ${fill(b).toFixed(2)})`);
if (dry) {
  console.log('dry run - nothing written');
  process.exit(0);
}

let cleared = 0;
for (let p = 0; p < width * height; p++) {
  const id = labels[p];
  if (id !== -1 && doomed.some((b) => b.id === id)) {
    data[p * 4 + 3] = 0;
    cleared++;
  }
}
console.log(`cleared ${cleared}px`);
await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
console.log(`written ${file}`);
