// Render the normalised frames as a grid, with the shared floor line drawn in.
// Why: the numbers say every frame is the same canvas; this is how I check that
// the dog looks the same size in each of them.
import { createRequire } from 'node:module';
import { readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('D:/DeepSeekHarness/DSH Desktop/resources/app/node_modules/sharp');

const FRAMES = 'D:/桌宠/assets/frames';
const OUT = 'D:/桌宠/assets/preview/frames.png';
const FLOOR_Y = 312; // mirrors normalize.recipe.json: canvas height 328, padding 16
const COLS = 6;
const LABEL_H = 20;
const GAP = 6;

const files = (await readdir(FRAMES)).filter((n) => n.endsWith('.png')).sort();
await mkdir('D:/桌宠/assets/preview', { recursive: true });

const first = await sharp(join(FRAMES, files[0])).metadata();
const cellW = first.width;
const cellH = first.height;
const rows = Math.ceil(files.length / COLS);
const canvasW = COLS * cellW + (COLS + 1) * GAP;
const canvasH = rows * (cellH + LABEL_H) + (rows + 1) * GAP;

const bg = Buffer.alloc(canvasW * canvasH * 3);
for (let y = 0; y < canvasH; y++) {
  for (let x = 0; x < canvasW; x++) {
    const v = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? 92 : 128;
    const i = (y * canvasW + x) * 3;
    bg[i] = v; bg[i + 1] = v; bg[i + 2] = v;
  }
}

const composites = [];
const sizes = new Set();
for (let n = 0; n < files.length; n++) {
  const col = n % COLS;
  const row = Math.floor(n / COLS);
  const x = GAP + col * (cellW + GAP);
  const y = GAP + row * (cellH + LABEL_H + GAP);
  const frame = join(FRAMES, files[n]);
  const meta = await sharp(frame).metadata();
  sizes.add(`${meta.width}x${meta.height}`);
  composites.push({ input: frame, left: x, top: y });
  // The floor line, drawn per cell so misalignment would be obvious.
  for (let dx = 0; dx < cellW; dx++) {
    for (let dy = 0; dy < 2; dy++) {
      const i = ((y + FLOOR_Y + dy) * canvasW + (x + dx)) * 3;
      bg[i] = 40; bg[i + 1] = 90; bg[i + 2] = 40;
    }
  }
  composites.push({
    input: Buffer.from(
      `<svg width="${cellW}" height="${LABEL_H}"><text x="4" y="15" font-family="Segoe UI, sans-serif" font-size="13" fill="#111">${files[n].replace('.png', '')}</text></svg>`,
    ),
    left: x,
    top: y + cellH,
  });
}

await sharp(bg, { raw: { width: canvasW, height: canvasH, channels: 3 } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(OUT);

console.log(`frames: ${files.length}`);
console.log(`distinct sizes: ${[...sizes].join(', ')}`);
console.log(`preview: ${OUT}`);
