# Lighthouse Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three Lighthouse issues: 953 KB thumbnail, missing img dimensions (breaks LCP), and Cloudflare cache TTL.

**Architecture:** (1) Change `bookshelf-loading.webp` from `type: gif` to `type: image` in `work.yaml` so `pnpm optimize` generates a small static thumb automatically. (2) Fix the optimize script's early-return guard so it runs thumb generation even when no video/image conversions are pending. (3) Add `sharp` dimension reads to WorkRow.astro's build-time frontmatter and emit `width`/`height` on every `<img>`. (4) Provide Cloudflare dashboard steps for cache TTL.

**Tech Stack:** Astro (SSG), sharp (devDep, already installed), Vitest, work.yaml + Zod schema

---

### Task 1: Fix optimize-portfolio.mjs early-return gate

The script's "nothing to do" guard only checks `videoJobs` and `imageJobs`, so it exits before generating thumbnails when those queues are empty. After the `work.yaml` type change in Task 2, the only work is generating a new thumb — and this bug would silently skip it.

**Files:**
- Modify: `tools/optimize-portfolio.mjs:432`

- [ ] **Step 1: Verify the bug exists**

Run: `pnpm optimize --dry`

Expected: prints `thumbnails: all up to date.` (bookshelf-loading is currently gif type, so it's skipped — that's fine). Note that after the Task 2 type change the thumb will appear in the plan but without this fix it would never execute.

- [ ] **Step 2: Apply the fix**

In `tools/optimize-portfolio.mjs`, line 432, change:

```js
  if (videoJobs.length + imageJobs.length === 0) {
    console.log('\nnothing to do.');
    return;
  }
```

to:

```js
  if (videoJobs.length + imageJobs.length + thumbJobs.length === 0) {
    console.log('\nnothing to do.');
    return;
  }
```

- [ ] **Step 3: Run existing tests**

Run: `pnpm test`

