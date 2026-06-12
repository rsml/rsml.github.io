/**
 * The work.yaml editor's I/O adapter: a tiny localhost-only HTTP server.
 * Run with `pnpm edit` (plain `node`; Node >= 23.6 strips the types).
 *
 * All YAML manipulation lives in the pure `apply-edits.ts`; this file only
 * does HTTP, file reads/writes, and validation wiring. It is dev tooling:
 * nothing in `src/` imports it and it never ships in the production build.
 */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { z } from 'zod';
import { WorkSchema } from '../../src/data/schema.ts';
import { applyEdits, stampIds, inferAssetDir } from './apply-edits.ts';
import type { EditedProject } from './apply-edits.ts';
import { parseRange } from './http-range.ts';
// Reuse the exact web-ready H.264 settings (and rationale) that `pnpm optimize`
// uses, so a video dropped in the editor encodes identically and arrives already
// carrying the optimized marker (optimize will skip it on later runs).
import { classifyVideo, encodeArgs, outputFps } from '../optimize-portfolio.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK_YAML = path.join(ROOT, 'src/data/work.yaml');
const SITE_PUBLIC = path.join(ROOT, 'public');
const EDITOR_PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const SORTABLE_JS = createRequire(import.meta.url).resolve('sortablejs/Sortable.min.js');
const HOST = '127.0.0.1';
const PORT = Number(process.env.EDITOR_PORT) || 4399;

const runCmd = promisify(execFile);

// ── What you can drop ────────────────────────────────────────────────────────
// Goal: drop basically any image or video and have it just work on the deployed
// site. Browsers only display a subset of formats, so anything outside that subset
// is transcoded on the way in (sips for images, ffmpeg for video) and only the
// web-ready result is kept. macOS-only tooling (sips/qlmanage/ffmpeg), like the
// rest of this file.
const IMAGE_WEB = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']); // shown as-is
const IMAGE_CONVERT = new Set(['.heic', '.heif', '.tif', '.tiff', '.bmp']); // sips -> jpeg
const VIDEO_WEB = new Set(['.mp4', '.webm']); // played as-is
// ffmpeg -> mp4. Generous list; ffmpeg reads far more, but these are the ones worth offering.
const VIDEO_CONVERT = new Set(['.mov', '.m4v', '.avi', '.mkv', '.wmv', '.flv', '.mpg', '.mpeg', '.mpe', '.ogv', '.3gp', '.3g2', '.mts', '.m2ts', '.ts', '.vob', '.mxf', '.asf', '.f4v', '.divx']);

type Ingest = 'image' | 'image-convert' | 'video' | 'video-convert' | 'pdf';

/** How a dropped file should be landed, or null if it is not an image/video/pdf. */
function classifyUpload(ext: string): Ingest | null {
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_WEB.has(ext)) return 'image';
  if (IMAGE_CONVERT.has(ext)) return 'image-convert';
  if (VIDEO_WEB.has(ext)) return 'video';
  if (VIDEO_CONVERT.has(ext)) return 'video-convert';
  return null;
}

/** A collision-safe `<base><ext>` filename in destDir (`x`, then `x-2`, `x-3`, ...). */
function uniqueName(destDir: string, base: string, ext: string): string {
  let name = `${base}${ext}`;
  for (let n = 2; existsSync(path.join(destDir, name)); n++) name = `${base}-${n}${ext}`;
  return name;
}

