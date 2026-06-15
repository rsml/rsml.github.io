#!/usr/bin/env node
// One-off: cap every work.yaml-referenced gallery image to a 1920px long edge, in place.
//
// WHY: the lightbox decodes each visible shot's image to a full RGBA bitmap. A raw
// camera-resolution photo (e.g. sms/text2order-20230819-8.jpg, 3789x5683 = 21.5 MP) is only
// ~2.3 MB on disk (well-compressed JPEG) but ~86 MB DECODED, and iOS WebKit's jetsam budget
// OOM-killed the lightbox tab when a couple of these were resident at once (the on-device crash
// trail caught decoded-image memory jumping ~52 MB -> ~136 MB arriving at the image-heavy sms
// project). `pnpm optimize` caps POSTERS to 1920 but leaves gallery JPGs at source resolution
// ("JPG stays"), so these slipped through. 1920px long edge is retina-sharp on any phone or
// laptop (the browser was downscaling them to display anyway) and ~10x less decoded memory.
//
// Originals are recoverable from git (these files are committed); run, eyeball, commit.
// Going forward, optimize-portfolio.mjs should grow the same cap for images (follow-up).
//
// Usage: node tools/cap-image-resolution.mjs [--dry] [--max 1920]
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const MAX = Number(process.argv[process.argv.indexOf('--max') + 1]) || 1920;

const yaml = readFileSync(path.join(ROOT, 'src/data/work.yaml'), 'utf8');
// Every local raster referenced as a gallery src or poster.
const refs = [...yaml.matchAll(/\b(?:src|poster):\s+(\/[^\s'"]+\.(?:jpe?g|png|webp|gif))/gi)]
  .map((m) => m[1]);
const unique = [...new Set(refs)];

const dims = (file) => {
  const out = execSync(`sips -g pixelWidth -g pixelHeight ${JSON.stringify(file)}`, { encoding: 'utf8' });
  const w = +(/pixelWidth:\s*(\d+)/.exec(out)?.[1] || 0);
  const h = +(/pixelHeight:\s*(\d+)/.exec(out)?.[1] || 0);
  return { w, h };
};

let totalBeforeMP = 0, totalAfterMP = 0, count = 0;
for (const ref of unique) {
  const file = path.join(ROOT, 'public', ref);
  let w, h;
  try { ({ w, h } = dims(file)); } catch { continue; }
  if (!w || !h) continue;
  const long = Math.max(w, h);
  if (long <= MAX) continue;
  const beforeMP = (w * h) / 1e6;
  const scale = MAX / long;
  const afterMP = beforeMP * scale * scale;
  totalBeforeMP += beforeMP; totalAfterMP += afterMP; count++;
  const q = /\.webp$/i.test(file) ? 80 : 82;
  console.log(
    `${DRY ? '[dry] ' : ''}${ref}  ${w}x${h} (${beforeMP.toFixed(1)} MP, ${(beforeMP * 4).toFixed(0)} MB decoded)` +
    `  ->  ${MAX}px long edge (${afterMP.toFixed(1)} MP, ${(afterMP * 4).toFixed(0)} MB)`,
  );
  if (!DRY) {
    // magick: shrink-only (the trailing '>'), preserve format + aspect, sane quality.
    execSync(`magick ${JSON.stringify(file)} -resize ${MAX}x${MAX}\\> -quality ${q} ${JSON.stringify(file)}`);
  }
}
console.log(
  `\n${DRY ? '[dry] would cap' : 'capped'} ${count} image(s): ` +
  `decoded image memory for these ${(totalBeforeMP * 4).toFixed(0)} MB -> ${(totalAfterMP * 4).toFixed(0)} MB` +
  ` (${(100 * (1 - totalAfterMP / totalBeforeMP)).toFixed(0)}% less).`,
);