Expected: all tests pass (no tests need updating; the fix doesn't change any exported function).

- [ ] **Step 4: Commit**

```bash
git add tools/optimize-portfolio.mjs
git commit -m "fix(optimize): include thumbJobs in early-return guard"
```

---

### Task 2: Change bookshelf-loading asset type

`stripImageRef()` returns null for `gif` type (intentional, to preserve animation). Changing to `image` makes it return the file's src, which gets picked up by the thumbnail step. In the lightbox, `image` type renders as `<img>` — the original animated WebP still autoplays there.

**Files:**
- Modify: `src/data/work.yaml:498`

- [ ] **Step 1: Edit work.yaml**

At line 498, change:

```yaml
    - type: gif
      src: /symphonypro/bookshelf-loading.webp
      alt: Symphony Pro's bookshelf loading animation
      orientation: landscape
```

to:

```yaml
    - type: image
      src: /symphonypro/bookshelf-loading.webp
      alt: Symphony Pro's bookshelf loading animation
      orientation: landscape
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`

Expected: all tests pass. `work.test.ts` checks that each asset type is in `['image','gif','video','youtube','embed','pdf']` — `image` still satisfies this. The `stripImageRef` tests in `optimize-portfolio.test.mjs` are unaffected (they use inline fixture objects, not work.yaml).

- [ ] **Step 3: Confirm optimize sees the new thumb job**

Run: `pnpm optimize --dry`

Expected: output includes a line like:
```
thumbnail plan (N strip image(s) to generate):
  thumb  /symphonypro/bookshelf-loading.webp -> /symphonypro/bookshelf-loading-thumb.webp  [h600, lossy webp q80]
```

- [ ] **Step 4: Generate the thumbnail**

Run: `pnpm optimize`

Expected: `public/symphonypro/bookshelf-loading-thumb.webp` is created. Output shows size reduction, e.g. `0.95 MB -> 0.08 MB`.

- [ ] **Step 5: Verify the thumbnail**

```bash
ls -lh public/symphonypro/bookshelf-loading-thumb.webp
```

Expected: file exists, size < 200 KB.

- [ ] **Step 6: Run full check**

Run: `pnpm check && pnpm test`

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/data/work.yaml public/symphonypro/bookshelf-loading-thumb.webp
git commit -m "perf: generate static thumb for bookshelf-loading animation"
```

---

### Task 3: Add width/height attributes to strip images

Without `width` and `height` HTML attributes, the browser can't reserve space before images load, and Lighthouse 13 fails to identify any LCP element (driving the performance score to null). `sharp` reads image headers (fast, ~1-2ms each) at Astro build time to get the intrinsic pixel dimensions. CSS still controls display size (`height: var(--shot-h); width: auto`); the HTML attrs only supply the aspect ratio.

**Files:**
- Modify: `src/components/WorkRow.astro:1-51` (frontmatter)
- Modify: `src/components/WorkRow.astro:81-88` (img tag)

- [ ] **Step 1: Add sharp import and getDims helper to WorkRow.astro**

Replace the entire frontmatter block (lines 1-51, everything between the `---` fences) with:

```typescript
---
import { existsSync } from 'node:fs';
import { thumbPath } from '../../tools/optimize-portfolio.mjs';
import { youtubePoster, type Project } from '../data/work';
import ActionLinks from './ActionLinks.astro';
import sharp from 'sharp';

interface Props { project: Project; eager?: boolean; }
const { project, eager = false } = Astro.props;
const assets = project.assets;

/**
 * Resolve the strip thumbnail src for one asset. Priority:
 *   1. asset.poster  (explicit still; video/embed/pdf always have one)
 *   2. youtubePoster(asset.src)  for youtube assets (external URL, no thumb)
 *   3. asset.src  for image assets (type='image' or missing type)
 * Then: if the chosen ref is a local absolute path and a '-thumb.webp' sibling
 * exists in public/, use the thumb. WorkRow renders at --shot-h (max ~300px),
 * so the thumb (2x shotHeight tall) is more than sharp enough while being a
 * fraction of the full-resolution source size.
 * GIF src paths are returned as-is: generating a lossy WebP thumb would kill
 * the animation. YouTube and external poster URLs bypass the thumb check.
 */
function resolveStripSrc(asset: (typeof assets)[number]): string {
  const ref: string =
    asset.poster
    ?? (asset.type === 'youtube' ? youtubePoster(asset.src) : undefined)
    ?? ((asset.type == null || asset.type === 'image') ? asset.src : undefined)
    ?? asset.src;
  if (ref.startsWith('/') && asset.type !== 'gif') {
    const thumb = thumbPath(ref);
    if (existsSync(`${process.cwd()}/public${thumb}`)) return thumb;
  }
  return ref;
}

type Dims = { width: number; height: number } | undefined;

/** Read intrinsic pixel dimensions from a strip src at build time. */
async function getDims(src: string): Promise<Dims> {
  if (src.startsWith('https://i.ytimg.com/')) return { width: 320, height: 180 };
  if (!src.startsWith('/')) return undefined;
  const abs = `${process.cwd()}/public${src}`;
  if (!existsSync(abs)) return undefined;
  try {
    const { width, height } = await sharp(abs).metadata();
    return width && height ? { width, height } : undefined;
  } catch {
    return undefined;
  }
}

const stripSrcs = assets.map(resolveStripSrc);
const dims = await Promise.all(stripSrcs.map(getDims));

const actions = [
  ...(project.deepDive ? [{ label: 'Deep dive', href: `/work/${project.slug}/` }] : []),
  ...project.links,
].map((a) => ({ ...a, external: /^https?:/.test(a.href) }));
---
```

- [ ] **Step 2: Add width/height to the img tag**

In the HTML template, find the `<img>` element (around line 81 after the frontmatter change) and add `width` and `height`:

```astro
          <img
            src={resolveStripSrc(s)}
            alt={s.alt}
            width={dims[i]?.width}
            height={dims[i]?.height}
            loading={eager && i < 4 ? 'eager' : 'lazy'}
            fetchpriority={eager && i === 0 ? 'high' : undefined}
            decoding="async"
            draggable="false"
          />
```

- [ ] **Step 3: Type-check**

Run: `pnpm check`

Expected: no errors. `sharp` ships its own TypeScript types.

- [ ] **Step 4: Build to confirm no runtime errors**

Run: `pnpm build`

Expected: builds successfully in ~1.5-2s (slight increase from the ~70 sharp metadata reads). All 10 pages generated.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkRow.astro
git commit -m "perf: add width/height to strip images for LCP and layout reservation"
```

---

### Task 4: Push and verify Lighthouse score

- [ ] **Step 1: Push to master**

```bash
git push
```

Expected: GitHub Actions deploys to rsml.github.io (watch at https://github.com/rsml/rsml.github.io/actions).

- [ ] **Step 2: Re-run Lighthouse once deployed**

```bash
lighthouse https://rossmiller.dev/ \
  --output json --output-path /tmp/lh-after.json \
  --chrome-flags="--headless" \
  --only-categories=performance,accessibility,best-practices,seo \
  --throttling-method=provided
```

Then check scores:

```bash
node -e "
const r = require('/tmp/lh-after.json');
const a = r.audits;
for (const [k,v] of Object.entries(r.categories)) console.log(k, Math.round((v.score??0)*100));
const lcp = a['largest-contentful-paint'];
console.log('LCP:', lcp?.displayValue, 'score:', lcp?.score);
"
```

Expected: performance score >= 90, LCP is measurable (not null).

---

### Task 5: Fix Cloudflare cache TTL (manual dashboard steps)

Cannot be automated (MCP is read-only). Current state: `cache-control: max-age=600` (GitHub Pages default) is being passed through unchanged.

- [ ] **Step 1: Open Cloudflare dashboard**

Navigate to: https://dash.cloudflare.com > rossmiller.dev zone > Caching > Cache Rules

- [ ] **Step 2: Add rule for content-hashed Astro assets (1-year TTL)**

Click "Create rule".
- Rule name: `Astro build assets (immutable)`
- When: Custom filter expression
  - Field: `URI Path`
  - Operator: `starts with`
  - Value: `/_astro/`
- Then: Cache eligibility = `Eligible for cache`
- Edge TTL: Override origin, 1 year
- Browser TTL: Override origin, 1 year

Save.

Rationale: Astro fingerprints all `/_astro/` filenames at build time (e.g., `index.DY6eZFce.css`). New deploys produce new hashes, so 1-year TTL carries zero stale-content risk.

- [ ] **Step 3: Add rule for general portfolio assets (7-day TTL)**

Click "Create rule".
- Rule name: `Portfolio assets (7 day)`
- When: Custom filter expression
  - Field: `Hostname`
  - Operator: `equals`
  - Value: `rossmiller.dev`
- Then: Cache eligibility = `Eligible for cache`
- Edge TTL: Override origin, 7 days
- Browser TTL: Override origin, 7 days

Save. Drag this rule BELOW the `_astro` rule so the more-specific rule fires first.

- [ ] **Step 4: Verify**

```bash
curl -sI https://rossmiller.dev/symphonypro/bookshelf-loading-thumb.webp | grep -i "cache-control\|cf-cache"
```

Expected: `cache-control: max-age=604800` (7 days) and `cf-cache-status: HIT` on the second request.