/** True if `file` has an audio stream (mirrors optimize-portfolio.mjs, which doesn't export it). */
async function hasAudio(file: string): Promise<boolean> {
  try {
    const { stdout } = await runCmd('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Probe the fields classifyVideo/outputFps need (orientation, codec, frame rate). */
async function probeVideo(file: string) {
  const { stdout } = await runCmd('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,avg_frame_rate', '-of', 'csv=p=0', file]);
  const [codec, w, h, pixFmt, fps] = stdout.trim().split(',');
  const [num, den] = (fps || '').split('/').map(Number);
  return {
    codec: codec || '', pixFmt: pixFmt || '',
    width: Number(w) || 0, height: Number(h) || 0,
    avgFps: den ? num / den : 0, marker: false,
  };
}

/**
 * Land a non-web image (HEIC/TIFF/BMP/...) as a web-native JPEG via `sips`. The
 * upload is written to a temp file (sips reads from disk, by extension) and only
 * the converted result is kept. Returns the stored filename. JPEG suits the
 * dominant case (HEIC photos); drop png/webp/avif directly to keep crisp UI shots.
 */
async function ingestImage(bytes: Buffer, ext: string, destDir: string, base: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `ingest-${randomUUID()}${ext}`);
  await writeFile(tmp, bytes);
  try {
    const name = uniqueName(destDir, base, '.jpg');
    await runCmd('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', tmp, '--out', path.join(destDir, name)]);
    if (!existsSync(path.join(destDir, name))) throw new Error('sips produced no output');
    return name;
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Transcode a non-web video (MOV/AVI/...) to a web-ready H.264 MP4 via ffmpeg.
 * The profile comes from the recording itself (portrait = iPhone-style, landscape
 * = desktop-style, exactly like `pnpm optimize`). Returns the stored filename.
 */
async function ingestVideo(bytes: Buffer, ext: string, destDir: string, base: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `ingest-${randomUUID()}${ext}`);
  await writeFile(tmp, bytes);
  const name = uniqueName(destDir, base, '.mp4');
  const out = path.join(destDir, name);
  try {
    const probe = await probeVideo(tmp);
    const plan = classifyVideo(probe);
    // 64MB stdout/stderr cap: ffmpeg's -stats stream over a long encode can exceed execFile's 1MB default.
    await runCmd('ffmpeg', encodeArgs(plan, outputFps(probe.avgFps), await hasAudio(tmp), tmp, out), { maxBuffer: 64 * 1024 * 1024 });
    if (!existsSync(out)) throw new Error('ffmpeg produced no output');
    return name;
  } catch (err) {
    await rm(out, { force: true }); // no partial .mp4 left behind on a failed encode
    throw err;
  } finally {
    await rm(tmp, { force: true });
  }
}
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Extract one frame of a video as its poster, at full video resolution.
 * The poster always lands at `<base>-poster.png` next to the video, replacing
 * any previous pick (re-picking must not accumulate files). The frame renders
 * to a temp name first so a failed extract (e.g. t past the end) can never
 * destroy the poster work.yaml currently points at.
 */
async function extractFrame(videoPath: string, t: number, destDir: string, base: string): Promise<string> {
  const posterName = `${base}-poster.png`;
  const tmp = path.join(destDir, `.frame-${randomUUID()}.png`);
  try {
    // -ss before -i: fast keyframe seek, then exact decode to t. -update 1: single image output.
    await runCmd('ffmpeg', ['-y', '-ss', String(t), '-i', videoPath, '-frames:v', '1', '-update', '1', tmp]);
    if (!existsSync(tmp)) throw new Error(`ffmpeg produced no frame at t=${t}s (past the end of the video?)`);
    await rename(tmp, path.join(destDir, posterName));
    return posterName;
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Render a `<base>-poster.png` for a type that can't be its own strip thumbnail:
 * PDFs via `sips` (page 1), videos via ffmpeg (first frame, full resolution).
 */
async function makePoster(kind: 'pdf' | 'video', filePath: string, destDir: string, base: string): Promise<string> {
  if (kind === 'video') return extractFrame(filePath, 0, destDir, base);
  let posterName = `${base}-poster.png`;
  for (let n = 2; existsSync(path.join(destDir, posterName)); n++) posterName = `${base}-poster-${n}.png`;
  const posterPath = path.join(destDir, posterName);
  await runCmd('sips', ['-s', 'format', 'png', filePath, '--out', posterPath]);
  if (!existsSync(posterPath)) throw new Error('poster file was not produced');
  return posterName;
}

const rev = (text: string) => createHash('sha1').update(text).digest('hex');

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The editor's read payload: validated projects with _id stamps + a file revision. */
async function loadWork() {
  const text = await readFile(WORK_YAML, 'utf8');
  return { rev: rev(text), text, projects: stampIds(WorkSchema.parse(parse(text))) };
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Resolve (and create) the project's asset directory; respond 404 and return null on a bad slug. */
async function assetDest(slug: string, res: http.ServerResponse): Promise<{ dir: string; destDir: string; project: EditedProject } | null> {
  const { projects } = await loadWork();
  const project = projects.find((p) => p.slug === slug);
  if (!project) {
    json(res, 404, { error: `unknown project slug: ${slug}` });
    return null;
  }
  const dir = inferAssetDir(project);
  const destDir = path.join(SITE_PUBLIC, dir.slice(1));
  await mkdir(destDir, { recursive: true });
  return { dir, destDir, project };
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  if (req.method === 'GET' && url.pathname === '/api/work') {
    const work = await loadWork();
    json(res, 200, { rev: work.rev, projects: work.projects });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/save') {
    const payload = JSON.parse((await readBody(req)).toString('utf8')) as {
      rev: string;
      projects: EditedProject[];
    };
    const text = await readFile(WORK_YAML, 'utf8');
    if (rev(text) !== payload.rev) {
      json(res, 409, { error: 'work.yaml changed on disk since it was loaded. Reload the editor.' });
      return;
    }
    WorkSchema.parse(payload.projects); // throws ZodError, mapped to 400 below
    const next = applyEdits(text, payload.projects);
    WorkSchema.parse(parse(next)); // editor-bug guard: never write an invalid file
    await writeFile(WORK_YAML, next, 'utf8');
    const work = await loadWork();
    json(res, 200, { rev: work.rev, projects: work.projects });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const slug = url.searchParams.get('slug') ?? '';
    const name = path.basename(url.searchParams.get('name') ?? '').replace(/[^\w.\-]+/g, '-');
    const ext = path.extname(name).toLowerCase();
    const plan = classifyUpload(ext);
    if (!plan) {
      json(res, 400, {
        error: `${name}: drop an image (${[...IMAGE_WEB, ...IMAGE_CONVERT].join(' ')}), a video (${[...VIDEO_WEB, ...VIDEO_CONVERT].join(' ')}), or a pdf. Non-web formats like mov/heic are converted automatically.`,
      });
      return;
    }
    const dest = await assetDest(slug, res);
    if (!dest) return;
    const { dir, destDir } = dest;
    const base = name.slice(0, name.length - ext.length) || 'asset';
    const bytes = await readBody(req);
    const assetType: 'image' | 'video' | 'pdf' = plan === 'pdf' ? 'pdf' : plan.startsWith('video') ? 'video' : 'image';

    // 1) Land the file: copy web-native formats, transcode the rest to a web-ready one.
    let stored: string;
    try {
      if (plan === 'image-convert') stored = await ingestImage(bytes, ext, destDir, base);
      else if (plan === 'video-convert') stored = await ingestVideo(bytes, ext, destDir, base);
      else { stored = uniqueName(destDir, base, ext); await writeFile(path.join(destDir, stored), bytes); }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 500, { error: `${name}: could not convert this file (${msg}). Nothing was kept; convert it by hand or add it in work.yaml.` });
      return;
    }

    // 2) Images are their own strip thumbnail; video + pdf need a generated poster.
    if (assetType === 'image') {
      json(res, 200, { src: `${dir}/${stored}` });
      return;
    }
    try {
      const poster = await makePoster(assetType, path.join(destDir, stored), destDir, stored.slice(0, stored.length - path.extname(stored).length));
      json(res, 200, { src: `${dir}/${stored}`, poster: `${dir}/${poster}`, assetType });
    } catch (err) {
      await rm(path.join(destDir, stored), { force: true }); // no orphan the YAML never references
      const msg = err instanceof Error ? err.message : String(err);
      json(res, 500, { error: `${stored}: could not render a poster (${msg}). File not kept; add this asset by hand in work.yaml.` });
    }
    return;
  }

  // Render a poster screenshot for a live web view (`embed` asset) via
  // headless Chrome, so adding an iframe URL is one paste in the editor.
  // `w`/`h` set the capture viewport: the poster's aspect ratio is what sizes
  // the thumbnail on the home strip, so a portrait gallery wants a phone-sized
  // viewport (e.g. 390x844) and a landscape one a desktop size (e.g. 1440x900).
  if (req.method === 'POST' && url.pathname === '/api/webshot') {
    const slug = url.searchParams.get('slug') ?? '';
    const target = url.searchParams.get('url') ?? '';
    const w = Math.round(Number(url.searchParams.get('w')));
    const h = Math.round(Number(url.searchParams.get('h')));
    if (!/^https?:\/\//.test(target)) {
      json(res, 400, { error: `not a valid http(s) URL: ${target}` });
      return;
    }
    if (!(w >= 200 && w <= 3000) || !(h >= 200 && h <= 3000)) {
      json(res, 400, { error: `viewport must be 200..3000 px per side, got ${w}x${h}` });
      return;
    }
    if (!existsSync(CHROME)) {
      json(res, 500, { error: `headless Chrome not found at ${CHROME}; set a poster by hand in work.yaml` });
      return;
    }
    const dest = await assetDest(slug, res);
    if (!dest) return;
    const { dir, destDir } = dest;
    const host = new URL(target).hostname.replace(/[^\w.-]+/g, '-');
    let posterName = `embed-${host}-poster.png`;
    for (let n = 2; existsSync(path.join(destDir, posterName)); n++) posterName = `embed-${host}-poster-${n}.png`;
    const posterPath = path.join(destDir, posterName);
    await runCmd(CHROME, [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      `--window-size=${w},${h}`, '--force-device-scale-factor=2', // 2x for retina-sharp thumbs
      '--virtual-time-budget=6000',
      `--screenshot=${posterPath}`, target,
    ], { timeout: 25_000 });
    if (!existsSync(posterPath)) {
      json(res, 500, { error: `Chrome produced no screenshot for ${target}; set a poster by hand in work.yaml` });
      return;
    }
    json(res, 200, { poster: `${dir}/${posterName}` });
    return;
  }

  // Extract the frame a video is paused on as its poster: the editor's
  // thumbnail picker. The client sends only `src` (the asset's public path)
  // and `t` (seconds); the frame lands next to the video as
  // `<videobase>-poster.png`, replacing any previous pick.
  if (req.method === 'POST' && url.pathname === '/api/poster') {
    const src = url.searchParams.get('src') ?? '';
    const t = Number(url.searchParams.get('t'));
    const videoPath = path.normalize(path.join(SITE_PUBLIC, src));
    if (!src.startsWith('/') || !videoPath.startsWith(SITE_PUBLIC + path.sep) || !existsSync(videoPath)) {
      json(res, 400, { error: `not a file under public/: ${src}` });
      return;
    }
    const ext = path.extname(videoPath).toLowerCase();
    if (!VIDEO_WEB.has(ext)) {
      json(res, 400, { error: `frame picking needs a ${[...VIDEO_WEB].join('/')} video, got ${src}` });
      return;
    }
    if (!Number.isFinite(t) || t < 0) {
      json(res, 400, { error: `t must be seconds >= 0, got ${url.searchParams.get('t')}` });
      return;
    }
    const poster = await extractFrame(videoPath, t, path.dirname(videoPath), path.basename(videoPath, ext));
    const dir = path.posix.dirname(src);
    json(res, 200, { poster: `${dir === '/' ? '' : dir}/${poster}` });
    return;
  }

  json(res, 404, { error: `no such endpoint: ${req.method} ${url.pathname}` });
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  let file: string | undefined;
  if (url.pathname === '/') file = path.join(EDITOR_PUBLIC, 'index.html');
  else if (url.pathname === '/editor.js' || url.pathname === '/editor.css')
    file = path.join(EDITOR_PUBLIC, url.pathname.slice(1));
  else if (url.pathname === '/vendor/sortable.js') file = SORTABLE_JS;
  else {
    const candidate = path.normalize(path.join(SITE_PUBLIC, decodeURIComponent(url.pathname)));
    if (candidate.startsWith(SITE_PUBLIC + path.sep) && existsSync(candidate)) file = candidate;
  }
  if (!file || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const data = await readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  // Range support: the frame picker's <video> can only scrub if media gets
  // real 206 responses (Chrome treats a length-less 200 as unseekable).
  const range = parseRange(req.headers.range, data.length);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'content-range': `bytes */${data.length}` });
    res.end();
    return;
  }
  if (range) {
    res.writeHead(206, {
      'content-type': type,
      'accept-ranges': 'bytes',
      'content-range': `bytes ${range.start}-${range.end}/${data.length}`,
      'content-length': range.end - range.start + 1,
    });
    res.end(data.subarray(range.start, range.end + 1));
    return;
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': data.length });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET') await serveStatic(req, res, url);
    else json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    if (err instanceof z.ZodError) json(res, 400, { error: z.prettifyError(err) });
    else json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`work.yaml editor: http://${HOST}:${PORT}`);
  console.log('tip: run `pnpm dev` in another tab; every save hot-reloads the real homepage.');
});
