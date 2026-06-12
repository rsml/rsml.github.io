# Local work.yaml Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only localhost editor (`pnpm edit`) for `src/data/work.yaml` with drag-reorder (projects, images, links), drop-to-add images, inline text editing, comment-preserving saves, plus a new optional `date` field shown in the homepage role eyebrow.

**Architecture:** Pure core + thin adapters. `tools/editor/apply-edits.ts` is a pure function `(yamlText, editedProjects) -> newYamlText` built on the `yaml` package Document API (it mutates existing nodes, never regenerates the file, so comments survive). `tools/editor/server.ts` is a node:http adapter (localhost:4399) that validates every save against the real Zod schema, which moves from `work.ts` into a new pure `src/data/schema.ts`. The UI is one static page (no build step) using SortableJS.

**Tech Stack:** Node 24 (runs TS directly via type stripping; relative imports between TS files MUST use the `.ts` extension), `yaml` (eemeli) for round-tripping, SortableJS for drag and drop, Zod 4 (already a dep), Vitest.

**Conventions that apply to every line you write:** No em-dashes anywhere (code, comments, content). Use periods, commas, or parentheses. The ` · ` separator in WorkRow is a middot, which is fine.

**Spec:** `docs/superpowers/specs/2026-06-10-local-work-editor-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/data/schema.ts` | create | Pure Zod schema + inferred types. No I/O, no `?raw`. |
| `src/data/work.ts` | modify | Loader only: `?raw` import, parse, exports unchanged. |
| `src/data/work.test.ts` | modify | Stays green; gains schema-level `date` tests. |
| `src/components/WorkRow.astro` | modify | Render optional date after role. |
| `src/data/work.yaml` | modify | Header comment documents `date`. |
| `tools/editor/apply-edits.ts` | create | PURE: applyEdits, stampIds, inferAssetDir. |
| `tools/editor/apply-edits.test.ts` | create | Unit tests incl. real-work.yaml no-op round-trip. |
| `tools/editor/server.ts` | create | HTTP adapter: api/work, api/save, api/upload, static. |
| `tools/editor/public/index.html` | create | Editor shell. |
| `tools/editor/public/editor.css` | create | Editor styles. |
| `tools/editor/public/editor.js` | create | Editor client logic (plain JS, no build). |
| `package.json` | modify | `edit` script; devDeps `yaml`, `sortablejs`, `@types/node`. |
| `CLAUDE.md` | modify | Document `pnpm edit`. |

---

### Task 1: Extract the Zod schema to `src/data/schema.ts`

`work.ts` currently defines the schema AND loads the YAML via `?raw` (Vite-only, so plain Node cannot import it). Split: schema (pure) vs loader. Public API of `work.ts` must not change.

**Files:**
- Create: `src/data/schema.ts`
- Modify: `src/data/work.ts`

- [ ] **Step 1: Create `src/data/schema.ts`**

The schema code moves verbatim from `work.ts` (same docstrings), plus a new `WorkSchema` array wrapper:

```ts
/**
 * The portfolio content schema: the ONE definition of a project's shape.
 *
 * Pure module (no I/O, no Vite imports) so it can be imported both by the
 * build-time loader (`work.ts`) and by Node tooling (`tools/editor/`).
 * It validates `work.yaml` (a typo or missing field fails the build with a
 * precise message) AND the exported types are inferred from it (`z.infer`),
 * so the schema and the types can never drift.
 */
import { z } from 'zod';

const TransitionSchema = z.enum(['ripple', 'fade-slide']);

/**
 * The device a project's assets were captured on. Drives the corner radius
 * applied to its thumbnails and lightbox media (see --corner-* in global.css),
 * so each shot is rounded like its real screen/window.
 */
const DeviceSchema = z.enum(['iphone', 'desktop', 'ipad']);

/**
 * How a gallery asset is rendered in the lightbox (and the home-row strip):
 *   image   a PNG/JPG screenshot (<img>).
 *   gif     an animated GIF (<img>; autoplays). Same render path as `image`.
 *   video   an MP4/WebM, rendered with the Plyr player (see Lightbox.astro).
 *   youtube a YouTube video (by URL or id), played through the SAME Plyr player;
 *           its strip `poster` is auto-derived from the id, so none is required.
 *   embed   a live web view / interactive demo (<iframe>), lazy-loaded only
 *           while its project is the open slide.
 */
const AssetTypeSchema = z.enum(['image', 'gif', 'video', 'youtube', 'embed']);

/**
 * One gallery asset on a home row. A project's assets are homogeneous in
 * `orientation`, which drives both the thumbnail-strip sizing and how the asset
 * is framed in the lightbox. `poster` is the static strip thumbnail; it is
 * REQUIRED for `embed` (a live page can't be a thumbnail) and `video` (so the
 * strip needn't decode the clip), and optional for image/gif.
 */
const AssetSchema = z
  .object({
    type: AssetTypeSchema.default('image'),
    src: z.string(),
    alt: z.string(),
    orientation: z.enum(['portrait', 'landscape']),
    poster: z.string().optional(),
  })
  .refine((a) => !(a.type === 'embed' && !a.poster), {
    message: 'an `embed` asset needs a `poster` (a live web view cannot be a strip thumbnail)',
    path: ['poster'],
  })
  .refine((a) => !(a.type === 'video' && !a.poster), {
    message: 'a `video` asset needs a `poster` (the strip thumbnail; the lightbox also uses it as the play poster)',
    path: ['poster'],
  });

/**
 * A project link. The arrow (→ internal / ↗ external) and whether it opens in a
 * new tab are derived from `href` (see ActionLinks / WorkRow), so the URL is the
 * only thing to set.
 */
const LinkSchema = z.object({
  label: z.string(),
  href: z.string(),
});

const RippleSchema = z.object({
  mode: z.number(), // shader mode (0 = chord colors)
  color1: z.tuple([z.number(), z.number(), z.number()]).optional(),
  color2: z.tuple([z.number(), z.number(), z.number()]).optional(),
  durationMs: z.number(), // clip animation duration
  band: z.number(), // 0..1
  period: z.number(), // 0..1
  sat: z.number(), // 0..1
  light: z.number(), // 0..1
  easeIn: z.number(), // 0..100
  easeOut: z.number(), // 0..100
});

export const ProjectSchema = z.object({
  slug: z.string(),
  title: z.string(),
  /** Label shown on the home card; may be shorter than `title` (the page title). */
  cardTitle: z.string(),
  role: z.string(),
  /** Short "what it is", shown as secondary text after the title. */
  subtitle: z.string(),
  cardDesc: z.string(),
  /** One-sentence explainer (kept for meta/reuse; not shown on the row). */
  blurb: z.string(),
  device: DeviceSchema,
  thumbClass: z.string(), // e.g. "thumb-chord" (drives Thumb.astro variant)
  thumbImage: z.string().optional(), // e.g. "/logos/chord-colors.jpg"
  transition: TransitionSchema,
  /** Prepends a "Deep dive" link (to /work/<slug>/) on the home row + lightbox. */
  deepDive: z.boolean().default(false),
  /** Platform/store links on the home row + the lightbox "Links" dropdown. */
  links: z.array(LinkSchema).default([]),
  /** Gallery shown in the home row's strip and the lightbox. */
  assets: z.array(AssetSchema).default([]),
  marketingUrl: z.string().optional(),
  marketingLabel: z.string().optional(),
  /** When set, the case-study header shows the Apple "Download on the App Store" badge. */
  appStoreUrl: z.string().optional(),
  ripple: RippleSchema.optional(),
});

/** The whole file: a list of projects, in homepage display order. */
export const WorkSchema = z.array(ProjectSchema);

export type Transition = z.infer<typeof TransitionSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type AssetType = z.infer<typeof AssetTypeSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Action = z.infer<typeof LinkSchema>;
export type RippleConfig = z.infer<typeof RippleSchema>;
export type Project = z.infer<typeof ProjectSchema>;
```

