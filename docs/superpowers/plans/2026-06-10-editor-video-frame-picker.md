# Editor Video Frame Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `pnpm editor`, pick any video asset's poster by scrubbing the video to an exact frame; the server extracts it with ffmpeg at full resolution.

**Architecture:** One new server endpoint (`POST /api/poster?src&t`) wraps a new `extractFrame` helper (ffmpeg `-ss <t> ... -frames:v 1`, temp file then rename so a failed extract never destroys the current poster). `makePoster`'s video branch is replaced by `extractFrame(t=0)` (drop-time unification, retiring qlmanage). The client adds a frame button on video thumbs that opens a scrub modal; confirm sends only a timestamp, sets `a.poster` from the response, and cache-busts the thumb. Saving rides the existing `/api/save` path (`syncAsset` already writes `poster`); `apply-edits.ts` and the schema are untouched.

**Tech Stack:** Node 24 (`node:http`, native TS stripping), ffmpeg (already a dependency), plain-JS editor client (no build step).

**Spec:** `docs/superpowers/specs/2026-06-10-video-frame-picker-design.md`

**Working-tree caveat:** the repo has pending uncommitted changes in two clusters. The tooling cluster (editor transcode-on-drop, `pnpm optimize`) is a prerequisite of this feature and is committed first in Task 0. The site-content cluster (`src/components/`, `src/data/`, `src/pages/`, `src/scripts/`, `public/` adds/deletes) is unrelated user work: NEVER `git add` those paths in this plan. Every commit below adds explicit paths only.

---

## File structure

- Modify: `tools/editor/server.ts` (new `extractFrame`, `makePoster` video branch, `/api/poster` endpoint)
- Modify: `tools/editor/public/editor.js` (poster cache-bust, frame button, picker modal)
- Modify: `tools/editor/public/editor.css` (frame button + modal styles)
- Modify: `tools/editor/public/index.html` (hint line)
- Modify: `CLAUDE.md` (editor command description)
- No changes: `tools/editor/apply-edits.ts`, `src/data/schema.ts` (poster already flows through save)
- No new tests: dev-only I/O glue with no existing harness (per spec); verification is live `curl` smoke tests + a manual browser pass. `pnpm test` (apply-edits + optimize suites) must stay green throughout.

---

### Task 0: Commit the pending tooling work (prerequisite)

The exact files this feature edits already carry a finished, uncommitted increment (transcode non-web drops via ffmpeg/sips, default alt text, transcode status messages, the `pnpm optimize` pipeline + `sharp` dep + backup-dir gitignore, CLAUDE.md docs for both). Commit it as its own commit so feature commits stay readable. `server.ts` imports `../optimize-portfolio.mjs`, so the (untracked) optimize files must land in the same commit.

**Files:**
- Commit as-is: `.gitignore`, `CLAUDE.md`, `package.json`, `pnpm-lock.yaml`, `tools/editor/server.ts`, `tools/editor/public/editor.js`, `tools/optimize-portfolio.mjs`, `tools/optimize-portfolio.test.mjs`

- [ ] **Step 0.1: Verify the pending state is green**

Run: `pnpm test && pnpm check`
Expected: all Vitest suites pass (apply-edits + optimize); astro check reports 0 errors.

- [ ] **Step 0.2: Commit exactly the tooling paths**

```bash
git add .gitignore CLAUDE.md package.json pnpm-lock.yaml tools/editor/server.ts tools/editor/public/editor.js tools/optimize-portfolio.mjs tools/optimize-portfolio.test.mjs
git commit -m "feat(tooling): editor transcodes non-web drops; pnpm optimize pipeline"
```

Expected: `git status --short tools/ package.json CLAUDE.md .gitignore` shows nothing pending; `src/` and `public/` changes remain untouched.

---

### Task 1: `extractFrame` + drop-time unification (server)

**Files:**
- Modify: `tools/editor/server.ts:154-172` (the `makePoster` block)

- [ ] **Step 1.1: Replace `makePoster` with `extractFrame` + a slimmer `makePoster`**

Replace the whole existing `makePoster` function (its doc comment, lines ~154-172) with:

```ts
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
```

Notes: `rename`, `rm`, `randomUUID`, `existsSync`, `runCmd` are all already imported/defined. qlmanage is no longer used anywhere; PDF naming keeps its collision-suffix behavior (videos own `<base>-poster.png` outright, per spec).

- [ ] **Step 1.2: Verify diagnostics and suites stay green**

Run: `pnpm check && pnpm test`
Expected: 0 errors; all tests pass.

- [ ] **Step 1.3: Commit**

```bash
git add tools/editor/server.ts
git commit -m "feat(editor): extract video drop posters with ffmpeg at full resolution"
```

---

### Task 2: `POST /api/poster` endpoint (server)

**Files:**
- Modify: `tools/editor/server.ts` (in `handleApi`, insert after the `/api/webshot` block, before the final `json(res, 404, ...)`)

