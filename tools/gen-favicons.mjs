// Regenerate the rasterized favicons from the single vector source of truth,
// `public/favicon.svg`. Run after editing that SVG so the fallbacks stay in
// sync. Usage: `pnpm favicons` (or `node tools/gen-favicons.mjs`).
//
// What it writes (all into public/):
//   - favicon.ico          multi-size (16/32/48), TRANSPARENT, straight from
//                          the SVG. The .ico is only a legacy fallback; modern
//                          browsers use favicon.svg. Keeping it transparent
//                          means the tab icon looks identical whichever file a
//                          browser picks (a dark-tile .ico beside a transparent
//                          .svg would render differently per browser).
//   - apple-touch-icon.png 180x180, OPAQUE. iOS turns transparency black and
//                          applies its own rounded-corner mask, so the home
//                          screen tile must be full-bleed on a solid color.
//
// The mark is whatever favicon.svg contains; we never hardcode the letters or
// the brand color here, so editing the SVG is all that's needed to restyle.
// Only APPLE_BG (the touch-tile backing color, which the SVG can't carry
// because it's transparent) lives here.
//
// Needs: sharp (already a devDependency). No external binaries, no new deps:
// the .ico is assembled by a tiny inline encoder (the ICO container is a 6-byte
// header + 16-byte directory entries + concatenated PNG payloads).

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const SRC = `${PUBLIC}favicon.svg`;

const ICO_SIZES = [16, 32, 48]; // the sizes RealFaviconGenerator et al. ship
const APPLE_SIZE = 180; // the current apple-touch-icon convention
const APPLE_BG = '#111111'; // off-black tile behind the purple mark

// Render the SVG to a square PNG buffer at `size`. We rasterize at a high
// density (so text edges are crisp) and then downsample, rather than letting
// the SVG's 100x100 intrinsic box render 1:1 and blur on scale-up.
const renderPng = (svg, size, { background } = {}) => {
  let pipe = sharp(svg, { density: Math.max(300, size * 8) }).resize(size, size, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (background) pipe = pipe.flatten({ background }); // composite onto a solid tile
  return pipe.png().toBuffer();
};

// Pack PNG buffers into a single .ico. `entries` is [{ size, buffer }].
// Format: ICONDIR (6) + ICONDIRENTRY * n (16 each) + PNG blobs.
const packIco = (entries) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4); // image count

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach(({ size, buffer }, i) => {
    const b = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, b); // width  (0 encodes 256)
    dir.writeUInt8(size >= 256 ? 0 : size, b + 1); // height (0 encodes 256)
    dir.writeUInt8(0, b + 2); // palette colors (0 = none)
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // color planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32LE(buffer.length, b + 8); // payload byte length
    dir.writeUInt32LE(offset, b + 12); // payload offset
    offset += buffer.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.buffer)]);
};

const svg = await readFile(SRC);

// favicon.ico (transparent, multi-size)
const icoEntries = await Promise.all(
  ICO_SIZES.map(async (size) => ({ size, buffer: await renderPng(svg, size) })),
);
await writeFile(`${PUBLIC}favicon.ico`, packIco(icoEntries));

// apple-touch-icon.png (opaque tile)
await writeFile(
  `${PUBLIC}apple-touch-icon.png`,
  await renderPng(svg, APPLE_SIZE, { background: APPLE_BG }),
);

console.log(
  `favicons: wrote favicon.ico (${ICO_SIZES.join('/')}) and ` +
    `apple-touch-icon.png (${APPLE_SIZE}px on ${APPLE_BG}) from favicon.svg`,
);