- [ ] **Step 2: Rewrite `src/data/work.ts` as the loader only**

Replace the whole file with:

```ts
/**
 * Loads and validates the portfolio content from `work.yaml`.
 *
 * `work.yaml` is the single source of truth (titles, subtitles, links, assets);
 * this module is the typed port onto it. The YAML is imported as a raw string via
 * Vite's `?raw` and inlined at build time, so there is no runtime file read to
 * break when Astro relocates the server bundle, and it works identically in the
 * Astro build and in Vitest (both Vite-based).
 *
 * The Zod schema lives in `./schema.ts` (pure, so Node tooling like
 * `tools/editor/` can import it too); this module re-exports its types, so
 * consumers keep importing `WORK` / `getWork` / `getProject` and the `Project`
 * type exactly as before.
 */
import { load } from 'js-yaml';
// `?raw` inlines the file contents as a string (typed via vite/client, which
// astro/client references). Build-time only, so keep this module out of the client.
import workYaml from './work.yaml?raw';
import { WorkSchema } from './schema';
import type { Project } from './schema';

export type { Transition, Device, AssetType, Asset, Action, RippleConfig, Project } from './schema';

// Parse + validate once at module load. Projects display in file order.
export const WORK: Project[] = WorkSchema.parse(load(workYaml));

export const getWork = (): Project[] => WORK;
export const getProject = (slug: string): Project | undefined => WORK.find((w) => w.slug === slug);

/**
 * The 11-char YouTube video id from a `youtube` asset's `src`, which may be a bare
 * id or any YouTube URL (watch, youtu.be, /embed/, /shorts/). If it matches no known
 * URL shape it is assumed to already be an id and returned trimmed.
 */
export function youtubeId(src: string): string {
  const m = src.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|v\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : src.trim();
}

/** The default strip thumbnail for a `youtube` asset (16:9, always present). */
export const youtubePoster = (src: string): string =>
  `https://i.ytimg.com/vi/${youtubeId(src)}/mqdefault.jpg`;
```

- [ ] **Step 3: Verify tests and types pass**

Run: `pnpm test && pnpm check`
Expected: all 7 vitest tests PASS; astro check reports 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/data/schema.ts src/data/work.ts
git commit -m "refactor: extract pure Zod schema to src/data/schema.ts"
```

---

### Task 2: Optional `date` field (schema + homepage display)

**Files:**
- Modify: `src/data/schema.ts` (ProjectSchema)
- Modify: `src/data/work.test.ts` (new describe block)
- Modify: `src/components/WorkRow.astro:21` (role eyebrow)
- Modify: `src/data/work.yaml` (header comment only)

- [ ] **Step 1: Write the failing tests**

Append to `src/data/work.test.ts` (and add `ProjectSchema` to imports at top: `import { ProjectSchema } from './schema';`):