- [ ] **Step 2.1: Add the endpoint**

```ts
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
```

An `extractFrame` failure (e.g. t past the end) throws to the server's catch-all, which returns 500 with the message; the existing poster file survives (temp-then-rename).

- [ ] **Step 2.2: Live smoke test (synthetic video, self-cleaning)**

```bash
ffmpeg -y -f lavfi -i testsrc2=duration=2:size=320x240:rate=30 -pix_fmt yuv420p /tmp/frame-picker-test.mp4
mkdir -p public/frame-picker-test && cp /tmp/frame-picker-test.mp4 public/frame-picker-test/clip.mp4
node tools/editor/server.ts &   # background; kill at the end
```

Then verify, in order:

| call | expect |
|---|---|
| `curl -s -X POST 'http://127.0.0.1:4399/api/poster?src=/frame-picker-test/clip.mp4&t=1.5'` | `{"poster":"/frame-picker-test/clip-poster.png"}` and the file exists |
| same call again with `t=0.5` | same poster path; `ls public/frame-picker-test` shows exactly `clip.mp4 clip-poster.png` (no `-2`) |
| `...?src=/../package.json&t=1` | 400 (traversal guard) |
| `...?src=/frame-picker-test/clip-poster.png&t=1` | 400 (not a video) |
| `...?src=/frame-picker-test/clip.mp4&t=-1` | 400 |
| `...?src=/frame-picker-test/clip.mp4&t=99` | 500 "no frame", and `clip-poster.png` still intact |
| `curl -s -X POST --data-binary @/tmp/frame-picker-test.mp4 'http://127.0.0.1:4399/api/upload?slug=chord-colors&name=frame-smoke.mp4'` | `{"src":"/chord-colors/frame-smoke.mp4","poster":"/chord-colors/frame-smoke-poster.png","assetType":"video"}` (Task 1's t=0 path; upload alone never touches work.yaml) |

Cleanup:

```bash
kill %1
rm -rf public/frame-picker-test /tmp/frame-picker-test.mp4 public/chord-colors/frame-smoke.mp4 public/chord-colors/frame-smoke-poster.png
```

(If `chord-colors` is not a slug in `src/data/work.yaml`, substitute any slug that is.)

- [ ] **Step 2.3: Verify diagnostics, commit**

Run: `pnpm check && pnpm test` → green.

```bash
git add tools/editor/server.ts
git commit -m "feat(editor): POST /api/poster extracts a chosen video frame as the poster"
```

---

### Task 3: Frame picker UI (client)

**Files:**
- Modify: `tools/editor/public/editor.js`
- Modify: `tools/editor/public/editor.css`
- Modify: `tools/editor/public/index.html:15` (hint line)

- [ ] **Step 3.1: Cache-busted `thumbSrc`**

In `editor.js`, replace the single-line `thumbSrc` (line ~23) with:

```js
// Posters overwritten in place (a re-picked frame keeps the same filename) need
// a cache-buster so the strip <img> shows the new pixels immediately.
const posterBust = new Map();
const thumbSrc = (a) => {
  const base = a.poster ?? (a.type === 'youtube' ? `https://i.ytimg.com/vi/${youtubeId(a.src)}/mqdefault.jpg` : a.src);
  const bust = a.poster && posterBust.get(a.poster);
  return bust ? `${base}?t=${bust}` : base;
};
```

- [ ] **Step 3.2: Frame button on video thumbs**

In `renderAssets`, right after `if (a.type !== 'image') pic.append(el('span', { class: 'badge' }, a.type));` add:

```js
    if (a.type === 'video') {
      pic.append(el('button', { class: 'frame-btn', type: 'button', title: 'choose the thumbnail frame',
        onclick: () => openFramePicker(a) }, '⌖ frame'));
    }
```

- [ ] **Step 3.3: The picker modal**

Add after `uploadFiles` (before `urlAdder`):

```js
/**
 * The video frame picker: scrub the real video in a modal, capture the paused
 * frame as the asset's poster. The server extracts the exact frame with ffmpeg
 * (POST /api/poster), so the client only ever sends a timestamp. Works on any
 * existing video asset; the video file itself is never touched.
 */
