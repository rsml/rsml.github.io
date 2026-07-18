#!/usr/bin/env node
/**
 * Optimize every media asset the site references, in place.
 *
 * Usage:
 *   pnpm optimize          convert assets, rewrite refs, back up originals
 *   pnpm optimize --dry    print the full plan without touching anything
 *
 * What it does, in order:
 *   1. Scans work.yaml (src / poster / thumbImage) and src/**.astro body
 *      content for absolute asset paths under public/. Site chrome is never
 *      touched: lines with og:/twitter: meta, icon/apple-touch links, and the
 *      /games, /prototypes, /fonts, /badges folders are excluded.
 *   2. Backs up every file it is about to modify (assets, work.yaml, .astro
 *      files) into <repo>/public-backup-<unix-seconds>/, mirroring paths.
 *   3. Videos (.mp4/.mov/.m4v, any case) become H.264 MP4, the one codec every
 *      modern browser (Safari/Chrome/Firefox/Brave, desktop + mobile) decodes:
 *        - skipped when they carry the rsml-optimized marker AND already sit
 *          inside the delivery spec (h264, level <= 5.1, long edge <= 1920);
 *          a marked file outside the spec re-encodes anyway (self-healing)
 *        - portrait (h >= w) treated as an iPhone recording: CRF 24
 *        - landscape treated as a desktop recording: CRF 23 (one step more
 *          quality than portrait: UI text shows artifacts first)
 *        - these are web-delivery rates, not archival: +6 CRF roughly halves
 *          the bitrate, and the near-transparent sources remain recoverable
 *          from the public-backup-<timestamp> dirs if a file ever needs a
 *          gentler re-encode
 *        - libx264 veryslow, aq-mode=3 (anti-banding: biases bits into the
 *          flat/dark regions where gradients fall apart), High yuv420p,
 *          +faststart, AAC 160k when the source has audio
 *        - delivery cap: long edge scaled down to at most 1920 (never up),
 *          refs 5, level 5.1. Every iPhone hardware-decodes High@L5.1;
 *          veryslow's default 16 refs at 2560x1600 overflowed the L5.2
 *          decoded-picture buffer, x264 stamped L6.0 (an 8K-tier level), and
 *          iOS WebKit crashed the tab decoding it in software (jetsam OOM)
 *        - frame rate capped at 60 and VFR normalized to constant; rates at or
 *          below 60 are preserved, never increased
 *        - wrong codec or pixel format (e.g. HEVC) converts even if the file
 *          grows, because compatibility is the point; an already-H.264 file
 *          keeps its original bits (lossless remux + marker only) when the
 *          re-encode comes out larger, EXCEPT out-of-spec files, which always
 *          take the full re-encode (a remux would ship the bad bits unchanged)
 *   4. Images: PNG and GIF become lossless WebP (sharp, max effort, animated
 *      WebP for GIFs, ICC profile preserved). JPG stays JPG (already lossy;
 *      lossless WebP of decoded JPEG pixels is usually LARGER, and a lossy
 *      transcode costs a generation). Existing WebP/SVG/PDF are left alone.
 *      Guard: a conversion that comes out larger keeps the original.
 *   4b. Display images (every poster AND image-type src, plus <img>-referenced
 *       page screenshots): re-derived FROM the raw master in masters/ (populated
 *       by tools/consolidate-masters.mjs), capped to 1920px long edge as lossy
 *       WebP q80, each with an `.avif` sibling (AVIF_QUALITY, AVIF_EFFORT, 4:4:4
 *       chroma) that a <picture> serves first. Sourcing from the master, not the
 *       already-lossy public webp, avoids a double-lossy generation; a webp-only
 *       master (no lossless raw survives) keeps its webp and only gains an avif.
 *       Strip thumbnails and app-icon logos likewise derive from the master and
 *       gain avif twins. The 1920 cap matters for decode memory too: a 2560x1600
 *       lossless still is ~2.2 MB on the wire and ~16 MB of decoded RGBA on a
 *       phone. video/embed/pdf posters are capped but get no avif (they render
 *       as <video poster>/<iframe>, never a <picture>).
 *   5. Renames (.MOV to .mp4, .png to .webp, ...) rewrite every reference in
 *      work.yaml and the .astro files by exact string replacement, then the
 *      script verifies the YAML still parses, no old path lingers in src/,
 *      and finishes by running `pnpm check` and `pnpm test`.
 *   6. Deletes .DS_Store files under public/ (they ship into the build) and
 *      reports orphans (files nothing references) and dangling refs.
 *
 * Requires ffmpeg/ffprobe on PATH (brew install ffmpeg) and the sharp
 * devDependency (pnpm install).
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Bump the version whenever encode settings change: marked files are skipped
// on re-runs, so retiring the old marker is what makes new settings apply.
// (Exception: the delivery-spec gate re-encodes out-of-spec files even when
// marked, so cap tightening needs no bump.)
export const MARKER = 'rsml-optimized-v2';

// Delivery cap for anything a phone must decode in full: iPhone hardware
// decoders top out at H.264 Level 5.2, and oversized stills hurt the same
// way (decoded RGBA memory). 1920 long edge + refs 5 keeps every encode
// within High@L5.1; posters get the same long-edge ceiling.
export const MAX_LONG_EDGE = 1920;

// AVIF delivery settings. Every shipped display image gets an `.avif` sibling
// that a <picture> serves first, with the webp as the <img> fallback. effort 9
// is sharp's densest/slowest setting (the owner does not care about encode
// time); q55 was calibrated by eye against the worst-case UI screenshots (crisp
// text, no gradient banding). Full-size images and posters also pin 4:4:4 chroma
// so colored text edges stay clean; thumbnails are tiny on screen and keep the
// default 4:2:0.
export const AVIF_QUALITY = 55;
export const AVIF_EFFORT = 9;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
// Committed raw store at the repo ROOT (never under public/, so it does not ship
// to the deployed site). Every display image is compressed FROM its master, so
// re-runs are idempotent and never compound generational loss. Populate/refresh
// with `node tools/consolidate-masters.mjs`.
const MASTERS = path.join(ROOT, 'masters');
const WORK_YAML = path.join(ROOT, 'src/data/work.yaml');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v']);
const IMAGE_EXTS = new Set(['.png', '.gif']);
const SKIP_EXTS = new Set(['.jpg', '.jpeg', '.webp', '.svg', '.pdf']);
// public/ subtrees that are standalone apps or site chrome, never assets.
const EXCLUDED_DIRS = new Set(['games', 'prototypes', 'fonts', 'badges']);

/* ── Reference scanning (pure) ─────────────────────────────────────────── */