```ts
describe('date field', () => {
  const minimal = {
    slug: 's', title: 'T', cardTitle: 'T', role: 'R', subtitle: 'st',
    cardDesc: 'd', blurb: 'b', device: 'iphone', thumbClass: 'thumb-x',
    transition: 'fade-slide',
  };
  it('is optional', () => {
    expect(ProjectSchema.parse(minimal).date).toBeUndefined();
  });
  it('accepts a freeform string', () => {
    expect(ProjectSchema.parse({ ...minimal, date: '2018-present' }).date).toBe('2018-present');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL. `date` is stripped by the schema (unknown key), so `.date` is `undefined` in the second test (`expected undefined to be '2018-present'`).

- [ ] **Step 3: Add the field to `ProjectSchema` in `src/data/schema.ts`**

Insert directly after the `subtitle` line:

```ts
  /** Optional freeform display date ("2024", "2019-2021", "2018-present"), shown after the role. */
  date: z.string().optional(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS (9 tests).

- [ ] **Step 5: Render the date in `src/components/WorkRow.astro`**

Change line 21 from:

```astro
    <p class="row-role">{project.role}</p>
```

to:

```astro
    <p class="row-role">{project.role}{project.date ? ` · ${project.date}` : ''}</p>
```

- [ ] **Step 6: Document the field in the `work.yaml` header comment**

In `src/data/work.yaml`, after the line documenting `subtitle` (`#    subtitle      required  short "what it is", shown after the title.`), insert:

```yaml
#    date          optional  freeform display date ("2024", "2018-present"),
#                            shown after the role in the row eyebrow.
```

- [ ] **Step 7: Verify**

Run: `pnpm test && pnpm check && pnpm build`
Expected: all pass. (No project sets `date` yet, so rendered markup is unchanged.)

- [ ] **Step 8: Commit**

```bash
git add src/data/schema.ts src/data/work.test.ts src/components/WorkRow.astro src/data/work.yaml
git commit -m "feat: optional per-project date, shown in the row eyebrow"
```

---

### Task 3: Editor dependencies and script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add devDependencies**

Run: `pnpm add -D yaml sortablejs @types/node`
Expected: lockfile updated; `yaml` v2.x, `sortablejs` 1.15.x, `@types/node` current. All under `devDependencies` (verify in `package.json`; `pnpm add -D` guarantees it).

- [ ] **Step 2: Add the `edit` script**

In `package.json` scripts, after `"dev"`:

```json
    "edit": "node tools/editor/server.ts",
```

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm test && pnpm check`
Expected: pass. (`@types/node` may surface new ambient types; there should be no errors.)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: editor devDependencies (yaml, sortablejs, @types/node) + pnpm edit script"
```

---

### Task 4: `apply-edits.ts`, the pure comment-preserving core (TDD)

**Files:**
- Create: `tools/editor/apply-edits.test.ts`
- Create: `tools/editor/apply-edits.ts`

Key design (from the spec):
- The file's leading comment/blank block is split off as a TEXT PREFIX before parsing and re-prepended after stringify. This guarantees the header never travels if the first project is reordered (node-attached comments move with their nodes, which is exactly right for every OTHER comment).
- Projects are matched by `slug`; links/assets by `_id` (their index in the file at load time, stamped by `stampIds`). Matched items REUSE their YAML nodes; reordering rearranges node lists so comments ride along; new items (no `_id`) are created.
- Only editable fields are synced (title, cardTitle, role, subtitle, date, cardDesc, blurb, links' label/href, assets' type/src/alt/orientation/poster). Everything else (device, ripple, marketing fields...) is untouched even if the client sends garbage for them.
- `date` set to empty/whitespace deletes the key. An emptied `links`/`assets` list deletes the key (absence already means `[]` via schema defaults). `type: image` is never WRITTEN for an asset that does not already have an explicit `type` key (absence already means image).
- New keys insert at their canonical position (e.g. `date` lands after `subtitle`), not at the end of the map.
- Stringify with `lineWidth: 0` (long URLs and alt texts must not fold).

- [ ] **Step 1: Write the failing tests**

Create `tools/editor/apply-edits.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { WorkSchema } from '../../src/data/schema.ts';
import { applyEdits, stampIds, inferAssetDir, type EditedProject } from './apply-edits.ts';

/** Parse + validate + stamp, i.e. exactly what GET /api/work serves the client. */
const load = (text: string) => stampIds(WorkSchema.parse(parse(text)));

const FIXTURE = `# ─── HEADER: stays at the top of the file, always ───
# second header line

- slug: alpha
  title: Alpha
  cardTitle: Alpha
  role: Creator
  subtitle: first thing
  cardDesc: Alpha desc
  blurb: Alpha blurb.
  device: iphone
  thumbClass: thumb-a
  transition: fade-slide
  links:
    # TODO: real alpha url
    - label: iOS app
      href: https://example.com/a
    - label: Web app
      href: https://example.com/w
  # NOTE: alpha capture note
  assets:
    - src: /alpha/screenshots/one.png
      alt: 'One: with colon'
      orientation: portrait
    - src: /alpha/screenshots/two.png
      alt: Two
      orientation: portrait

- slug: beta
  title: Beta
  cardTitle: Beta
  role: Founder
  subtitle: second thing
  cardDesc: Beta desc
  blurb: Beta blurb.
  device: desktop
  thumbClass: thumb-b
  transition: fade-slide

- slug: gamma
  title: Gamma
  cardTitle: Gamma
  role: Maker
  subtitle: third thing
  cardDesc: Gamma desc
  blurb: Gamma blurb.
  device: ipad
  thumbClass: thumb-g
  transition: fade-slide
`;

describe('applyEdits', () => {
  it('no-op round-trips the fixture byte-identically', () => {
    expect(applyEdits(FIXTURE, load(FIXTURE))).toBe(FIXTURE);
  });

  it('no-op round-trips the real work.yaml byte-identically', () => {
    const real = readFileSync(new URL('../../src/data/work.yaml', import.meta.url), 'utf8');
    expect(applyEdits(real, load(real))).toBe(real);
  });

  it('keeps the header at the top when projects reorder, and comments travel with their projects', () => {
    const p = load(FIXTURE);
    const out = applyEdits(FIXTURE, [p[2], p[0], p[1]]);
    expect(out.startsWith('# ─── HEADER')).toBe(true);
    expect(WorkSchema.parse(parse(out)).map((w) => w.slug)).toEqual(['gamma', 'alpha', 'beta']);
    // alpha moved but its TODO link comment is still directly above its link
    expect(out).toMatch(/# TODO: real alpha url\n\s+- label: iOS app/);
    // exactly one blank line between projects, none before the first
    expect(out).not.toMatch(/\n\n\n/);
  });

  it('edits text fields, quoting only when needed, preserving neighbors', () => {
    const p = load(FIXTURE);
    p[0].title = 'Alpha: redux';
    p[1].role = 'Founder, CTO';
    const out = applyEdits(FIXTURE, p);
    const parsed = WorkSchema.parse(parse(out));
    expect(parsed[0].title).toBe('Alpha: redux');
    expect(parsed[1].role).toBe('Founder, CTO');
    // untouched scalars keep their original style
    expect(out).toContain("alt: 'One: with colon'");
  });

  it('inserts date after subtitle, and deletes it when emptied', () => {
    const p = load(FIXTURE);
    p[0].date = '2018-present';
    const withDate = applyEdits(FIXTURE, p);
    expect(withDate).toMatch(/subtitle: first thing\n {2}date: 2018-present\n {2}cardDesc:/);
    const p2 = load(withDate);
    p2[0].date = '';
    expect(applyEdits(withDate, p2)).not.toContain('date:');
  });

  it('reorders links with their comments, adds new ones, and drops the key when emptied', () => {
    const p = load(FIXTURE);
    p[0].links = [p[0].links[1], p[0].links[0], { label: 'Docs', href: 'https://example.com/docs' }];
    const out = applyEdits(FIXTURE, p);
    expect(WorkSchema.parse(parse(out))[0].links.map((l) => l.label)).toEqual(['Web app', 'iOS app', 'Docs']);
    // the TODO comment rides with the iOS link to its new position
    expect(out).toMatch(/# TODO: real alpha url\n\s+- label: iOS app/);

    const p2 = load(out);
    p2[0].links = [];
    expect(applyEdits(out, p2)).not.toContain('links:');
  });

  it('reorders assets under their NOTE comment, edits alt, adds image and gif assets', () => {
    const p = load(FIXTURE);
    const [a1, a2] = p[0].assets;
    a2.alt = 'Two, renamed';
    p[0].assets = [
      a2, a1,
      { type: 'image', src: '/alpha/screenshots/three.png', alt: 'Three', orientation: 'portrait' },
      { type: 'gif', src: '/alpha/screenshots/anim.gif', alt: 'Anim', orientation: 'portrait' },
    ];
    const out = applyEdits(FIXTURE, p);
    expect(out).toContain('# NOTE: alpha capture note');
    const assets = WorkSchema.parse(parse(out))[0].assets;
    expect(assets.map((a) => a.alt)).toEqual(['Two, renamed', 'One: with colon', 'Three', 'Anim']);
    // a new plain image gets no `type:` line (absence already means image); a gif does
    expect(out).not.toMatch(/type: image\b/);
    expect(out).toContain('type: gif');
  });

  it('throws on an unknown slug', () => {
    const p = load(FIXTURE);
    p[0] = { ...p[0], slug: 'nope' };
    expect(() => applyEdits(FIXTURE, p)).toThrow(/unknown project slug/i);
  });
});

describe('stampIds', () => {
  it('stamps links and assets with their original index', () => {
    const p = load(FIXTURE);
    expect(p[0].links.map((l) => l._id)).toEqual([0, 1]);
    expect(p[0].assets.map((a) => a._id)).toEqual([0, 1]);
    expect(p[1].links).toEqual([]);
  });
});

describe('inferAssetDir', () => {
  const proj = (assets: { src: string }[]) =>
    ({ slug: 'x', assets } as unknown as EditedProject);
  it('uses the common directory of existing assets', () => {
    expect(inferAssetDir(proj([{ src: '/x/screenshots/a.png' }, { src: '/x/screenshots/b.png' }])))
      .toBe('/x/screenshots');
  });
  it('uses the most frequent directory when mixed', () => {
    expect(inferAssetDir(proj([{ src: '/x/a.png' }, { src: '/x/shots/b.png' }, { src: '/x/shots/c.png' }])))
      .toBe('/x/shots');
  });
  it('falls back to /<slug> with no assets', () => {
    expect(inferAssetDir(proj([]))).toBe('/x');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tools/editor`
Expected: FAIL, cannot resolve `./apply-edits.ts`.

- [ ] **Step 3: Implement `tools/editor/apply-edits.ts`**

```ts
/**
 * The pure core of the work.yaml editor: apply edited project data onto the
 * existing YAML TEXT without losing comments or formatting.
 *
 * Strategy: never regenerate the file. Parse to a Document, then REUSE the
 * existing nodes: projects are matched by slug, links/assets by `_id` (their
 * index in the file at load time, stamped by `stampIds`). Reordering
 * rearranges node lists (comments attached to nodes ride along); field edits
 * mutate scalar values in place (style and neighbors survive); new items are
 * created; the file's leading comment block is split off as plain text and
 * re-prepended, so the header can never travel with a reordered first project.
 *
 * Only EDITABLE fields are synced. Structural fields (device, transition,
 * thumb*, marketing*, ripple, appStoreUrl, deepDive, slug) are never written,
 * so a client bug cannot clobber them.
 */
import { parseDocument, isMap, isScalar, isSeq } from 'yaml';
import type { Document, YAMLMap, Pair, Scalar } from 'yaml';
import type { Project, Action, Asset } from '../../src/data/schema.ts';

export type Stamped<T> = T & { _id?: number };
export type EditedProject = Omit<Project, 'links' | 'assets'> & {
  links: Stamped<Action>[];
  assets: Stamped<Asset>[];
};

/** Editable plain-text fields, synced verbatim. `date` is special (optional, deletable). */
const TEXT_FIELDS = ['title', 'cardTitle', 'role', 'subtitle', 'cardDesc', 'blurb'] as const;

/** Canonical key orders, used to position newly inserted keys. */
const PROJECT_KEYS = [
  'slug', 'title', 'cardTitle', 'role', 'subtitle', 'date', 'cardDesc', 'blurb',
  'device', 'thumbClass', 'thumbImage', 'transition', 'deepDive',
  'marketingUrl', 'marketingLabel', 'appStoreUrl', 'links', 'assets', 'ripple',
];
const LINK_KEYS = ['label', 'href'];
const ASSET_KEYS = ['type', 'src', 'alt', 'orientation', 'poster'];

/** Stamp each link/asset with its index in the loaded file, the id `applyEdits` matches on. */
export function stampIds(projects: Project[]): EditedProject[] {
  return projects.map((p) => ({
    ...p,
    links: p.links.map((l, i) => ({ ...l, _id: i })),
    assets: p.assets.map((a, i) => ({ ...a, _id: i })),
  }));
}

/**
 * The `public/`-relative directory new images for this project are saved to:
 * the most frequent directory among its existing assets (first seen wins
 * ties), falling back to `/<slug>`.
 */
export function inferAssetDir(project: Pick<EditedProject, 'slug' | 'assets'>): string {
  const dirs = (project.assets ?? [])
    .map((a) => a.src)
    .filter((s) => s.startsWith('/'))
    .map((s) => s.slice(0, s.lastIndexOf('/')) || '/');
  if (dirs.length === 0) return `/${project.slug}`;
  const counts = new Map<string, number>();
  for (const d of dirs) counts.set(d, (counts.get(d) ?? 0) + 1);
  let best = dirs[0];
  for (const d of dirs) if (counts.get(d)! > counts.get(best)!) best = d;
  return best;
}

/** Apply edited projects onto the YAML text, preserving comments and formatting. */
export function applyEdits(yamlText: string, edited: EditedProject[]): string {
  // Leading comment/blank block = the file header. Keep it as text so it can
  // never attach to (and travel with) the first project node.
  const header = yamlText.match(/^(?:#[^\n]*\n|[ \t]*\n)*/)![0];
  const body = yamlText.slice(header.length);

  const doc = parseDocument(body);
  if (doc.errors.length > 0) throw new Error(`work.yaml parse failed: ${doc.errors[0].message}`);
  const seq = doc.contents;
  if (!isSeq(seq)) throw new Error('work.yaml: expected a top-level list of projects');

  const bySlug = new Map<string, YAMLMap>();
  for (const item of seq.items) {
    if (isMap(item)) bySlug.set(String(item.get('slug')), item);
  }

  seq.items = edited.map((p) => {
    const node = bySlug.get(p.slug);
    if (!node) throw new Error(`unknown project slug: ${p.slug}`);
    syncProject(doc, node, p);
    return node;
  });
  // Exactly one blank line between projects, none before the first.
  seq.items.forEach((item, i) => {
    (item as YAMLMap).spaceBefore = i > 0;
  });

  return header + doc.toString({ lineWidth: 0 });
}

function syncProject(doc: Document, node: YAMLMap, p: EditedProject): void {
  for (const f of TEXT_FIELDS) setScalar(doc, node, f, p[f], PROJECT_KEYS);
  if (p.date && p.date.trim()) setScalar(doc, node, 'date', p.date, PROJECT_KEYS);
  else node.delete('date');
  syncList(doc, node, 'links', p.links ?? [], syncLink);
  syncList(doc, node, 'assets', p.assets ?? [], syncAsset);
}

function syncLink(doc: Document, node: YAMLMap, l: Stamped<Action>): void {
  setScalar(doc, node, 'label', l.label, LINK_KEYS);
  setScalar(doc, node, 'href', l.href, LINK_KEYS);
}

function syncAsset(doc: Document, node: YAMLMap, a: Stamped<Asset>): void {
  // `type: image` is the schema default: never ADD it, but keep an existing
  // explicit key in sync (some entries spell it out).
  const type = a.type ?? 'image';
  if (node.has('type') || type !== 'image') setScalar(doc, node, 'type', type, ASSET_KEYS);
  setScalar(doc, node, 'src', a.src, ASSET_KEYS);
  setScalar(doc, node, 'alt', a.alt, ASSET_KEYS);
  setScalar(doc, node, 'orientation', a.orientation, ASSET_KEYS);
  if (a.poster) setScalar(doc, node, 'poster', a.poster, ASSET_KEYS);
}

/**
 * Set `key` to a scalar `value` on `map`. An existing scalar node is mutated
 * in place (its quote style and attached comments survive; the stringifier
 * re-quotes automatically if the new value needs it). A missing key is
 * inserted at its canonical position per `keyOrder`, not appended.
 */
function setScalar(doc: Document, map: YAMLMap, key: string, value: unknown, keyOrder: string[]): void {
  const cur = map.get(key, true);
  if (isScalar(cur)) {
    if (cur.value !== value) cur.value = value;
    return;
  }
  if (cur !== undefined) {
    map.set(key, value);
    return;
  }
  insertPair(map, doc.createPair(key, value), key, keyOrder);
}

/**
 * Replace the `key` list of `projectMap` with `items`, reusing each original
 * node when the edited item carries its `_id` (so comments ride along through
 * reorders) and creating nodes for new items. An empty list deletes the key
 * (the schema defaults a missing list to []).
 */
function syncList(
  doc: Document,
  projectMap: YAMLMap,
  key: 'links' | 'assets',
  editedItems: (Stamped<Action> | Stamped<Asset>)[],
  syncItem: (doc: Document, node: YAMLMap, item: never) => void,
): void {
  if (editedItems.length === 0) {
    projectMap.delete(key);
    return;
  }
  const seqNode = projectMap.get(key, true);
  const orig: YAMLMap[] = isSeq(seqNode) ? seqNode.items.filter((n): n is YAMLMap => isMap(n)) : [];
  const items = editedItems.map((item) => {
    const node =
      typeof item._id === 'number' && orig[item._id]
        ? orig[item._id]
        : (doc.createNode(newItemShape(key, item)) as YAMLMap);
    syncItem(doc, node, item as never);
    return node;
  });
  if (isSeq(seqNode)) {
    seqNode.items = items;
  } else {
    insertPair(projectMap, doc.createPair(key, items), key, PROJECT_KEYS);
  }
}

/** The YAML shape for a brand-new list item, keys in canonical order, defaults omitted. */
function newItemShape(key: 'links' | 'assets', item: Stamped<Action> | Stamped<Asset>): Record<string, unknown> {
  if (key === 'links') {
    const l = item as Stamped<Action>;
    return { label: l.label, href: l.href };
  }
  const a = item as Stamped<Asset>;
  const shape: Record<string, unknown> = {};
  if (a.type && a.type !== 'image') shape.type = a.type;
  shape.src = a.src;
  shape.alt = a.alt;
  shape.orientation = a.orientation;
  if (a.poster) shape.poster = a.poster;
  return shape;
}

/** Insert `pair` so the map's keys keep their canonical relative order. */
function insertPair(map: YAMLMap, pair: Pair, key: string, keyOrder: string[]): void {
  const rank = keyOrder.indexOf(key);
  let at = map.items.length;
  for (let i = 0; i < map.items.length; i++) {
    const k = String((map.items[i].key as Scalar).value);
    const pos = keyOrder.indexOf(k);
    if (pos !== -1 && pos > rank) {
      at = i;
      break;
    }
  }
  map.items.splice(at, 0, pair);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tools/editor`
Expected: PASS, all describe blocks. The two no-op byte-identity tests are the canary: if either fails, diff actual vs expected output and fix `applyEdits` (NOT the test) until the round-trip is clean. Likely culprits if it happens: line folding (must be `lineWidth: 0`), seq indentation (the default `indentSeq: true` matches this file; do not change it), or a trailing-newline difference.

- [ ] **Step 5: Run the whole suite and types**

Run: `pnpm test && pnpm check`
Expected: PASS. `astro check` now type-checks `tools/editor/` too; fix any strictness complaints without weakening types.

- [ ] **Step 6: Commit**

```bash
git add tools/editor/apply-edits.ts tools/editor/apply-edits.test.ts
git commit -m "feat: comment-preserving apply-edits core for the work.yaml editor"
```

---

### Task 5: `server.ts`, the HTTP adapter

**Files:**
- Create: `tools/editor/server.ts`

Endpoints (all localhost-only): `GET /api/work`, `POST /api/save` (rev-checked, schema-validated before AND after applying), `POST /api/upload?slug&name`, `GET /` + `/editor.js` + `/editor.css` (editor UI), `GET /vendor/sortable.js` (from node_modules), any other GET served from the site's `public/`.

- [ ] **Step 1: Implement `tools/editor/server.ts`**

```ts
/**
 * The work.yaml editor's I/O adapter: a tiny localhost-only HTTP server.
 * Run with `pnpm edit` (plain `node`; Node >= 23.6 strips the types).
 *
 * All YAML manipulation lives in the pure `apply-edits.ts`; this file only
 * does HTTP, file reads/writes, and validation wiring. It is dev tooling:
 * nothing in `src/` imports it and it never ships in the production build.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { z } from 'zod';
import { WorkSchema } from '../../src/data/schema.ts';
import { applyEdits, stampIds, inferAssetDir } from './apply-edits.ts';
import type { EditedProject } from './apply-edits.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK_YAML = path.join(ROOT, 'src/data/work.yaml');
const SITE_PUBLIC = path.join(ROOT, 'public');
const EDITOR_PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const SORTABLE_JS = createRequire(import.meta.url).resolve('sortablejs/Sortable.min.js');
const HOST = '127.0.0.1';
const PORT = 4399;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const rev = (text: string) => createHash('sha1').update(text).digest('hex');

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const out = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(out);
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

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  if (req.method === 'GET' && url.pathname === '/api/work') {
    const { rev, projects } = await loadWork();
    json(res, 200, { rev, projects });
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
    WorkSchema.parse(payload.projects); // throws ZodError -> 400 below
    const next = applyEdits(text, payload.projects);
    WorkSchema.parse(parse(next)); // editor-bug guard: never write an invalid file
    await writeFile(WORK_YAML, next, 'utf8');
    const { rev: newRev, projects } = await loadWork();
    json(res, 200, { rev: newRev, projects });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/upload') {
    const slug = url.searchParams.get('slug') ?? '';
    const name = path.basename(url.searchParams.get('name') ?? '').replace(/[^\w.\-]+/g, '-');
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      json(res, 400, { error: `${name}: only png/jpg/jpeg/webp/gif can be added here (videos and embeds are added by hand in work.yaml)` });
      return;
    }
    const { projects } = await loadWork();
    const project = projects.find((p) => p.slug === slug);
    if (!project) {
      json(res, 404, { error: `unknown project slug: ${slug}` });
      return;
    }
    const dir = inferAssetDir(project);
    const destDir = path.join(SITE_PUBLIC, dir.slice(1));
    await mkdir(destDir, { recursive: true });
    const base = name.slice(0, -ext.length);
    let finalName = name;
    for (let n = 2; existsSync(path.join(destDir, finalName)); n++) finalName = `${base}-${n}${ext}`;
    await writeFile(path.join(destDir, finalName), await readBody(req));
    json(res, 200, { src: `${dir}/${finalName}` });
    return;
  }

  json(res, 404, { error: `no such endpoint: ${req.method} ${url.pathname}` });
}

async function serveStatic(res: http.ServerResponse, url: URL): Promise<void> {
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
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET') await serveStatic(res, url);
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
```

- [ ] **Step 2: Type-check**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 3: Smoke-test the API with curl**

```bash
pnpm edit &
sleep 1
curl -s http://127.0.0.1:4399/api/work | head -c 300; echo
REV=$(curl -s http://127.0.0.1:4399/api/work | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).rev))")
curl -s -X POST "http://127.0.0.1:4399/api/save" -H 'content-type: application/json' \
  -d "$(curl -s http://127.0.0.1:4399/api/work)" | head -c 120; echo
git diff --stat src/data/work.yaml
curl -s -X POST "http://127.0.0.1:4399/api/save" -H 'content-type: application/json' -d '{"rev":"stale","projects":[]}' ; echo
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4399/logos/tutor.png
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4399/vendor/sortable.js
kill %1
```

Expected: `/api/work` returns JSON starting `{"rev":"...","projects":[{"slug":"chord-colors"...`; the no-op save returns 200 JSON and `git diff --stat` shows NO changes to work.yaml; the stale-rev save returns the 409 error JSON; both static probes print `200`.

- [ ] **Step 4: Commit**

```bash
git add tools/editor/server.ts
git commit -m "feat: localhost HTTP adapter for the work.yaml editor"
```

---

### Task 6: The editor UI

**Files:**
- Create: `tools/editor/public/index.html`
- Create: `tools/editor/public/editor.css`
- Create: `tools/editor/public/editor.js`

Client behavior: full re-render after structural changes (reorder/add/delete/save/load); text inputs mutate state in place with NO re-render (so focus is never lost). SortableJS instances are destroyed and rebuilt on each render. File drops are distinguished from Sortable drags by `dataTransfer.types` containing `'Files'`.

- [ ] **Step 1: Create `tools/editor/public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>work.yaml editor</title>
  <link rel="stylesheet" href="/editor.css" />
</head>
<body>
  <header class="topbar">
    <h1>work.yaml editor</h1>
    <p id="status" class="status">loading...</p>
    <button id="save" type="button" disabled>Save</button>
  </header>
  <p class="hint">Drag the ⠿ handles to reorder projects and links. Drag thumbnails to reorder a gallery. Drop image files onto a gallery to add them. Cmd+S saves.</p>
  <div id="error" class="error" hidden></div>
  <main id="projects"></main>
  <script src="/vendor/sortable.js"></script>
  <script src="/editor.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `tools/editor/public/editor.css`**

```css
/* Editor chrome: quiet, light, hairline-separated, like the site it edits. */
:root {
  --ink: #111;
  --muted: #6b6b6b;
  --hair: #e4e4e4;
  --bg: #fafafa;
  --card: #fff;
  --accent: #0a5cff;
  --danger: #c92a2a;
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 0 24px 80px;
  max-width: 980px;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--ink);
  background: var(--bg);
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
  background: var(--bg);
  border-bottom: 1px solid var(--hair);
}
.topbar h1 { margin: 0; font-size: 16px; }
.status { margin: 0 0 0 auto; color: var(--muted); font-size: 12px; }
#save {
  padding: 7px 18px;
  border: 0;
  border-radius: 7px;
  background: var(--ink);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
