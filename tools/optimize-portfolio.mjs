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
 *        - skipped when they carry the rsml-optimized marker (re-run safety)
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
 *        - NEVER resized (only odd dimensions lose 1px, a yuv420p requirement)
 *        - frame rate capped at 60 and VFR normalized to constant; rates at or
 *          below 60 are preserved, never increased
 *        - wrong codec or pixel format (e.g. HEVC) converts even if the file
 *          grows, because compatibility is the point; an already-H.264 file
 *          keeps its original bits (lossless remux + marker only) when the
 *          re-encode comes out larger
 *   4. Images: PNG and GIF become lossless WebP (sharp, max effort, animated
 *      WebP for GIFs, ICC profile preserved). JPG stays JPG (already lossy;
 *      lossless WebP of decoded JPEG pixels is usually LARGER, and a lossy
 *      transcode costs a generation). Existing WebP/SVG/PDF are left alone.
 *      Guard: a conversion that comes out larger keeps the original.
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
export const MARKER = 'rsml-optimized-v2';

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
 * Decide what to do with one video given its probe data.
 *   skip          already optimized (marker)
 *   convert       re-encode to H.264; forceConvert means "keep the result even
 *                 if larger" (wrong codec/pix_fmt: compatibility conversion);
 *                 otherwise a larger result falls back to a marker-only remux.
 */
export function classifyVideo(probe) {
  if (probe.marker) return { action: 'skip', reason: 'already optimized' };
  const portrait = probe.height >= probe.width;
  return {
    action: 'convert',
    profile: portrait ? 'portrait' : 'landscape',
    crf: portrait ? 24 : 23,
    forceConvert: probe.codec !== 'h264' || probe.pixFmt !== 'yuv420p',
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
    // Never resize; trunc only shaves an odd dimension to even (encoder need).
    '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', String(plan.crf),
    '-x264-params', 'aq-mode=3',
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
  const v = get(['-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,height,pix_fmt,avg_frame_rate', '-of', 'csv=p=0']).split(',');
  const [num, den] = (v[4] || '').split('/').map(Number);
  return {
    codec: v[0] || '',
    width: Number(v[1]) || 0,
    height: Number(v[2]) || 0,
    pixFmt: v[3] || '',
    avgFps: den ? num / den : 0,
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
  const orphans = listPublicMedia().filter((f) => !refs.has(f) && !chromeRefs.has(f));

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
    console.log(`  video  ${j.ref} -> ${j.target}  [${j.probe.codec} ${j.probe.width}x${j.probe.height} -> h264 ${j.plan.profile} crf ${j.plan.crf}${j.plan.forceConvert ? ', compatibility convert' : ''}]`);
  }
  for (const j of imageJobs) console.log(`  image  ${j.ref} -> ${j.target}  [lossless webp${j.animated ? ', animated' : ''}]`);
  if (dangling.length) console.log(`\ndangling refs (referenced but no file):\n  ${dangling.join('\n  ')}`);
  if (orphans.length) console.log(`\norphans (in public/ but unreferenced):\n  ${orphans.join('\n  ')}`);

  if (dry) {
    console.log('\n--dry: nothing written.');
    return;
  }
  if (videoJobs.length + imageJobs.length === 0) {
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
    const { load } = await import('js-yaml');
    load(readFileSync(WORK_YAML, 'utf8'));
  } catch (e) {
    problems.push(`work.yaml no longer parses: ${e.message}`);
  }

  console.log('\n── results ──');
  for (const r of report) console.log(`  ${r}`);
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