// Lookbehind: a ref starts at a "/" not preceded by ":", "/", or a word char,
// so the path inside "https://..." or a bare domain never matches.
// pdf is matched too: PDFs are never converted (SKIP_EXTS), but they must
// count as referenced or the orphan report flags every linked document.
const REF_RE = /(?<![:\w/])\/[\w\-./]+\.(?:png|jpe?g|gif|mp4|mov|m4v|webp|pdf)\b/gi;
const CHROME_LINE_RE = /og:|twitter:|rel=["']?(?:icon|apple-touch|manifest|mask-icon)/i;

/**
 * Pull absolute asset paths out of a text file. Lines that configure site
 * chrome (og/twitter meta, favicon links) are skipped so those files keep
 * formats that link unfurlers and platforms require.
 */
export function extractRefs(text) {
  const refs = new Set();
  for (const line of text.split('\n')) {
    if (CHROME_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(REF_RE)) {
      const ref = m[0];
      const top = ref.split('/')[1];
      if (!EXCLUDED_DIRS.has(top)) refs.add(ref);
    }
  }
  return [...refs].sort();
}

// Chrome lines may use absolute URLs (og:image needs them), so this regex
// tolerates an https://domain prefix and captures the path.
const CHROME_REF_RE = /(?:https?:\/\/[\w.-]+)?(\/[\w\-./]+\.(?:png|jpe?g|gif|mp4|mov|m4v|webp))\b/gi;

/**
 * Asset paths used by site-chrome lines (og:image, twitter:image, icons).
 * These files must keep their current format: link unfurlers and platforms
 * are far pickier than browsers. A chrome-referenced file is never deleted
 * by a rename and never reported as an orphan.
 */
export function extractChromeRefs(text) {
  const refs = new Set();
  for (const line of text.split('\n')) {
    if (!CHROME_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(CHROME_REF_RE)) refs.add(m[1]);
  }
  return [...refs].sort();
}

/* ── Per-file planning (pure) ──────────────────────────────────────────── */

/** The optimized path for a ref: lowercase .mp4 for video, .webp for PNG/GIF. */
export function targetPath(ref) {
  const ext = path.extname(ref).toLowerCase();
  const stem = ref.slice(0, ref.length - path.extname(ref).length);
  if (VIDEO_EXTS.has(ext)) return `${stem}.mp4`;
  if (IMAGE_EXTS.has(ext)) return `${stem}.webp`;
  return ref;
}

/**
 * The 2x thumbnail path for a strip image ref: replaces the final extension
 * with '-thumb.webp'. This is the retina (2x DPR) sidecar. WorkRow.astro uses
 * it as the `2x` srcset entry when the 1x sidecar also exists.
 * Examples: '/a/shot.webp' -> '/a/shot-thumb.webp'
 *           '/a/shot.png'  -> '/a/shot-thumb.webp'
 */
export function thumbPath(ref) {
  const ext = path.extname(ref);
  const stem = ref.slice(0, ref.length - ext.length);
  return `${stem}-thumb.webp`;
}

/**
 * The 1x thumbnail path for a strip image ref: the standard-DPR sidecar served
 * to non-retina displays via srcset. WorkRow.astro uses both: src=1x, srcset
 * includes 1x and 2x so each display gets exactly what it needs.
 * Examples: '/a/shot.webp' -> '/a/shot-thumb-1x.webp'
 */
export function thumbPath1x(ref) {
  const ext = path.extname(ref);
  const stem = ref.slice(0, ref.length - ext.length);
  return `${stem}-thumb-1x.webp`;
}

// Largest display size for app-icon logo tiles (lb-plogo 52px; row-logo/dive-logo 48px).
export const LOGO_SIZE_1X = 52;

/**
 * The 2x logo sidecar path (104px): generated at LOGO_SIZE_1X * 2 for retina displays.
 * Served via srcset in WorkRow, Lightbox, and craft/[slug] logo tiles.
 * Examples: '/logos/chord-colors.jpg' -> '/logos/chord-colors-logo.webp'
 */
export function logoPath(ref) {
  const ext = path.extname(ref);
  const stem = ref.slice(0, ref.length - ext.length);
  return `${stem}-logo.webp`;
}

/**
 * The 1x logo sidecar path (52px): generated at LOGO_SIZE_1X for standard-DPR displays.
 * Examples: '/logos/chord-colors.jpg' -> '/logos/chord-colors-logo-1x.webp'
 */
export function logoPath1x(ref) {
  const ext = path.extname(ref);
  const stem = ref.slice(0, ref.length - ext.length);
  return `${stem}-logo-1x.webp`;
}

/**
 * The AVIF sibling path for a shipped display image: same name, `.avif`
 * extension. Served by <picture><source type="image/avif"> with the webp as the
 * <img> fallback. One is generated for every full-size image, poster, thumb, and
 * logo. Derived file; never referenced directly in work.yaml.
 * Examples: '/a/shot.webp' -> '/a/shot.avif'
 *           '/a/shot-thumb-1x.webp' -> '/a/shot-thumb-1x.avif'
 */
export function avifPath(ref) {
  const ext = path.extname(ref);
  return `${ref.slice(0, ref.length - ext.length)}.avif`;
}

/**
 * The image the home-row strip shows for one asset, mirroring WorkRow.astro's
 * logic so the thumbnail step knows exactly which file to scale.
 *
 * Rules (matching WorkRow in priority order):
 *   1. asset.poster  -- explicit poster always wins.
 *   2. type 'youtube' -- poster is derived from the video id (external URL);
 *      return null so the thumb step skips it (cannot download external images).
 *   3. type 'gif'    -- animated GIFs must keep animating in the strip;
 *      returning a thumb would break animation, so return null.
 *   4. type 'image'  -- use asset.src (type defaults to 'image' per schema).
 *   5. Everything else (video/embed/pdf without poster) -- schema enforces that
 *      these have a poster, so this branch is unreachable in practice;
 *      return null for safety.
 *
 * Only absolute paths (starting with '/') are returned; external http refs
 * cannot be processed on disk and are treated as null.
 */
export function stripImageRef(asset) {
  const ref = asset.poster
    ?? ((asset.type === 'youtube' || asset.type === 'gif') ? null
      : (asset.type == null || asset.type === 'image') ? asset.src
      : null);
  if (!ref) return null;
  // Reject external URLs: the thumb step only handles local public/ files.
  if (!ref.startsWith('/')) return null;
  return ref;
}

/**
 * Whether a poster needs the delivery-size cap. Posters feed the lightbox at
 * full size, so decode size is what matters: a 2560x1600 lossless WebP is
 * ~2.2 MB on the wire and ~16 MB of RGBA once decoded on a phone. Anything
 * with a long edge over 1920 is rewritten in place (same filename) as lossy
 * WebP q80 scaled to 1920. Never upscales; in-spec posters are untouched.
 * Input is { width, height } from sharp metadata; unreadable files skip.
 */
export function posterCapDecision(meta) {
  const long = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (long <= MAX_LONG_EDGE) return { action: 'skip' };
  return { action: 'cap', targetLongEdge: MAX_LONG_EDGE };
}

/**
 * True when a video's bits already fit iPhone hardware decoders: h264 at
 * level <= 5.1 (ffprobe reports tenths: 51) with a long edge <= 1920.
 * An unknown or missing level on an h264 file counts as out of spec:
 * re-encoding is cheap, a crashed iOS tab is not.
 */
export function inDeliverySpec(probe) {
  return probe.codec === 'h264'
    && probe.level > 0 && probe.level <= 51
    && Math.max(probe.width, probe.height) <= MAX_LONG_EDGE;
}

/**
 * Decide what to do with one video given its probe data.
 *   skip          marker present AND within delivery spec (healthy, no churn)
 *   convert       re-encode to H.264; forceConvert means "keep the result even
 *                 if larger": wrong codec/pix_fmt (compatibility conversion) or
 *                 out of delivery spec (a remux would ship the out-of-spec bits
 *                 unchanged). Otherwise a larger result falls back to a
 *                 marker-only remux.
 */
export function classifyVideo(probe) {
  const inSpec = inDeliverySpec(probe);
  if (probe.marker && inSpec) return { action: 'skip', reason: 'already optimized' };
  const portrait = probe.height >= probe.width;
  // Out-of-spec h264 carries a reason so the plan line says why it re-encodes
  // (non-h264 already reports as a compatibility convert).
  const outOfSpec = probe.codec === 'h264' && !inSpec;
  const levelLabel = probe.level > 0 ? (probe.level / 10).toFixed(1) : 'unknown';
  return {
    action: 'convert',
    profile: portrait ? 'portrait' : 'landscape',
    crf: portrait ? 24 : 23,
    forceConvert: probe.codec !== 'h264' || probe.pixFmt !== 'yuv420p' || outOfSpec,
    ...(outOfSpec && {
      reason: `out of delivery spec (h264 level ${levelLabel}, ${probe.width}x${probe.height})`,
    }),
  };
}

/** Output frame rate: cap at 60, never increase, default 60 when unknown. */
export function outputFps(avgFps) {
  if (!avgFps || !isFinite(avgFps) || avgFps <= 0) return 60;
  return Math.min(60, Math.ceil(avgFps));
}

/** The exact ffmpeg invocation for one video re-encode. */
export function encodeArgs(plan, fps, hasAudio, input, output) {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'warning', '-stats', '-y',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    // Delivery cap: long edge down to at most 1920 (never upscaled), aspect
    // preserved, both dimensions kept even (a yuv420p requirement). Args are
    // spawned without a shell, so the commas inside the quoted min() reach
    // ffmpeg's filtergraph parser intact.
    '-vf', `fps=${fps},scale='min(iw,${MAX_LONG_EDGE})':'min(ih,${MAX_LONG_EDGE})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', String(plan.crf),
    '-x264-params', 'aq-mode=3',
    // refs 5 keeps the decoded-picture buffer small enough that, combined with
    // the 1920 cap, every output fits High@L5.1 (all iPhones hardware-decode
    // that). veryslow's default 16 refs is what pushed files to L6.0.
    '-refs', '5', '-level:v', '5.1',
    '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-map_metadata', '-1',
    '-metadata', `comment=${MARKER}`,
    '-movflags', '+faststart',
    output,
  ];
}

/** Lossless remux: same bits, mp4 container, faststart, marker stamped. */
export function remuxArgs(input, output) {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'warning', '-y',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c', 'copy',
    '-map_metadata', '-1',
    '-metadata', `comment=${MARKER}`,
    '-movflags', '+faststart',
    output,
  ];
}

/**
 * Apply renames to a text file in a single pass (one combined regex,
 * longest alternative first), so a path that prefixes another can't be
 * clobbered and replaced text is never rescanned.
 */
export function rewriteRefs(text, renames) {
  if (renames.size === 0) return text;
  const escaped = [...renames.keys()]
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(escaped.join('|'), 'g'), (m) => renames.get(m));
}

/** Renames that would collide on one target (a.mov + a.mp4 both to a.mp4). */
export function findCollisions(refs) {
  const byTarget = new Map();
  for (const ref of refs) {
    const t = targetPath(ref);
    if (!byTarget.has(t)) byTarget.set(t, []);
    byTarget.get(t).push(ref);
  }
  return [...byTarget.entries()].filter(([, srcs]) => srcs.length > 1);
}

/* ── Probing helpers (I/O) ─────────────────────────────────────────────── */

function ffprobe(file) {
  const get = (args) => {
    const r = spawnSync('ffprobe', ['-v', 'error', ...args, file], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : '';
  };
  // key=value output: ffprobe's csv writer orders fields by its internal
  // section order, NOT the -show_entries order, so positional parsing breaks
  // the moment the field list changes. Keys are immune.
  const kv = Object.fromEntries(
    get(['-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,width,height,pix_fmt,avg_frame_rate,level',
      '-of', 'default=noprint_wrappers=1'])
      .split('\n').filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const [num, den] = (kv.avg_frame_rate || '').split('/').map(Number);
  return {
    codec: kv.codec_name || '',
    width: Number(kv.width) || 0,
    height: Number(kv.height) || 0,
    pixFmt: kv.pix_fmt || '',
    avgFps: den ? num / den : 0,
    // H.264 level in tenths (51 = L5.1, 60 = L6.0); ffprobe reports -99 or
    // N/A for unknown, both of which inDeliverySpec treats as out of spec.
    level: Number(kv.level) || 0,
    marker: get(['-show_entries', 'format_tags=comment', '-of', 'csv=p=0']).includes(MARKER),
    hasAudio: get(['-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0']).length > 0,
  };
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
const onDisk = (ref) => path.join(PUBLIC, ref.slice(1));

// Master-source resolution: the raw original in masters/ that a public display
// image is compressed from. masters/ mirrors the public path but keeps the
// original extension, so we scan for the stem across raw formats, rawest first.
// Falls back to the public file when no master exists (a brand-new asset not yet
// consolidated), so the pipeline still works before/without consolidation.
const MASTER_EXTS = ['.png', '.tiff', '.tif', '.heic', '.heif', '.jpg', '.jpeg', '.gif', '.webp'];
function masterFor(ref) {
  const dir = path.join(MASTERS, path.dirname(ref).replace(/^\//, ''));
  const stem = path.basename(ref, path.extname(ref));
  for (const ext of MASTER_EXTS) {
    const p = path.join(dir, stem + ext);
    if (existsSync(p)) return p;
  }
  return onDisk(ref);
}

function listPublicMedia() {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!EXCLUDED_DIRS.has(path.relative(PUBLIC, full))) walk(full);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (VIDEO_EXTS.has(ext) || IMAGE_EXTS.has(ext) || SKIP_EXTS.has(ext)) {
          found.push('/' + path.relative(PUBLIC, full));
        }
      }
    }
  };
  walk(PUBLIC);
  return found.sort();
}

function listAstroFiles(dir = path.join(ROOT, 'src')) {
  const found = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...listAstroFiles(full));
    else if (e.name.endsWith('.astro')) found.push(full);
  }
  return found.sort();
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
}

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

/* ── Main ──────────────────────────────────────────────────────────────── */

async function main() {
  const dry = process.argv.includes('--dry');
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error) {
    die('ffmpeg not found. Install it with: brew install ffmpeg');
  }
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    die('sharp not found. Run: pnpm install');
  }

  // 1. Collect references.
  const yamlText = readFileSync(WORK_YAML, 'utf8');
  const astroFiles = listAstroFiles();
  const refs = new Set(extractRefs(yamlText));
  const chromeRefs = new Set(extractChromeRefs(yamlText));
  for (const f of astroFiles) {
    const t = readFileSync(f, 'utf8');
    for (const r of extractRefs(t)) refs.add(r);
    for (const r of extractChromeRefs(t)) chromeRefs.add(r);
  }

  const existing = [...refs].filter((r) => existsSync(onDisk(r)));
  const dangling = [...refs].filter((r) => !existsSync(onDisk(r)));

  const collisions = findCollisions(existing);
  if (collisions.length > 0) {
    const lines = collisions.map(([t, srcs]) => `  ${srcs.join(' and ')} would both become ${t}`);
    die(`rename collisions, fix these first:\n${lines.join('\n')}`);
  }

  // 2. Build the plan.
  const videoJobs = [];
  const imageJobs = [];
  const skipped = [];
  for (const ref of existing) {
    const ext = path.extname(ref).toLowerCase();
    if (VIDEO_EXTS.has(ext)) {
      const probe = ffprobe(onDisk(ref));
      const plan = classifyVideo(probe);
      if (plan.action === 'skip') skipped.push(`${ref} (${plan.reason})`);
      else videoJobs.push({ ref, probe, plan, target: targetPath(ref) });
    } else if (IMAGE_EXTS.has(ext)) {
      imageJobs.push({ ref, target: targetPath(ref), animated: ext === '.gif' });
    }
    // SKIP_EXTS (jpg/webp/svg/pdf) need no work and no report noise.
  }

  console.log(`referenced assets: ${existing.length}  (videos to do: ${videoJobs.length}, images to do: ${imageJobs.length}, already done/skipped: ${skipped.length})`);
  for (const s of skipped) console.log(`  skip   ${s}`);
  for (const j of videoJobs) {
    const why = j.plan.reason ? `, ${j.plan.reason}` : j.plan.forceConvert ? ', compatibility convert' : '';
    console.log(`  video  ${j.ref} -> ${j.target}  [${j.probe.codec} ${j.probe.width}x${j.probe.height} -> h264 ${j.plan.profile} crf ${j.plan.crf}${why}]`);
  }
  for (const j of imageJobs) console.log(`  image  ${j.ref} -> ${j.target}  [lossless webp${j.animated ? ', animated' : ''}]`);
  if (dangling.length) console.log(`\ndangling refs (referenced but no file):\n  ${dangling.join('\n  ')}`);

  // Build the thumbnail plan (used in both dry and real modes).
  // Thumbs are derived files: exclude any '-thumb.webp' path from the orphan
  // filter so a re-run never treats freshly generated thumbs as unreferenced.
  const orphansFiltered = listPublicMedia().filter(
    (f) => !refs.has(f) && !chromeRefs.has(f)
      && !f.endsWith('-thumb.webp') && !f.endsWith('-thumb-1x.webp')
      && !f.endsWith('-logo.webp') && !f.endsWith('-logo-1x.webp')
      && !f.endsWith('.avif'),
  );
  if (orphansFiltered.length) console.log(`\norphans (in public/ but unreferenced):\n  ${orphansFiltered.join('\n  ')}`);

  // Parse YAML now (before any renames) to build the thumbnail job list.
  // After the rename phase, renames.get(ref) gives the new path if one exists,
  // so we resolve each strip ref through the pending rename map before probing.
  const { load } = await import('js-yaml');
  const projects = load(yamlText);

  // plannedRenames collects the rename map we WILL build during conversion so
  // dry mode can simulate where a source file will land after this run.
  // In dry mode renames is never populated, so we build it separately from the
  // job lists (targetPath gives the destination for each pending job).
  const pendingRenames = new Map([
    ...videoJobs.filter((j) => j.ref !== j.target).map((j) => [j.ref, j.target]),
    ...imageJobs.map((j) => [j.ref, j.target]),
  ]);

  const thumbJobs = [];
  for (const project of projects) {
    const shotH = project.shotHeight ?? 200;
    for (const asset of (project.assets ?? [])) {
      const rawRef = stripImageRef(asset);
      if (!rawRef) continue;
      // Apply any pending rename so the thumb points at the post-conversion file.
      const ref = pendingRenames.get(rawRef) ?? rawRef;
      // Derive from the raw MASTER (falls back to the public file when none), so
      // thumbnails are scaled from the original, not from an already-lossy webp.
      const srcAbs = masterFor(ref);
      if (!existsSync(srcAbs)) continue;
      // Skip thumb inputs that are themselves thumbs (guards against YAML listing
      // a thumb directly, which would produce a thumb-thumb chain).
      if (ref.endsWith('-thumb.webp') || ref.endsWith('-thumb-1x.webp')) continue;
      const dest = thumbPath(ref);
      const destAbs = onDisk(dest);
      const dest1x = thumbPath1x(ref);
      const dest1xAbs = onDisk(dest1x);
      const destAvifAbs = onDisk(avifPath(dest));
      const dest1xAvifAbs = onDisk(avifPath(dest1x));
      // Skip only when every sidecar (webp + avif, 1x + 2x) exists and is current.
      const srcM = statSync(srcAbs).mtimeMs;
      const ok = (abs) => existsSync(abs) && statSync(abs).mtimeMs >= srcM;
      if (ok(destAbs) && ok(dest1xAbs) && ok(destAvifAbs) && ok(dest1xAvifAbs)) continue;
      thumbJobs.push({ ref, dest, dest1x, srcAbs, destAbs, dest1xAbs, destAvifAbs, dest1xAvifAbs, shotH });
    }
  }

  // Print thumbnail plan (both dry and real modes show the intent).
  if (thumbJobs.length > 0) {
    console.log(`\nthumbnail plan (${thumbJobs.length} strip image(s) to generate):`);
    for (const j of thumbJobs) {
      console.log(`  thumb  ${j.ref} -> ${j.dest}  [h${2 * j.shotH}, lossy webp q80]`);
      console.log(`         ${j.ref} -> ${j.dest1x}  [h${j.shotH}, lossy webp q75]`);
    }
  } else {
    console.log('\nthumbnails: all up to date.');
  }

  // Build the logo sidecar job list: 1x (52px) + 2x (104px) WebP for each unique thumbImage.
  const logoJobs = [];
  {
    const thumbImageRefs = new Set();
    for (const project of projects) {
      if (project.thumbImage && project.thumbImage.startsWith('/')) {
        thumbImageRefs.add(pendingRenames.get(project.thumbImage) ?? project.thumbImage);
      }
    }
    for (const ref of [...thumbImageRefs].sort()) {
      // Logos derive from the raw MASTER too (falls back to the public file).
      const srcAbs = masterFor(ref);
      if (!existsSync(srcAbs)) continue;
      if (ref.endsWith('-logo.webp') || ref.endsWith('-logo-1x.webp')) continue;
      const dest = logoPath(ref);
      const destAbs = onDisk(dest);
      const dest1x = logoPath1x(ref);
      const dest1xAbs = onDisk(dest1x);
      const destAvifAbs = onDisk(avifPath(dest));
      const dest1xAvifAbs = onDisk(avifPath(dest1x));
      const srcM = statSync(srcAbs).mtimeMs;
      const ok = (abs) => existsSync(abs) && statSync(abs).mtimeMs >= srcM;
      if (ok(destAbs) && ok(dest1xAbs) && ok(destAvifAbs) && ok(dest1xAvifAbs)) continue;
      logoJobs.push({ ref, dest, dest1x, srcAbs, destAbs, dest1xAbs, destAvifAbs, dest1xAvifAbs });
    }
  }
  if (logoJobs.length > 0) {
    console.log(`\nlogo plan (${logoJobs.length} app-icon(s) to generate):`);
    for (const j of logoJobs) {
      console.log(`  logo   ${j.ref} -> ${j.dest}  [${2 * LOGO_SIZE_1X}px, lossy webp q80]`);
      console.log(`         ${j.ref} -> ${j.dest1x}  [${LOGO_SIZE_1X}px, lossy webp q80]`);
    }
  } else {
    console.log('\nlogos: all up to date.');
  }

  // Display images: every full-size image a <picture> serves (posters AND
  // image-type srcs, plus the standalone tutor/forge pages' and Screen
  // components' <img> webp refs) is (re)derived from its raw MASTER, capped to
  // MAX_LONG_EDGE (fit inside, never upscaled) as lossy webp q80, and given an
  // avif sibling (AVIF_QUALITY, AVIF_EFFORT, 4:4:4 chroma). Deriving from the
  // master, not the already-lossy public webp, avoids a double-lossy generation
  // and lets a quality tweak re-derive cleanly. mtime skip: a public file at
  // least as new as its master is already current.
  // video/embed/pdf posters render as <video poster>/<iframe> (never a
  // <picture>), so they are still capped but get no (unused) avif sibling.
  const videoPosterRefs = new Set();
  for (const project of projects) {
    for (const asset of (project.assets ?? [])) {
      if (['video', 'embed', 'pdf'].includes(asset.type)
        && typeof asset.poster === 'string' && asset.poster.startsWith('/')) {
        videoPosterRefs.add(pendingRenames.get(asset.poster) ?? asset.poster);
      }
    }
  }
  const displayJobs = [];
  {
    const displayRefs = new Set();
    for (const project of projects) {
      for (const asset of (project.assets ?? [])) {
        if (typeof asset.poster === 'string' && asset.poster.startsWith('/')) displayRefs.add(pendingRenames.get(asset.poster) ?? asset.poster);
        if ((asset.type == null || asset.type === 'image') && asset.src.startsWith('/')) displayRefs.add(pendingRenames.get(asset.src) ?? asset.src);
      }
    }
    // Astro-referenced display images (standalone pages, Screen components) that
    // are not work.yaml assets, so the loop above would miss them.
    for (const ref of existing) {
      const r = pendingRenames.get(ref) ?? ref;
      if (!chromeRefs.has(ref) && !/-thumb(-1x)?\.webp$|-logo(-1x)?\.webp$/.test(r)) displayRefs.add(r);
    }
    for (const ref of [...displayRefs].filter((r) => path.extname(r).toLowerCase() === '.webp').sort()) {
      const master = masterFor(ref);
      const pub = onDisk(ref);
      if (!existsSync(master)) continue; // dangling ref (no master and no public file)
      const hasMaster = master !== pub;
      const avifAbs = onDisk(avifPath(ref));
      const mMtime = existsSync(master) ? statSync(master).mtimeMs : 0;
      // Only re-derive the webp from a true RAW master. A webp-only master (no
      // lossless raw survives) is byte-identical to the public webp, so
      // re-encoding it webp->webp would only cost a generation; keep the public
      // file and let its avif derive from that webp (the best source there is).
      const masterIsRaw = path.extname(master).toLowerCase() !== '.webp';
      const needWebp = hasMaster && masterIsRaw && (!existsSync(pub) || statSync(pub).mtimeMs < mMtime);
      const needAvif = !videoPosterRefs.has(ref) && (!existsSync(avifAbs) || statSync(avifAbs).mtimeMs < mMtime);
      if (!needWebp && !needAvif) continue;
      displayJobs.push({ ref, master, hasMaster, pub, avifRef: avifPath(ref), avifAbs, needWebp, needAvif });
    }
  }
  if (displayJobs.length > 0) {
    const nWebp = displayJobs.filter((j) => j.needWebp).length;
    const nAvif = displayJobs.filter((j) => j.needAvif).length;
    console.log(`\ndisplay image plan (${nWebp} webp re-derived from master + capped ${MAX_LONG_EDGE}px, ${nAvif} avif sibling(s)):`);
    for (const j of displayJobs) console.log(`  display ${j.ref}${j.needWebp ? ' [webp]' : ''}${j.needAvif ? ' [avif]' : ''}`);
  } else {
    console.log('\ndisplay images: all up to date.');
  }

  if (dry) {
    console.log('\n--dry: nothing written.');
    return;
  }
  if (videoJobs.length + imageJobs.length + thumbJobs.length + displayJobs.length + logoJobs.length === 0) {
    console.log('\nnothing to do.');
    return;
  }

  // 3. Backup everything about to change.
  const backupDir = path.join(ROOT, `public-backup-${Math.floor(Date.now() / 1000)}`);
  const backup = (abs) => {
    // Source files get a .bak suffix so astro check / tsc never parse the
    // copies (astro check scans every .astro in the repo, ignoring tsconfig
    // excludes). Restore by stripping the suffix.
    const suffix = /\.(astro|ts|mjs|yaml)$/.test(abs) ? '.bak' : '';
    const dest = path.join(backupDir, path.relative(ROOT, abs)) + suffix;
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
  };
  for (const j of [...videoJobs, ...imageJobs]) backup(onDisk(j.ref));
  // Display webp files are re-derived in place from their masters; back up the
  // current file first. (avif siblings are brand new; masters/ is the durable raw.)
  for (const j of displayJobs) if (j.needWebp && existsSync(j.pub)) backup(j.pub);
  backup(WORK_YAML);
  for (const f of astroFiles) backup(f);
  console.log(`\nbacked up originals to ${path.relative(ROOT, backupDir)}/`);

  // 4. Convert.
  const renames = new Map();
  const failures = [];
  const report = [];

  for (const j of videoJobs) {
    const input = onDisk(j.ref);
    const finalOut = onDisk(j.target);
    const tmp = `${finalOut}.part.mp4`;
    const fps = outputFps(j.probe.avgFps);
    console.log(`\nencode ${j.ref} (${j.plan.profile}, crf ${j.plan.crf}, ${fps}fps)`);
    let res = run('ffmpeg', encodeArgs(j.plan, fps, j.probe.hasAudio, input, tmp));
    if (res.status !== 0) {
      rmSync(tmp, { force: true });
      failures.push(j.ref);
      continue;
    }
    const before = statSync(input).size;
    let after = statSync(tmp).size;
    let how = 're-encoded';
    if (after >= before && !j.plan.forceConvert) {
      // The source was already lean H.264: keep its bits, just remux + mark.
      rmSync(tmp, { force: true });
      res = run('ffmpeg', remuxArgs(input, tmp));
      if (res.status !== 0) { rmSync(tmp, { force: true }); failures.push(j.ref); continue; }
      after = statSync(tmp).size;
      how = 'kept original bits (remux + marker)';
    }
    if (input !== finalOut && !chromeRefs.has(j.ref)) rmSync(input);
    renameSync(tmp, finalOut);
    if (j.ref !== j.target) renames.set(j.ref, j.target);
    const kept = input !== finalOut && chromeRefs.has(j.ref) ? ', original kept for og/icon use' : '';
    report.push(`${j.ref}: ${mb(before)} -> ${mb(after)} (${how}${kept})`);
  }

  for (const j of imageJobs) {
    const input = onDisk(j.ref);
    const finalOut = onDisk(j.target);
    const tmp = `${finalOut}.part.webp`;
    try {
      let img = sharp(input, { animated: j.animated, limitInputPixels: false })
        .webp({ lossless: true, effort: 6 });
      try { img = img.keepIccProfile(); } catch {}
      await img.toFile(tmp);
    } catch (e) {
      rmSync(tmp, { force: true });
      failures.push(`${j.ref} (${e.message})`);
      continue;
    }
    const before = statSync(input).size;
    const after = statSync(tmp).size;
    if (after >= before) {
      rmSync(tmp, { force: true });
      report.push(`${j.ref}: kept original (webp would be ${mb(after)} vs ${mb(before)})`);
      continue;
    }
    if (!chromeRefs.has(j.ref)) rmSync(input);
    renameSync(tmp, finalOut);
    renames.set(j.ref, j.target);
    const kept = chromeRefs.has(j.ref) ? ' (original kept for og/icon use)' : '';
    report.push(`${j.ref}: ${mb(before)} -> ${mb(after)}${kept}`);
  }

  // 5. Rewrite references for everything that changed name.
  if (renames.size > 0) {
    writeFileSync(WORK_YAML, rewriteRefs(yamlText, renames));
    for (const f of astroFiles) {
      const t = readFileSync(f, 'utf8');
      const rewritten = rewriteRefs(t, renames);
      if (rewritten !== t) writeFileSync(f, rewritten);
    }
  }

  // 5b. Display images: re-derive the webp from the master (capped to
  // MAX_LONG_EDGE, fit inside, never upscaled) and write the avif sibling sized
  // to match the webp exactly (so the <picture> box is identical whichever
  // format wins). Runs before the thumb pass. Sourcing from the master avoids a
  // double-lossy generation; the avif is what <picture> serves first, the webp
  // is the fallback (and the <video>/<iframe> poster for the avif-excluded ones).
  const displayReport = [];
  for (const j of displayJobs) {
    if (j.needWebp) {
      const tmp = `${j.pub}.part.webp`;
      try {
        let img = sharp(j.master, { limitInputPixels: false })
          .resize({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80, effort: 6 });
        try { img = img.keepIccProfile(); } catch {}
        const before = existsSync(j.pub) ? statSync(j.pub).size : 0;
        await img.toFile(tmp);
        renameSync(tmp, j.pub);
        const d = await sharp(j.pub).metadata();
        displayReport.push(`webp ${j.ref}: -> ${d.width}x${d.height} (${mb(before)} -> ${mb(statSync(j.pub).size)})`);
      } catch (e) { rmSync(tmp, { force: true }); failures.push(`display webp ${j.ref} (${e.message})`); }
    }
    if (j.needAvif) {
      const tmp = `${j.avifAbs}.part.avif`;
      try {
        const src = j.hasMaster ? j.master : j.pub;
        const target = existsSync(j.pub) ? await sharp(j.pub).metadata() : { width: MAX_LONG_EDGE, height: MAX_LONG_EDGE };
        let img = sharp(src, { limitInputPixels: false })
          .resize({ width: target.width, height: target.height, fit: 'inside', withoutEnlargement: true })
          .avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT, chromaSubsampling: '4:4:4' });
        try { img = img.keepIccProfile(); } catch {}
        await img.toFile(tmp);
        renameSync(tmp, j.avifAbs);
        displayReport.push(`avif ${j.avifRef}: ${mb(statSync(j.avifAbs).size)}`);
      } catch (e) { rmSync(tmp, { force: true }); failures.push(`display avif ${j.ref} (${e.message})`); }
    }
  }

  // 5c. Generate strip thumbnails: 2x (retina) and 1x (standard DPR) WebP sidecars.
  // WorkRow.astro serves them via srcset="...-1x.webp 1x, ...-thumb.webp 2x" so each
  // display gets exactly the pixels it needs. Derived files; never referenced directly
  // in work.yaml or .astro files.
  const thumbReport = [];
  for (const j of thumbJobs) {
    const tmp2x = `${j.destAbs}.part.webp`;
    const tmp1x = `${j.dest1xAbs}.part.webp`;
    let meta;
    try {
      // Probe source dimensions to cap target heights (never upscale).
      meta = await sharp(j.srcAbs).metadata();
    } catch (e) {
      failures.push(`thumb ${j.dest} (${e.message})`);
      continue;
    }
    const srcH = meta.height ?? 0;
    const before = statSync(j.srcAbs).size;

    // 2x thumb: scaled to 2x shotHeight, q80.
    const targetH2x = srcH > 0 ? Math.min(2 * j.shotH, srcH) : 2 * j.shotH;
    try {
      await sharp(j.srcAbs).resize({ height: targetH2x }).webp({ quality: 80, effort: 6 }).toFile(tmp2x);
    } catch (e) {
      rmSync(tmp2x, { force: true });
      failures.push(`thumb ${j.dest} (${e.message})`);
      continue;
    }
    const after2x = statSync(tmp2x).size;
    if (after2x >= before) {
      rmSync(tmp2x, { force: true });
      thumbReport.push(`thumb ${j.dest}: skipped (${mb(after2x)} >= src ${mb(before)})`);
    } else {
      renameSync(tmp2x, j.destAbs);
      const destMeta = await sharp(j.destAbs).metadata();
      thumbReport.push(`thumb ${j.dest} (${meta.width}x${meta.height} -> ${destMeta.width}x${destMeta.height}, ${mb(before)} -> ${mb(after2x)})`);
      // 2x avif sibling (same height), served first by <picture>.
      const tmpA = `${j.destAvifAbs}.part.avif`;
      try {
        await sharp(j.srcAbs).resize({ height: targetH2x }).avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toFile(tmpA);
        renameSync(tmpA, j.destAvifAbs);
      } catch (e) { rmSync(tmpA, { force: true }); failures.push(`thumb avif ${avifPath(j.dest)} (${e.message})`); }
    }

    // 1x thumb: scaled to 1x shotHeight, q75 (lower res = quality loss less visible).
    const targetH1x = srcH > 0 ? Math.min(j.shotH, srcH) : j.shotH;
    try {
      await sharp(j.srcAbs).resize({ height: targetH1x }).webp({ quality: 75, effort: 6 }).toFile(tmp1x);
    } catch (e) {
      rmSync(tmp1x, { force: true });
      failures.push(`thumb ${j.dest1x} (${e.message})`);
      continue;
    }
    const after1x = statSync(tmp1x).size;
    if (after1x >= before) {
      rmSync(tmp1x, { force: true });
      thumbReport.push(`thumb ${j.dest1x}: skipped (${mb(after1x)} >= src ${mb(before)})`);
    } else {
      renameSync(tmp1x, j.dest1xAbs);
      const dest1xMeta = await sharp(j.dest1xAbs).metadata();
      thumbReport.push(`thumb ${j.dest1x} (${meta.width}x${meta.height} -> ${dest1xMeta.width}x${dest1xMeta.height}, ${mb(before)} -> ${mb(after1x)})`);
      // 1x avif sibling.
      const tmpA = `${j.dest1xAvifAbs}.part.avif`;
      try {
        await sharp(j.srcAbs).resize({ height: targetH1x }).avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toFile(tmpA);
        renameSync(tmpA, j.dest1xAvifAbs);
      } catch (e) { rmSync(tmpA, { force: true }); failures.push(`thumb avif ${avifPath(j.dest1x)} (${e.message})`); }
    }
  }

  // 5d. Generate app-icon logo sidecars: 1x (52px) and 2x (104px) WebP for every
  // project thumbImage. Served via srcset in WorkRow, Lightbox, and craft/[slug].
  const logoReport = [];
  for (const j of logoJobs) {
    for (const [size, tmpW, destAbs, tmpA, destAvifAbs, label] of [
      [2 * LOGO_SIZE_1X, `${j.destAbs}.part.webp`,   j.destAbs,   `${j.destAvifAbs}.part.avif`,   j.destAvifAbs,   j.dest],
      [LOGO_SIZE_1X,     `${j.dest1xAbs}.part.webp`, j.dest1xAbs, `${j.dest1xAvifAbs}.part.avif`, j.dest1xAvifAbs, j.dest1x],
    ]) {
      try {
        await sharp(j.srcAbs).resize(size, size, { fit: 'cover' }).webp({ quality: 80, effort: 6 }).toFile(tmpW);
      } catch (e) {
        rmSync(tmpW, { force: true });
        failures.push(`logo ${label} (${e.message})`);
        continue;
      }
      renameSync(tmpW, destAbs);
      try {
        await sharp(j.srcAbs).resize(size, size, { fit: 'cover' }).avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toFile(tmpA);
        renameSync(tmpA, destAvifAbs);
      } catch (e) { rmSync(tmpA, { force: true }); failures.push(`logo avif ${label} (${e.message})`); }
      logoReport.push(`logo ${label} (${size}x${size}, webp ${mb(statSync(destAbs).size)} + avif ${mb(statSync(destAvifAbs).size)})`);
    }
  }

  // 6. Hygiene: .DS_Store files ship into the build; remove them.
  let dsCount = 0;
  const sweep = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) sweep(full);
      else if (e.name === '.DS_Store') { rmSync(full); dsCount += 1; }
    }
  };
  sweep(PUBLIC);

  // 7. Verify: every rename landed, no old path lingers, YAML parses.
  const problems = [];
  for (const [from, to] of renames) {
    if (existsSync(onDisk(from)) && !chromeRefs.has(from)) problems.push(`old file still present: ${from}`);
    if (!existsSync(onDisk(to))) problems.push(`new file missing: ${to}`);
  }
  for (const f of [WORK_YAML, ...astroFiles]) {
    const t = readFileSync(f, 'utf8');
    for (const from of renames.keys()) {
      if (t.includes(from)) problems.push(`stale ref ${from} in ${path.relative(ROOT, f)}`);
    }
  }
  try {
    // `load` is already imported above; this re-validates the post-rename YAML.
    load(readFileSync(WORK_YAML, 'utf8'));
  } catch (e) {
    problems.push(`work.yaml no longer parses: ${e.message}`);
  }

  console.log('\n── results ──');
  for (const r of report) console.log(`  ${r}`);
  for (const r of displayReport) console.log(`  ${r}`);
  for (const r of thumbReport) console.log(`  ${r}`);
  for (const r of logoReport) console.log(`  ${r}`);
  if (dsCount) console.log(`  removed ${dsCount} .DS_Store file(s) from public/`);
  console.log(`  backup: ${path.relative(ROOT, backupDir)}/`);
  if (failures.length) console.log(`  FAILED (originals untouched):\n    ${failures.join('\n    ')}`);
  if (problems.length) {
    console.error(`  PROBLEMS:\n    ${problems.join('\n    ')}`);
    console.error(`  restore: copy files back from ${path.relative(ROOT, backupDir)}/`);
    process.exit(1);
  }

  // 8. Prove the site still builds and the data still validates.
  console.log('\nrunning pnpm check + pnpm test ...');
  const check = run('pnpm', ['check']);
  const test = run('pnpm', ['test']);
  if (check.status !== 0 || test.status !== 0) {
    console.error(`check/test failed. Originals are in ${path.relative(ROOT, backupDir)}/`);
    process.exit(1);
  }
  console.log(`\ndone. ${report.length} asset(s) processed, ${failures.length} failed.`);
  if (failures.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