function openFramePicker(a) {
  const video = el('video', { src: a.src, controls: '', preload: 'metadata' });
  const time = el('span', { class: 'time' }, '0.000s');
  const showTime = () => { time.textContent = `${video.currentTime.toFixed(3)}s`; };
  video.addEventListener('timeupdate', showTime);
  video.addEventListener('seeked', showTime);
  const nudge = (frames) => {
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + frames / 30));
  };
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === ',') { e.preventDefault(); nudge(-1); }
    else if (e.key === '.') { e.preventDefault(); nudge(1); }
  };
  const useBtn = el('button', { class: 'add-btn use-frame', type: 'button' }, 'use this frame');
  useBtn.addEventListener('click', async () => {
    video.pause();
    // Back off a hair from the very end: the final timestamp often has no decodable frame.
    const t = Math.max(0, Math.min(video.currentTime, (video.duration || video.currentTime) - 0.05));
    useBtn.disabled = true;
    setStatus('extracting frame…');
    try {
      const res = await fetch(`/api/poster?src=${encodeURIComponent(a.src)}&t=${t}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { showError(data.error); setStatus(state.dirty ? 'unsaved changes' : ''); return; }
      a.poster = data.poster;
      posterBust.set(a.poster, Date.now());
      showError('');
      markDirty();
      close();
      render();
    } finally {
      useBtn.disabled = false;
    }
  });
  const overlay = el('div', { class: 'picker-overlay' },
    el('div', { class: 'picker' },
      video,
      el('div', { class: 'picker-bar' },
        el('button', { class: 'icon-btn', type: 'button', title: 'back one frame (,)', onclick: () => nudge(-1) }, '‹'),
        time,
        el('button', { class: 'icon-btn', type: 'button', title: 'forward one frame (.)', onclick: () => nudge(1) }, '›'),
        useBtn,
        el('button', { class: 'icon-btn', type: 'button', title: 'cancel (Esc)', onclick: () => close() }, '✕'),
      ),
    ),
  );
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}
```

- [ ] **Step 3.4: Styles**

Append to `editor.css`:

```css
/* The video frame picker: a button on each video thumb + a scrub modal. */
.thumb .frame-btn {
  position: absolute;
  bottom: 5px;
  left: 5px;
  border: 0;
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: rgba(17, 17, 17, 0.65);
  cursor: pointer;
}
.thumb .frame-btn:hover { background: var(--accent); }
.picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 17, 17, 0.55);
}
.picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--card);
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
}
.picker video {
  max-width: min(80vw, 900px);
  max-height: 70vh;
  border-radius: 8px;
  background: #000;
}
.picker-bar { display: flex; align-items: center; justify-content: center; gap: 10px; }
.picker-bar .time { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); min-width: 70px; text-align: center; }
.picker-bar .use-frame { margin-top: 0; background: var(--ink); color: #fff; border-color: var(--ink); }
.picker-bar .use-frame:hover { background: var(--accent); border-color: var(--accent); }
.picker-bar .use-frame:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 3.5: Hint line**

In `index.html`, replace the `<p class="hint">` sentence "Drop images, PDFs, or MP4s onto a gallery (PDF/video posters render automatically)." with "Drop images, PDFs, or videos onto a gallery (posters render automatically; ⌖ frame on a video picks its thumbnail)."

- [ ] **Step 3.6: Syntax check**

Run: `node --check tools/editor/public/editor.js`
Expected: no output (exit 0).

- [ ] **Step 3.7: Manual browser verification (reversible)**

1. Note the current `poster:` value of one video asset in `src/data/work.yaml` (e.g. chord-colors `wheel.mp4` → `/chord-colors/wheel-poster.webp`).
2. `node tools/editor/server.ts` and open `http://127.0.0.1:4399`.
3. Every video thumb shows the `⌖ frame` button; non-video thumbs do not.
4. Click it on that video: modal opens, video scrubs; `,` / `.` and `‹`/`›` nudge by one frame with the time readout updating; Esc and backdrop-click close without changes.
5. Reopen, scrub mid-video, "use this frame": modal closes, that thumb shows the new frame (URL has `?t=`), status says "unsaved changes".
6. Save (Cmd+S). Verify in `work.yaml`: only that asset's `poster:` changed to `/chord-colors/wheel-poster.png`, comments/format intact; the png exists on disk.
7. Re-pick a different frame on the same video and save again: same filename, new pixels, no `-2` file.
8. **Restore:** revert that one `poster:` line in `work.yaml` to the value from step 1 (hand-edit), delete the generated `wheel-poster.png`, stop the server.

- [ ] **Step 3.8: Commit**

```bash
git add tools/editor/public/editor.js tools/editor/public/editor.css tools/editor/public/index.html
git commit -m "feat(editor): frame picker modal to choose any video's thumbnail"
```

---

### Task 4: Documentation

**Files:**
- Modify: `CLAUDE.md` (the `pnpm editor` bullet)

- [ ] **Step 4.1: Update the editor description**

In the `pnpm editor` bullet, replace "video + PDF posters render via QuickLook/sips" with "video + PDF posters render via ffmpeg/sips; ⌖ frame on any video scrubs to re-pick its thumbnail frame".

- [ ] **Step 4.2: Final green run + commit**

Run: `pnpm check && pnpm test` → green.

```bash
git add CLAUDE.md docs/superpowers/plans/2026-06-10-editor-video-frame-picker.md
git commit -m "docs: frame picker in the pnpm editor description"
```
