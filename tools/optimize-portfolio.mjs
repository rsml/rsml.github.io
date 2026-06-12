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
 *   4b. Posters (every distinct poster: in work.yaml): the lightbox shows
 *       posters full size, so any with a long edge over 1920 is rewritten in
 *       place (same filename) as lossy WebP q80 scaled to 1920, ICC profile
 *       preserved. A 2560x1600 lossless poster is ~2.2 MB on the wire and
 *       ~16 MB of decoded RGBA on a phone.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
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
 * The thumbnail path for a strip image ref: replaces the final extension with
 * '-thumb.webp'. Used by the thumbnail generation step and by WorkRow.astro to
 * check whether a thumb exists before falling back to the full-resolution file.
 * Examples: '/a/shot.webp' -> '/a/shot-thumb.webp'
 *           '/a/shot.png'  -> '/a/shot-thumb.webp'
 */
export function thumbPath(ref) {
  const ext = path.extname(ref);
  const stem = ref.slice(0, ref.length - ext.length);
  return `${stem}-thumb.webp`;
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
    (f) => !refs.has(f) && !chromeRefs.has(f) && !f.endsWith('-thumb.webp'),
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
      const srcAbs = onDisk(ref);
      if (!existsSync(srcAbs)) continue;
      // Skip thumb inputs that are themselves thumbs (guards against YAML listing
      // a thumb directly, which would produce a thumb-thumb chain).
      if (ref.endsWith('-thumb.webp')) continue;
      const dest = thumbPath(ref);
      const destAbs = onDisk(dest);
      // Skip when an up-to-date thumb already exists (mtime compare).
      if (existsSync(destAbs) && statSync(destAbs).mtimeMs >= statSync(srcAbs).mtimeMs) continue;
      thumbJobs.push({ ref, dest, srcAbs, destAbs, shotH });
    }
  }

  // Print thumbnail plan (both dry and real modes show the intent).
  if (thumbJobs.length > 0) {
    console.log(`\nthumbnail plan (${thumbJobs.length} strip image(s) to generate):`);
    for (const j of thumbJobs) {
      console.log(`  thumb  ${j.ref} -> ${j.dest}  [h${2 * j.shotH}, lossy webp q80]`);
    }
  } else {
    console.log('\nthumbnails: all up to date.');
  }

  // Poster delivery cap plan: every distinct poster: path in work.yaml that
  // lives in public/. Filenames never change, so no reference rewriting.
  // A poster about to be renamed by a conversion (png -> webp) is resolved
  // through pendingRenames so the cap lands on the post-conversion file.
  const posterCapJobs = [];
  {
    const posterRefs = new Set();
    for (const project of projects) {
      for (const asset of (project.assets ?? [])) {
        if (typeof asset.poster === 'string' && asset.poster.startsWith('/')) posterRefs.add(asset.poster);
      }
    }
    for (const rawRef of [...posterRefs].sort()) {
      const srcAbs = onDisk(rawRef);
      if (!existsSync(srcAbs)) continue;
      let meta;
      try { meta = await sharp(srcAbs).metadata(); } catch { continue; }
      const decision = posterCapDecision(meta);
      if (decision.action !== 'cap') continue;
      posterCapJobs.push({
        rawRef, // the file as it exists now (backup source)
        ref: pendingRenames.get(rawRef) ?? rawRef, // the file the cap rewrites
        width: meta.width, height: meta.height,
        targetLongEdge: decision.targetLongEdge,
      });
    }
  }
  if (posterCapJobs.length > 0) {
    console.log(`\nposter cap plan (${posterCapJobs.length} poster(s) exceed ${MAX_LONG_EDGE}px long edge):`);
    for (const j of posterCapJobs) {
      console.log(`  poster ${j.ref}  [${j.width}x${j.height} -> long edge ${j.targetLongEdge}, lossy webp q80]`);
    }
  } else {
    console.log(`\nposters: all within the ${MAX_LONG_EDGE}px delivery cap.`);
  }

  if (dry) {
    console.log('\n--dry: nothing written.');
    return;
  }
  if (videoJobs.length + imageJobs.length + thumbJobs.length + posterCapJobs.length === 0) {
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
  // Posters are rewritten in place: back up the file as it exists right now
  // (one also being converted this run was already backed up above; the
  // second copy is the same bytes to the same path, harmless).
  for (const j of posterCapJobs) backup(onDisk(j.rawRef));
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

  // 5b. Cap oversized posters in place (lossy WebP q80, long edge 1920).
  // Runs before the thumb pass so thumbs generated this run derive from the
  // capped file. No larger-result guard here: the point is decode size (RGBA
  // memory on phones), not bytes, so the cap applies even if the file grows.
  const posterReport = [];
  for (const j of posterCapJobs) {
    // Prefer the post-conversion path; if that conversion kept the original
    // (or failed), cap the file that actually exists.
    const ref = existsSync(onDisk(j.ref)) ? j.ref : j.rawRef;
    const abs = onDisk(ref);
    const tmp = `${abs}.part.webp`;
    try {
      let img = sharp(abs).resize({
        width: j.targetLongEdge, height: j.targetLongEdge,
        fit: 'inside', withoutEnlargement: true,
      }).webp({ quality: 80, effort: 6 });
      try { img = img.keepIccProfile(); } catch {}
      await img.toFile(tmp);
    } catch (e) {
      rmSync(tmp, { force: true });
      failures.push(`poster ${ref} (${e.message})`);
      continue;
    }
    const before = statSync(abs).size;
    const after = statSync(tmp).size;
    const destMeta = await sharp(tmp).metadata();
    renameSync(tmp, abs);
    posterReport.push(`poster ${ref}: ${j.width}x${j.height} -> ${destMeta.width ?? '?'}x${destMeta.height ?? '?'} (${mb(before)} -> ${mb(after)})`);
  }

  // 5c. Generate strip thumbnails: small lossy WebP scaled to 2x shotHeight.
  // These are derived files; WorkRow.astro prefers <name>-thumb.webp when it
  // exists, falling back to the original so old builds stay correct.
  const thumbReport = [];
  for (const j of thumbJobs) {
    const tmp = `${j.destAbs}.part.webp`;
    try {
      // Probe the source dimensions so we can cap the target height to the
      // actual source height (never upscale: a 300px source at 2x 300px shot
      // would otherwise upscale, which wastes bytes and looks worse).
      const meta = await sharp(j.srcAbs).metadata();
      const srcH = meta.height ?? 0;
      const srcW = meta.width ?? 0;
      const targetH = srcH > 0 ? Math.min(2 * j.shotH, srcH) : 2 * j.shotH;
      await sharp(j.srcAbs)
        .resize({ height: targetH })
        .webp({ quality: 80, effort: 6 })
        .toFile(tmp);
    } catch (e) {
      rmSync(tmp, { force: true });
      failures.push(`thumb ${j.dest} (${e.message})`);
      continue;
    }
    const before = statSync(j.srcAbs).size;
    const after = statSync(tmp).size;
    if (after >= before) {
      // Already small enough that a lossy thumb is no smaller (e.g. a tiny
      // poster); delete the attempt and let WorkRow fall back to the original.
      rmSync(tmp, { force: true });
      thumbReport.push(`thumb ${j.dest}: skipped (thumb ${mb(after)} >= src ${mb(before)})`);
      continue;
    }
    renameSync(tmp, j.destAbs);
    // Re-probe the written file for accurate dimensions after resize. Probe the
    // source BEFORE reading the dest so both calls see the right file on disk.
    const srcMeta = await sharp(j.srcAbs).metadata();
    const destMeta = await sharp(j.destAbs).metadata();
    const srcLabel = `${srcMeta.width ?? '?'}x${srcMeta.height ?? '?'}`;
    const destLabel = `${destMeta.width ?? '?'}x${destMeta.height ?? '?'}`;
    thumbReport.push(`thumb ${j.dest} (${srcLabel} -> ${destLabel}, ${mb(before)} -> ${mb(after)})`);
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
  for (const r of posterReport) console.log(`  ${r}`);
  for (const r of thumbReport) console.log(`  ${r}`);
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