#save:disabled { opacity: 0.35; cursor: default; }
#save.dirty { background: var(--accent); }
.hint { color: var(--muted); font-size: 12px; }
.error {
  padding: 10px 14px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  color: var(--danger);
  background: #fff5f5;
  white-space: pre-wrap;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.project {
  margin: 18px 0;
  padding: 16px 18px;
  background: var(--card);
  border: 1px solid var(--hair);
  border-radius: 12px;
}
.project-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.handle { cursor: grab; color: var(--muted); font-size: 16px; user-select: none; }
.project-head .slug { font-weight: 700; font-size: 15px; }
.project-head .device { color: var(--muted); font-size: 11px; border: 1px solid var(--hair); border-radius: 5px; padding: 1px 7px; }

.fields { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 14px; }
.field { display: flex; flex-direction: column; gap: 2px; }
.field.wide { grid-column: 1 / -1; }
.field label { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.field input {
  padding: 6px 9px;
  border: 1px solid var(--hair);
  border-radius: 7px;
  font: inherit;
  background: #fff;
}
.field input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }

h3.sect { margin: 16px 0 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.links { display: flex; flex-direction: column; gap: 6px; }
.link-row { display: flex; align-items: center; gap: 8px; }
.link-row input { flex: 1; padding: 5px 9px; border: 1px solid var(--hair); border-radius: 7px; font: inherit; }
.link-row input.label { flex: 0 0 170px; }
.icon-btn {
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 15px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 5px;
}
.icon-btn:hover { color: var(--danger); background: #f6f6f6; }
.add-btn {
  align-self: flex-start;
  margin-top: 6px;
  padding: 4px 12px;
  border: 1px solid var(--hair);
  border-radius: 7px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.add-btn:hover { border-color: var(--ink); }

.strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 10px;
  border: 1.5px dashed var(--hair);
  border-radius: 10px;
  min-height: 120px;
  align-items: flex-start;
}
.strip.dragover { border-color: var(--accent); background: #f3f7ff; }
.strip .empty { color: var(--muted); font-size: 12px; align-self: center; margin: 0 auto; }
.thumb { flex: 0 0 auto; width: 150px; cursor: grab; }
.thumb .pic { position: relative; }
.thumb img {
  width: 150px;
  height: 100px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--hair);
  display: block;
  background: #f1f1f1;
}
.thumb[data-orientation='portrait'] img { height: 200px; object-fit: cover; }
.thumb .badge {
  position: absolute;
  top: 5px;
  left: 5px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: rgba(17, 17, 17, 0.65);
  border-radius: 4px;
  padding: 1px 6px;
}
.thumb .del {
  position: absolute;
  top: 3px;
  right: 3px;
  border: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(17, 17, 17, 0.55);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.thumb .del:hover { background: var(--danger); }
.thumb input.alt {
  width: 100%;
  margin-top: 5px;
  padding: 4px 7px;
  border: 1px solid var(--hair);
  border-radius: 6px;
  font: inherit;
  font-size: 11px;
}
.thumb input.alt.missing { border-color: var(--danger); background: #fff5f5; }
.sortable-ghost { opacity: 0.35; }
```

- [ ] **Step 3: Create `tools/editor/public/editor.js`**

```js
/* The work.yaml editor client. Plain JS, no build step.
 *
 * State is the single source of truth; the DOM is rebuilt from it after every
 * STRUCTURAL change (reorder, add, delete, load, save). Text inputs write
 * straight into state with no re-render, so focus and caret never jump.
 * Sortable is global (loaded from /vendor/sortable.js). */
/* global Sortable */

const state = { projects: [], rev: null, dirty: false };
let sortables = [];

const $ = (sel, el = document) => el.querySelector(sel);
const projectsEl = $('#projects');
const saveBtn = $('#save');
const statusEl = $('#status');
const errorEl = $('#error');

// Mirrors work.ts youtubeId/youtubePoster (the editor page cannot import TS modules).
const youtubeId = (src) => {
  const m = src.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|v\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : src.trim();
};
const thumbSrc = (a) => a.poster ?? (a.type === 'youtube' ? `https://i.ytimg.com/vi/${youtubeId(a.src)}/mqdefault.jpg` : a.src);

const defaultOrientation = (p) => {
  const counts = { portrait: 0, landscape: 0 };
  for (const a of p.assets) counts[a.orientation]++;
  if (counts.portrait !== counts.landscape) return counts.portrait > counts.landscape ? 'portrait' : 'landscape';
  if (p.assets.length > 0) return p.assets[0].orientation;
  return p.device === 'iphone' ? 'portrait' : 'landscape';
};

function setStatus(text) { statusEl.textContent = text; }
function showError(message) { errorEl.hidden = !message; errorEl.textContent = message || ''; }
function markDirty() {
  state.dirty = true;
  saveBtn.disabled = false;
  saveBtn.classList.add('dirty');
  setStatus('unsaved changes');
}
function markClean(verb) {
  state.dirty = false;
  saveBtn.disabled = true;
  saveBtn.classList.remove('dirty');
  setStatus(`${verb} at ${new Date().toLocaleTimeString()}`);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function textField(obj, key, label, wide) {
  const input = el('input', { type: 'text', value: obj[key] ?? '' });
  input.addEventListener('input', () => { obj[key] = input.value; markDirty(); });
  return el('div', { class: `field${wide ? ' wide' : ''}` }, el('label', {}, label), input);
}

function renderLinks(p) {
  const list = el('div', { class: 'links' });
  for (const [i, link] of p.links.entries()) {
    const label = el('input', { class: 'label', type: 'text', value: link.label, placeholder: 'label' });
    label.addEventListener('input', () => { link.label = label.value; markDirty(); });
    const href = el('input', { type: 'text', value: link.href, placeholder: 'https://... or /page' });
    href.addEventListener('input', () => { link.href = href.value; markDirty(); });
    list.append(el('div', { class: 'link-row' },
      el('span', { class: 'handle' }, '⠿'), label, href,
      el('button', { class: 'icon-btn', type: 'button', title: 'remove link',
        onclick: () => { p.links.splice(i, 1); markDirty(); render(); } }, '✕'),
    ));
  }
  return list;
}

function renderAssets(p) {
  const strip = el('div', { class: 'strip' });
  if (p.assets.length === 0) strip.append(el('p', { class: 'empty' }, 'no images yet. drop files here'));
  for (const [i, a] of p.assets.entries()) {
    const alt = el('input', { class: `alt${a.alt ? '' : ' missing'}`, type: 'text', value: a.alt, placeholder: 'alt text (required)' });
    alt.addEventListener('input', () => { a.alt = alt.value; alt.classList.toggle('missing', !alt.value); markDirty(); });
    const pic = el('div', { class: 'pic' },
      el('img', { src: thumbSrc(a), alt: '', draggable: 'false' }),
      el('button', { class: 'del', type: 'button', title: 'remove from gallery (file stays in public/)',
        onclick: () => { p.assets.splice(i, 1); markDirty(); render(); } }, '✕'),
    );
    if (a.type !== 'image') pic.append(el('span', { class: 'badge' }, a.type));
    strip.append(el('div', { class: 'thumb', 'data-orientation': a.orientation }, pic, alt));
  }
  strip.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    strip.classList.add('dragover');
  });
  strip.addEventListener('dragleave', () => strip.classList.remove('dragover'));
  strip.addEventListener('drop', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    strip.classList.remove('dragover');
    uploadFiles(p, [...e.dataTransfer.files]);
  });
  return strip;
}

function render() {
  for (const s of sortables) s.destroy();
  sortables = [];
  projectsEl.replaceChildren();

  for (const p of state.projects) {
    const links = renderLinks(p);
    const strip = renderAssets(p);
    const card = el('section', { class: 'project', 'data-slug': p.slug },
      el('div', { class: 'project-head' },
        el('span', { class: 'handle project-handle' }, '⠿'),
        el('span', { class: 'slug' }, p.slug),
        el('span', { class: 'device' }, p.device),
      ),
      el('div', { class: 'fields' },
        textField(p, 'cardTitle', 'card title'),
        textField(p, 'title', 'page title'),
        textField(p, 'subtitle', 'subtitle'),
        textField(p, 'date', 'date (optional, e.g. 2018-present)'),
        textField(p, 'role', 'role', true),
        textField(p, 'cardDesc', 'card description', true),
        textField(p, 'blurb', 'blurb', true),
      ),
      el('h3', { class: 'sect' }, 'links'),
      links,
      el('button', { class: 'add-btn', type: 'button',
        onclick: () => { p.links.push({ label: '', href: '' }); markDirty(); render(); } }, '+ add link'),
      el('h3', { class: 'sect' }, 'gallery'),
      strip,
    );
    projectsEl.append(card);

    sortables.push(new Sortable(links, {
      animation: 150,
      handle: '.handle',
      onEnd: ({ oldIndex, newIndex }) => {
        p.links.splice(newIndex, 0, p.links.splice(oldIndex, 1)[0]);
        markDirty();
        render();
      },
    }));
    sortables.push(new Sortable(strip, {
      animation: 150,
      draggable: '.thumb',
      filter: 'input,button',
      preventOnFilter: false,
      onEnd: ({ oldIndex, newIndex }) => {
        p.assets.splice(newIndex, 0, p.assets.splice(oldIndex, 1)[0]);
        markDirty();
        render();
      },
    }));
  }

  sortables.push(new Sortable(projectsEl, {
    animation: 150,
    handle: '.project-handle',
    onEnd: ({ oldIndex, newIndex }) => {
      state.projects.splice(newIndex, 0, state.projects.splice(oldIndex, 1)[0]);
      markDirty();
      render();
    },
  }));
}

async function uploadFiles(p, files) {
  for (const file of files) {
    const res = await fetch(`/api/upload?slug=${encodeURIComponent(p.slug)}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error); continue; }
    p.assets.push({
      type: /\.gif$/i.test(file.name) ? 'gif' : 'image',
      src: data.src,
      alt: '',
      orientation: defaultOrientation(p),
    });
    markDirty();
  }
  render();
}

async function load() {
  const res = await fetch('/api/work');
  const data = await res.json();
  if (!res.ok) { showError(data.error); return; }
  state.projects = data.projects;
  state.rev = data.rev;
  showError('');
  markClean('loaded');
  render();
}

async function save() {
  if (!state.dirty) return;
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rev: state.rev, projects: state.projects }),
  });
  const data = await res.json();
  if (!res.ok) {
    showError(data.error + (res.status === 409 ? '\n(reload the page to pick up the on-disk version)' : ''));
    return;
  }
  // Fresh server state: _ids are re-stamped against the file just written.
  state.projects = data.projects;
  state.rev = data.rev;
  showError('');
  markClean('saved');
  render();
}

saveBtn.addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

load();
```

- [ ] **Step 4: Manual verification checklist**

Run `pnpm edit`, open `http://127.0.0.1:4399`, and verify each:

1. All 7 projects render with their fields, links, and gallery thumbnails (symphony shows a youtube badge + derived thumbnail and a gif badge).
2. Edit chord-colors' subtitle, press Cmd+S, then run `git diff src/data/work.yaml`: the diff is ONLY the subtitle line; the header comment, the capture NOTE, and the TODO comments are all intact.
3. Drag a project to a new position, save, check `git diff`: blocks moved wholesale, comments traveled with them. Then drag it back and save (diff returns to just the subtitle edit).
4. Drag-reorder symphony's gallery; drag-reorder openpath's two links; save; verify the YAML matches.
5. Drop a PNG onto tutor's gallery: file appears under `public/tutor/screenshots/`, a thumb appears with a red empty-alt input; type an alt; save; verify the YAML entry.
6. Add a link, leave it empty, save (schema allows empty strings); remove it; save.
7. With `pnpm dev` running in another tab, make an edit + save and watch the homepage hot-reload.
8. Revert all experimental content edits when done: `git checkout src/data/work.yaml` and delete the dropped test image, e.g. `rm public/tutor/screenshots/<dropped-file>.png` (check `git status`).

- [ ] **Step 5: Commit**

```bash
git add tools/editor/public
git commit -m "feat: work.yaml editor UI (drag-reorder, drop-to-add images, inline text editing)"
```

---

### Task 7: Docs + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document `pnpm edit` in CLAUDE.md**

In the Commands list, after the `pnpm dev` line, add:

```markdown
- `pnpm edit` local visual editor for `work.yaml` (http://127.0.0.1:4399): drag-reorder projects/images/links, drop image files to add them, edit text fields. Dev-only (`tools/editor/`), never ships.
```

In the "Editing the projects" section, after the first bullet, add:

```markdown
- Prefer a GUI? `pnpm edit` serves a local drag-and-drop editor for the same
  file. It preserves the YAML comments and writes through the same Zod schema.
```

- [ ] **Step 2: Full verification**

Run: `pnpm test && pnpm check && pnpm build`
Expected: all pass.

Run: `grep -ril "editor" dist/ | grep -v ".map" || echo "CLEAN"`
Expected: `CLEAN` (or only unrelated matches like the word "editor" in prose; verify any hit is not from `tools/`). Also confirm: `ls dist | head` shows the normal site output.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document pnpm edit"
```
