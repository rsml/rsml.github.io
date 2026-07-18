#!/usr/bin/env node
/**
 * Consolidate the raw ORIGINAL of every referenced display image into a single
 * committed `masters/` store, so the optimizer can always compress FROM the raw
 * (idempotent: a quality tweak re-derives from the original, never from an
 * already-lossy file) and we can always go back.
 *
 * Why this exists: the site's raws were scattered across timestamped
 * `public-backup-<unix>/` dirs (created by `pnpm optimize` before it overwrote
 * each file) and were local-only, so "always be able to go back" wasn't actually
 * guaranteed. This gathers the truest surviving original for each asset into
 * `masters/`, mirroring the public/ path but keeping the original extension
 * (e.g. public/tutor/screenshots/library.webp -> masters/tutor/screenshots/library.png).
 *
 * `masters/` lives at the repo ROOT, not under public/, so it is committed to
 * git (durable, off-machine via origin) but NEVER ships to the deployed site
 * (astro only copies public/ into dist/).
 *
 * Scope: IMAGES only. Videos keep their existing delivery-spec pipeline and
 * their raws remain in the backup dirs / pre-squash-backup branch.
 *
 * Usage:
 *   node tools/consolidate-masters.mjs         copy missing masters, report
 *   node tools/consolidate-masters.mjs --dry   report only, write nothing
 *
 * Idempotent: an asset whose master already exists is left untouched, so this is
 * safe to re-run (e.g. after adding new projects, to ingest their raws).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRefs, extractChromeRefs } from './optimize-portfolio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const MASTERS = path.join(ROOT, 'masters');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tiff', '.tif', '.heic', '.heif']);
// Format preference: higher = rawer / less-compressed, so it wins as the master.
const RANK = { '.png': 6, '.tiff': 6, '.tif': 6, '.heic': 5, '.heif': 5, '.jpg': 3, '.jpeg': 3, '.gif': 2, '.webp': 1 };
const LOSSLESS = new Set(['.png', '.tiff', '.tif', '.heic', '.heif']);
// Derived sidecars are outputs, never masters.
const isDerived = (p) => /-thumb(-1x)?\.\w+$|-logo(-1x)?\.\w+$/.test(p);

const mb = (b) => (b / 1e6).toFixed(2) + 'MB';

/** All .astro files under src/ (their <img>/<video> refs count as referenced). */
function listAstro(dir = path.join(ROOT, 'src'), acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) listAstro(f, acc);
    else if (e.name.endsWith('.astro')) acc.push(f);
  }
  return acc;
}

/** Index every image file in a tree as "relDir::stem" -> [{abs, ext, size}]. */
function indexTree(base, index) {
  const walk = (d) => {
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      const key = path.relative(base, path.dirname(f)) + '::' + path.basename(e.name, path.extname(e.name));
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ abs: f, ext, size: statSync(f).size });
    }
  };
  walk(base);
  return index;
}

function main() {
  const dry = process.argv.includes('--dry');

  // 1. Referenced display images: work.yaml + every .astro, plus the talk deck's
  //    raster images (referenced from its standalone index.html, not scanned here).
  const yaml = readFileSync(path.join(ROOT, 'src/data/work.yaml'), 'utf8');
  const refs = new Set(extractRefs(yaml));
  const chrome = new Set(extractChromeRefs(yaml));
  for (const f of listAstro()) {
    const t = readFileSync(f, 'utf8');
    for (const r of extractRefs(t)) refs.add(r);
    for (const r of extractChromeRefs(t)) chrome.add(r);
  }
  let imageRefs = [...refs].filter(
    (r) => IMAGE_EXTS.has(path.extname(r).toLowerCase()) && !chrome.has(r) && !isDerived(r),
  );
  const deckDir = path.join(PUBLIC, 'talks/harness/images');
  if (existsSync(deckDir)) {
    for (const n of readdirSync(deckDir)) {
      if (['.png', '.jpg', '.jpeg'].includes(path.extname(n).toLowerCase())) imageRefs.push('/talks/harness/images/' + n);
    }
  }
  imageRefs = [...new Set(imageRefs)].sort();

  // 2. Index current public/ + every backup dir once (public first so a tie
  //    prefers the live file).
  const index = new Map();
  indexTree(PUBLIC, index);
  for (const n of readdirSync(ROOT)) {
    if (n.startsWith('public-backup-')) indexTree(path.join(ROOT, n, 'public'), index);
  }

  // 3. Pick the truest master per ref: rawest format, then largest bytes.
  const pick = (ref) => {
    const key = path.dirname(ref).replace(/^\//, '') + '::' + path.basename(ref, path.extname(ref));
    const cands = index.get(key);
    if (!cands || !cands.length) return null;
    return [...cands].sort((a, b) => (RANK[b.ext] || 0) - (RANK[a.ext] || 0) || b.size - a.size)[0];
  };

  const jobs = [];
  const webpOnly = [];
  const missing = [];
  for (const ref of imageRefs) {
    const best = pick(ref);
    if (!best) { missing.push(ref); continue; }
    if (!LOSSLESS.has(best.ext) && best.ext !== '.jpg' && best.ext !== '.jpeg') webpOnly.push({ ref, best });
    const stem = path.basename(ref, path.extname(ref));
    const dest = path.join(MASTERS, path.dirname(ref).replace(/^\//, ''), stem + best.ext);
    jobs.push({ ref, src: best.abs, dest, ext: best.ext, size: best.size });
  }

  const toCreate = jobs.filter((j) => !existsSync(j.dest));
  const existing = jobs.filter((j) => existsSync(j.dest));

  console.log(`referenced display images: ${imageRefs.length}`);
  console.log(`  masters already present: ${existing.length}`);
  console.log(`  masters to create:       ${toCreate.length}   ${mb(toCreate.reduce((a, j) => a + j.size, 0))}`);
  console.log(`  webp-only (no lossless raw survives): ${webpOnly.length}`);
  if (missing.length) console.log(`  MISSING (no source found): ${missing.length}\n    ${missing.join('\n    ')}`);

  if (webpOnly.length) {
    console.log(`\nwebp-only assets (master holds the lossy webp; AVIF for these derives from webp, not raw):`);
    for (const w of webpOnly) console.log(`  ${w.ref}`);
  }

  if (dry) {
    console.log('\n--dry: nothing written.');
    return;
  }

  for (const j of toCreate) {
    mkdirSync(path.dirname(j.dest), { recursive: true });
    copyFileSync(j.src, j.dest);
  }
  const total = jobs.reduce((a, j) => a + statSync(j.dest).size, 0);
  console.log(`\ncreated ${toCreate.length} master(s). masters/ now holds ${jobs.length} image(s), ${mb(total)}.`);
}

main();
