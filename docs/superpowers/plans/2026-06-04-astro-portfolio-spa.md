# Astro Portfolio SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `prototypes/chord-hover.html` portfolio to an Astro site with bookmarkable per-project URLs (`/work/<slug>/`), SPA-style navigation, the WebGL ripple kept for Chord Colors and fade+slide elsewhere, plus the `/tutor` and `/forge` marketing pages converted to Astro.

**Architecture:** Static Astro site at the repo root. Pages are pre-rendered (real URLs, refresh/Back safe). `<ClientRouter/>` gives no-flash client navigation. A typed data file plus per-project body components built from a small set of reusable content primitives. Custom transitions hook the View Transitions lifecycle; a persisted canvas runs the Chord Colors ripple. GitHub Actions builds and deploys to Pages; existing static content is served verbatim from `public/`.

**Tech Stack:** Astro 5 (static output, `astro:transitions`), TypeScript (strict), Vitest (data-layer tests), pnpm, GitHub Actions + GitHub Pages. WebGL (ported from the prototype) for the ripple.

**Spec:** `docs/superpowers/specs/2026-06-04-astro-portfolio-spa-design.md`

**Source of truth for verbatim markup/styles/shaders:** `prototypes/chord-hover.html` (referred to below as "the prototype"). Line numbers are approximate; search by the quoted anchor strings.

**Working branch:** `astro-migration` (already created). Commit every task. Do NOT merge to `master` until Phase 5.

**Assumption to confirm at start:** package manager is `pnpm` (matches the user's tooling). If wrong, substitute `npm`/`yarn` in every command.

---

## File structure (decomposition)

```
package.json                       # scripts + deps
astro.config.mjs                   # site: https://rossmiller.dev
tsconfig.json
.github/workflows/deploy.yml       # build + deploy to Pages (triggers on master)
src/
  styles/global.css                # design tokens + base (from prototype :root + body)
  layouts/PortfolioLayout.astro    # shell: BaseHead + ClientRouter + RippleCanvas + slot
  components/
    BaseHead.astro                 # <head> meta/SEO/fonts/favicon (shared by ALL pages)
    RippleCanvas.astro             # persisted <canvas> + loads scripts/ripple.ts
    WorkCard.astro                 # home deep-dive card
    Thumb.astro                    # card thumbnail (image-icon vs CSS-mark variants)
    BackLink.astro                 # "<- Ross Miller" crumb
    MarketingButton.astro          # top-right marketing-site link (data-astro-reload)
    content/                       # reusable case-study primitives
      Section.astro Lede.astro Stats.astro Stat.astro
      PhoneFrame.astro DesktopFrame.astro Screen.astro Caption.astro
      Footnotes.astro Ref.astro StackTrailer.astro
      TryIt.astro ResetButton.astro ColorWheel.astro
    work/                          # one body per project (composition of primitives)
      ChordColors.astro Tutor.astro Forge.astro Symphony.astro
      Openpath.astro Sms.astro Vivy.astro
  data/work.ts                     # typed project list (single source of truth)
  data/work.test.ts                # Vitest data-integrity tests
  scripts/ripple.ts                # WebGL ripple + transition controller
  pages/
    index.astro                    # home (/)
    work/[slug].astro              # /work/<slug>/
    tutor/index.astro              # /tutor/  (converted marketing page)
    forge/index.astro              # /forge/  (converted marketing page)
public/
  CNAME robots.txt sitemap.xml llms.txt profile.png profile.webp
  fonts/ games/                    # unchanged static content
  logos/ phone.png                 # portfolio assets (from prototypes/logos, prototypes/phone.png)
  tutor/screenshots/* forge/screenshots/*
  prototypes/                      # kept for reference
```

---

# PHASE 0: Astro scaffold + static content + deploy pipeline

End state: `pnpm build` produces a `dist/` that serves all the existing static content (CNAME, games, assets) plus an empty placeholder home, with a working deploy workflow (not yet triggered).

### Task 0.1: Initialize the Astro project

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "rossmiller-dev",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Install Astro + tooling**

Run: `pnpm add astro && pnpm add -D vitest @astrojs/check typescript`
Expected: dependencies install; `package.json` now lists `astro` under dependencies and `vitest`, `@astrojs/check`, `typescript` under devDependencies. A `pnpm-lock.yaml` appears.

- [ ] **Step 3: Create `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';

// Static output (default). Custom-domain root site, so no `base` path.
export default defineConfig({
  site: 'https://rossmiller.dev',
});
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 5: Append build artifacts to `.gitignore`**

Add these lines to `.gitignore` (read it first; keep existing contents):

```
node_modules/
dist/
.astro/
```

- [ ] **Step 6: Create a temporary placeholder page so the build has something**

Create `src/pages/index.astro`:

```astro
<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>placeholder</title></head>
<body>scaffold ok</body></html>
```

- [ ] **Step 7: Verify the build works**

Run: `pnpm build`
Expected: build succeeds; `dist/index.html` exists and contains `scaffold ok`.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml astro.config.mjs tsconfig.json .gitignore src/pages/index.astro
git commit -m "chore: scaffold Astro project"
```

### Task 0.2: Move existing static content into `public/`

Astro copies `public/` verbatim into `dist/`. Everything that must keep its current URL goes here. This runs on the `astro-migration` branch only, so `master`'s live deploy is unaffected until merge.

**Files:**
- Move (via `git mv`): `CNAME`, `robots.txt`, `sitemap.xml`, `llms.txt`, `profile.png`, `profile.webp`, `fonts/`, `games/` into `public/`
- Copy: `prototypes/logos/` -> `public/logos/`, `prototypes/phone.png` -> `public/phone.png`
- Copy: the whole `prototypes/` tree -> `public/prototypes/` (kept for reference)

- [ ] **Step 1: Create `public/` and move static files**

```bash
mkdir -p public
git mv CNAME robots.txt sitemap.xml llms.txt profile.png profile.webp public/
git mv fonts public/fonts
git mv games public/games
```

- [ ] **Step 2: Copy portfolio assets the components will reference**

```bash
mkdir -p public/logos
cp prototypes/logos/*.jpg public/logos/
cp prototypes/phone.png public/phone.png
```

- [ ] **Step 3: Copy the prototype tree for reference**

```bash
mkdir -p public/prototypes
cp -R prototypes/ public/prototypes/
```

- [ ] **Step 4: Verify the build copies everything**

Run: `pnpm build`
Then verify each path exists in `dist/`:
Run: `ls dist/CNAME dist/games dist/fonts dist/logos/chord-colors.jpg dist/phone.png dist/robots.txt`
Expected: all listed without error. `dist/CNAME` contains `rossmiller.dev`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: move existing static content into public/"
```

### Task 0.3: Design tokens + base styles

**Files:**
- Create: `src/styles/global.css`

- [ ] **Step 1: Create `src/styles/global.css`** by porting the prototype's `:root` block (search anchor `--bg: #ffffff;`, ~lines 10-20), the `* { box-sizing }` / `html` / `body` base (anchor `-webkit-font-smoothing`), and the shared link-underline style (anchor `.bio a {`). Use this exact token set, then append the base rules from the prototype:

```css
:root {
  --bg: #ffffff;
  --ink: rgb(17, 17, 17);
  --muted: rgb(120, 120, 120);
  --hair: rgba(17, 17, 17, 0.10);
  --hairHigh: rgba(17, 17, 17, 0.30);
  --container: 706px;
  /* ripple runtime vars (used in Phase 3) */
  --cx: 50%;
  --cy: 50%;
  --r: 0px;
}
* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 14px;
  font-weight: 460;
  line-height: 20px;
  letter-spacing: -0.09px;
}
@supports (font-variation-settings: normal) {
  body { font-family: "Inter var", ui-sans-serif, system-ui, -apple-system, sans-serif; }
}
.container { max-width: var(--container); margin: 0 auto; padding: 80px 24px 96px; }
```

Note: the prototype set `body { overflow: hidden }` for its single-page app. In the multi-page site the body scrolls normally, so do NOT copy `overflow: hidden`.

- [ ] **Step 2: Verify** `pnpm build` still succeeds (global.css is imported in Task 0.4; build now just must not error).

Run: `pnpm build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "feat: add design tokens and base styles"
```

### Task 0.4: BaseHead + PortfolioLayout

**Files:**
- Create: `src/components/BaseHead.astro`, `src/layouts/PortfolioLayout.astro`
- Replace: `src/pages/index.astro` (use the layout, still placeholder content)

- [ ] **Step 1: Create `src/components/BaseHead.astro`**

```astro
---
interface Props { title: string; description?: string; }
const { title, description = "Ross Miller, software engineer and serial founder." } = Astro.props;
const canonical = new URL(Astro.url.pathname, Astro.site);
---
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
<meta name="description" content={description} />
<link rel="canonical" href={canonical} />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:type" content="website" />
<!-- Inter from rsms.me, same as the prototype -->
<link rel="preconnect" href="https://rsms.me/" />
<link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
```

- [ ] **Step 2: Create `src/layouts/PortfolioLayout.astro`** (RippleCanvas is added in Phase 3; omit it for now)

```astro
---
import BaseHead from '../components/BaseHead.astro';
import { ClientRouter } from 'astro:transitions';
import '../styles/global.css';
interface Props { title: string; description?: string; }
const { title, description } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <BaseHead title={title} description={description} />
    <ClientRouter />
  </head>
  <body>
    <slot />
  </body>
</html>
```

- [ ] **Step 3: Replace `src/pages/index.astro`**

```astro
---
import PortfolioLayout from '../layouts/PortfolioLayout.astro';
---
<PortfolioLayout title="Ross Miller">
  <div class="container">scaffold ok</div>
</PortfolioLayout>
```

- [ ] **Step 4: Verify**

Run: `pnpm build`
Expected: success; `dist/index.html` contains `<title>Ross Miller</title>`, the rsms.me stylesheet link, and `scaffold ok`.

- [ ] **Step 5: Commit**

```bash
git add src/components/BaseHead.astro src/layouts/PortfolioLayout.astro src/pages/index.astro
git commit -m "feat: add BaseHead and PortfolioLayout"
```

### Task 0.5: Deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [master]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: withastro/action@v3   # detects pnpm, runs build, uploads dist as the Pages artifact
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Verify YAML is well-formed**

Run: `pnpm dlx js-yaml .github/workflows/deploy.yml >/dev/null && echo OK`
Expected: `OK` (no parse error). If `js-yaml` is unavailable, visually confirm indentation.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions build-and-deploy workflow"
```

Note: this workflow only runs on push to `master`. It stays dormant on the `astro-migration` branch. The Pages source toggle (Settings -> Pages -> Source -> GitHub Actions) is a manual step done in Phase 5.

---

# PHASE 1: Data + home + work pages (plain fade)

End state: every route renders real content; bookmarking, refresh, and Back all work (with ClientRouter's default fade).

### Task 1.1: Project data + integrity tests (TDD)

**Files:**
- Create: `src/data/work.ts`, `src/data/work.test.ts`

- [ ] **Step 1: Write the failing test** `src/data/work.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { WORK, getWork, getProject } from './work';

describe('work data', () => {
  it('has the 7 projects in order', () => {
    expect(getWork().map(w => w.slug)).toEqual([
      'chord-colors', 'tutor', 'forge', 'symphony', 'openpath', 'sms', 'vivy',
    ]);
  });
  it('has unique slugs', () => {
    const slugs = WORK.map(w => w.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it('every project has required card fields', () => {
    for (const w of WORK) {
      expect(w.title, w.slug).toBeTruthy();
      expect(w.cardTitle, w.slug).toBeTruthy();
      expect(w.cardDesc, w.slug).toBeTruthy();
      expect(w.thumbClass, w.slug).toBeTruthy();
    }
  });
  it('only chord-colors uses the ripple, and it carries ripple config', () => {
    for (const w of WORK) {
      if (w.slug === 'chord-colors') {
        expect(w.transition).toBe('ripple');
        expect(w.ripple).toBeDefined();
      } else {
        expect(w.transition).toBe('fade-slide');
      }
    }
  });
  it('marketingUrl is set only for tutor and forge', () => {
    const withMarketing = WORK.filter(w => w.marketingUrl).map(w => w.slug).sort();
    expect(withMarketing).toEqual(['forge', 'tutor']);
    expect(getProject('tutor')?.marketingUrl).toBe('/tutor');
    expect(getProject('forge')?.marketingUrl).toBe('/forge');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test src/data/work.test.ts`
Expected: FAIL (cannot resolve `./work`).

- [ ] **Step 3: Implement `src/data/work.ts`**

Pull the per-project `title`/`role` and ripple params from the prototype's `VARIANTS` object (anchor `const VARIANTS = {`) and the card `cardTitle`/`cardDesc`/`thumbClass` from the home list (anchor `<ul class="deep-dives">`). The ripple numbers below come from the prototype's `controls` defaults (anchor `const controls = {`) plus `VARIANTS['chord-colors']`.

```ts
export type Transition = 'ripple' | 'fade-slide';

export interface RippleConfig {
  mode: number;            // shader mode (0 = chord colors)
  color1?: [number, number, number];
  color2?: [number, number, number];
  durationMs: number;      // clip animation duration (prototype controls.duration)
  band: number;            // 0..1 (prototype controls.band/100)
  period: number;          // 0..1 (prototype controls.period/100)
  sat: number;             // 0..1 (prototype controls.saturation/100)
  light: number;           // 0..1 (prototype controls.lightness/100)
  easeIn: number;          // 0..100 (prototype controls.easeIn)
  easeOut: number;         // 0..100 (prototype controls.easeOut)
}

export interface Project {
  slug: string;
  order: number;
  title: string;
  role: string;
  cardTitle: string;
  cardDesc: string;
  thumbClass: string;       // e.g. "thumb-chord" (drives Thumb.astro variant)
  thumbImage?: string;      // e.g. "/logos/chord-colors.jpg" when the thumb is an image icon
  transition: Transition;
  marketingUrl?: string;
  marketingLabel?: string;
  ripple?: RippleConfig;
}

export const WORK: Project[] = [
  {
    slug: 'chord-colors', order: 0, title: 'Chord Colors', role: 'Creator',
    cardTitle: 'Chord Colors',
    cardDesc: 'Music theory as a color system. 12 notes, 113 chords, 148 scales.',
    thumbClass: 'thumb-chord', thumbImage: '/logos/chord-colors.jpg',
    transition: 'ripple',
    ripple: { mode: 0, durationMs: 900, band: 0.52, period: 0.77, sat: 1.0, light: 0.97, easeIn: 84, easeOut: 53 },
  },
  {
    slug: 'tutor', order: 1, title: 'Tutor', role: 'Creator',
    cardTitle: 'Tutor',
    cardDesc: 'AI writes a custom book on any subject. Asks, answers, and tests as you read.',
    thumbClass: 'thumb-tutor',
    transition: 'fade-slide', marketingUrl: '/tutor', marketingLabel: 'Visit Tutor',
  },
  {
    slug: 'forge', order: 2, title: 'Forge', role: 'Creator',
    cardTitle: 'Forge',
    cardDesc: 'Native macOS terminal for running many AI coding agents in parallel.',
    thumbClass: 'thumb-forge',
    transition: 'fade-slide', marketingUrl: '/forge', marketingLabel: 'Visit Forge',
  },
  {
    slug: 'symphony', order: 3, title: 'Symphony Pro', role: 'Founder, Developer, Designer',
    cardTitle: 'Symphony Pro',
    cardDesc: "World's first iPad sheet music notation app. Apple Spotlighted.",
    thumbClass: 'thumb-symphony', thumbImage: '/logos/symphony.jpg',
    transition: 'fade-slide',
  },
  {
    slug: 'openpath', order: 4, title: 'Openpath Security', role: 'Software Engineering Manager, #2 Employee',
    cardTitle: 'Openpath Security',
    cardDesc: 'Access control at scale. Millions of door unlocks per day. Acquired by Motorola Solutions.',
    thumbClass: 'thumb-openpath',
    transition: 'fade-slide',
  },
  {
    slug: 'sms', order: 5, title: 'SMS ordering', role: 'Founder, CTO',
    cardTitle: 'SMS ordering',
    cardDesc: 'SMS food and drink ordering at music festivals and stadium events.',
    thumbClass: 'thumb-sms',
    transition: 'fade-slide',
  },
  {
    slug: 'vivy', order: 6, title: 'Vivy', role: 'Founder, CTO & Sole Engineer',
    cardTitle: 'Vivy',
    cardDesc: '#1 doctor-led GLP-1 companion app on the App Store.',
    thumbClass: 'thumb-vivy', thumbImage: '/logos/vivy.jpg',
    transition: 'fade-slide',
  },
];

export const getWork = (): Project[] => [...WORK].sort((a, b) => a.order - b.order);
export const getProject = (slug: string): Project | undefined => WORK.find(w => w.slug === slug);
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test src/data/work.test.ts`
Expected: PASS (all 5 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/data/work.ts src/data/work.test.ts
git commit -m "feat: add typed project data with integrity tests"
```

### Task 1.2: Thumb + WorkCard

**Files:**
- Create: `src/components/Thumb.astro`, `src/components/WorkCard.astro`

Port the thumbnail styles (`.thumb`, `.thumb-icon`, and every `.thumb-*` variant: chord/vivy/symphony/tutor/forge/openpath/sms) from the prototype (anchor `.thumb {`) into `Thumb.astro`'s scoped `<style>`. Port `.deep-dive`, `.dd-meta`, `.dd-title`, `.dd-desc` (anchor `.deep-dive {`) into `WorkCard.astro`'s scoped `<style>`.

- [ ] **Step 1: Create `src/components/Thumb.astro`**

```astro
---
interface Props { thumbClass: string; image?: string; }
const { thumbClass, image } = Astro.props;
---
<div class:list={["thumb", thumbClass]}>
  {image && <img class="thumb-icon" src={image} alt="" loading="lazy" />}
</div>
<style>
  /* PORT: `.thumb`, `.thumb-icon`, and all `.thumb-*` variant rules from the prototype <style>. */
</style>
```

- [ ] **Step 2: Create `src/components/WorkCard.astro`**

```astro
---
import Thumb from './Thumb.astro';
import type { Project } from '../data/work';
interface Props { project: Project; }
const { project } = Astro.props;
const isRipple = project.transition === 'ripple';
---
<a
  class="deep-dive"
  href={`/work/${project.slug}/`}
  data-slug={project.slug}
  data-transition={project.transition}
  data-astro-history={isRipple ? undefined : undefined}
>
  <Thumb thumbClass={project.thumbClass} image={project.thumbImage} />
  <div class="dd-meta">
    <p class="dd-title">{project.cardTitle}</p>
    <p class="dd-desc">{project.cardDesc}</p>
  </div>
</a>
<style>
  /* PORT: `.deep-dive`, `.deep-dive:hover`, `.dd-meta`, `.dd-title`, `.dd-desc` from the prototype. */
</style>
```

(The `data-slug`/`data-transition` attributes are read by the ripple controller in Phase 3. Leave the `data-astro-history` line as-is; it is a no-op placeholder kept so Phase 3 only edits the script, not this file.)

- [ ] **Step 3: Verify** the components compile by referencing them from the home page in Task 1.3. For now:

Run: `pnpm build`
Expected: success (unused components do not break the build).

- [ ] **Step 4: Commit**

```bash
git add src/components/Thumb.astro src/components/WorkCard.astro
git commit -m "feat: add Thumb and WorkCard components"
```

### Task 1.3: Home page

**Files:**
- Replace: `src/pages/index.astro`

Port the bio and "My work" markup from the prototype (anchor `<div class="page page-home"`, the `.bio`, `h2.home-section-h`, and the closing "Now:" paragraph). Replace the hand-written `<ul class="deep-dives">` with a map over `getWork()`.

- [ ] **Step 1: Replace `src/pages/index.astro`**

```astro
---
import PortfolioLayout from '../layouts/PortfolioLayout.astro';
import WorkCard from '../components/WorkCard.astro';
import { getWork } from '../data/work';
const work = getWork();
---
<PortfolioLayout title="Ross Miller">
  <div class="container">
    <h1 class="name">Ross Miller</h1>
    <p class="updated">Updated June 3, 2026</p>
    <div class="bio">
      <!-- PORT: the two <p> bio paragraphs verbatim from the prototype `.bio`. -->
    </div>
    <h2 class="home-section-h">My work</h2>
    <ul class="deep-dives">
      {work.map((p) => <li><WorkCard project={p} /></li>)}
    </ul>
    <p class="now-line">Now: building Forge and pushing Chord Colors v2</p>
  </div>
</PortfolioLayout>
<style>
  /* PORT: `h1.name`, `.updated`, `.bio p`, `.bio a`, `h2.home-section-h`,
     `.deep-dives`, `.deep-dives li:first-child .deep-dive`, and `.now-line` (the
     "Now:" paragraph styling) from the prototype. */
</style>
```

- [ ] **Step 2: Verify content + links**

Run: `pnpm build`
Then: `grep -c 'href="/work/' dist/index.html`
Expected: `7` (one link per project).
Then: `grep -o 'Chord Colors' dist/index.html | head -1`
Expected: `Chord Colors`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: build home page from project data"
```

### Task 1.4: Content primitives, part 1 (layout blocks)

**Files:**
- Create: `src/components/content/Section.astro`, `Lede.astro`, `Stats.astro`, `Stat.astro`, `Caption.astro`

Port the matching styles from the prototype: `Section` <- `h2.dive-h` + `h2.dive-h::after` (anchor `h2.dive-h {`); `Lede` <- `.case-lede`; `Stats`/`Stat` <- `.case-stats`, `.case-stat-num`, `.case-stat-lbl`; `Caption` <- `.feature-caption`.

- [ ] **Step 1: Create `Section.astro`**

```astro
---
interface Props { title: string; }
const { title } = Astro.props;
---
<section class="dive-section">
  <h2 class="dive-h">{title}</h2>
  <slot />
</section>
<style>
  /* PORT: `h2.dive-h { ... }` and `h2.dive-h::after { ... }` from the prototype. */
</style>
```

- [ ] **Step 2: Create `Lede.astro`**

```astro
---
---
<p class="case-lede"><slot /></p>
<style>/* PORT: `.case-lede` (and `.case-lede a` link style) from the prototype. */</style>
```

- [ ] **Step 3: Create `Stat.astro` and `Stats.astro`**

```astro
---
// Stat.astro
interface Props { num: string; label: string; }
const { num, label } = Astro.props;
---
<div class="case-stat"><div class="case-stat-num">{num}</div><div class="case-stat-lbl">{label}</div></div>
<style>/* PORT: `.case-stat-num`, `.case-stat-lbl` from the prototype. */</style>
```

```astro
---
// Stats.astro
---
<div class="case-stats"><slot /></div>
<style>/* PORT: `.case-stats` grid from the prototype. */</style>
```

- [ ] **Step 4: Create `Caption.astro`**

```astro
---
---
<p class="feature-caption"><slot /></p>
<style>/* PORT: `.feature-caption` (and its `a` link style) from the prototype. */</style>
```

- [ ] **Step 5: Verify** `pnpm build` succeeds. Commit.

```bash
git add src/components/content/Section.astro src/components/content/Lede.astro src/components/content/Stats.astro src/components/content/Stat.astro src/components/content/Caption.astro
git commit -m "feat: add Section/Lede/Stats/Stat/Caption primitives"
```

### Task 1.5: Content primitives, part 2 (media frames + screen)

**Files:**
- Create: `src/components/content/PhoneFrame.astro`, `DesktopFrame.astro`, `Screen.astro`

Port: `PhoneFrame` <- `.phone-demo`, `.phone-frame`, `.phone-img` and the CSS-only frame rules (anchor `.phone-demo {`); `DesktopFrame` <- `.desktop-demo`, `.desktop-screen`, `.desktop-screen::before/::after` (anchor `.desktop-demo {`); `Screen` <- the themed `.phone-screen.*` and `.desktop-screen.*` gradient placeholder rules (anchor `.phone-screen.color-system` etc.) plus the `::after` `data-label` behavior.

- [ ] **Step 1: Create `Screen.astro`** (the themed placeholder dropped into a frame; replaced by a `<slot>` child when real media exists)

```astro
---
interface Props { theme: string; label?: string; kind?: 'phone' | 'desktop'; }
const { theme, label, kind = 'phone' } = Astro.props;
const base = kind === 'desktop' ? 'desktop-screen' : 'phone-screen';
---
<div class:list={[base, theme]} data-label={label}><slot /></div>
<style is:global>
  /* PORT: all themed `.phone-screen.<name>` and `.desktop-screen.<name>` gradient
     rules + the `.phone-screen::after` / `.desktop-screen::after` data-label rules
     from the prototype. is:global because the class is composed by callers. */
</style>
```

- [ ] **Step 2: Create `PhoneFrame.astro`**

```astro
---
interface Props { variant?: 'static' | 'embedded'; }
const { variant = 'static' } = Astro.props;
---
<div class:list={["phone-demo", variant === 'embedded' && 'embedded']}>
  <div class="phone-frame">
    <slot />
    {variant === 'static' && <img class="phone-img" src="/phone.png" alt="" />}
  </div>
</div>
<style>/* PORT: `.phone-demo`, `.phone-frame`, `.phone-img`, and the `.phone-demo.embedded` frame rules. */</style>
```

- [ ] **Step 3: Create `DesktopFrame.astro`**

```astro
---
---
<div class="desktop-demo"><slot /></div>
<style>/* PORT: `.desktop-demo` and `.desktop-screen` base rules (themes live in Screen.astro). */</style>
```

- [ ] **Step 4: Verify** `pnpm build`. Commit.

```bash
git add src/components/content/PhoneFrame.astro src/components/content/DesktopFrame.astro src/components/content/Screen.astro
git commit -m "feat: add PhoneFrame/DesktopFrame/Screen primitives"
```

### Task 1.6: Content primitives, part 3 (specials)

**Files:**
- Create: `src/components/content/StackTrailer.astro`, `Footnotes.astro`, `Ref.astro`, `ResetButton.astro`, `TryIt.astro`, `ColorWheel.astro`

- [ ] **Step 1: `StackTrailer.astro`** (port `.stack-trailer`)

```astro
---
interface Props { items: string[]; }
const { items } = Astro.props;
---
<p class="stack-trailer">{items.join(' · ')}</p>
<style>/* PORT: `.stack-trailer` from the prototype. */</style>
```

- [ ] **Step 2: `Footnotes.astro` + `Ref.astro`** (port `.footnotes-list`, `.case-body sup a`)

```astro
---
// Ref.astro  -> inline superscript reference
interface Props { id: string; n: number; }
const { id, n } = Astro.props;
---
<sup><a href={`#${id}`}>{n}</a></sup>
<style is:global>/* PORT: `.case-body sup a` and `:hover` from the prototype. */</style>
```

```astro
---
// Footnotes.astro -> the ordered list at the bottom of a case study
---
<ol class="footnotes-list"><slot /></ol>
<style>/* PORT: `.footnotes-list` and `.footnotes-list li` from the prototype. */</style>
```

- [ ] **Step 3: `ResetButton.astro`** (port `.sim-reset` + the `resetSim` logic from the prototype, anchor `function resetSim(button)`)

```astro
---
---
<button class="sim-reset" type="button" aria-label="Reset simulator" title="Reset">&#8635;</button>
<style>/* PORT: `.sim-reset`, `:hover`, `:active` from the prototype. */</style>
<script>
  // PORT verbatim the resetSim() cache-busting logic from the prototype, bound to
  // each `.sim-reset` click via addEventListener (no inline onclick).
  document.querySelectorAll('.sim-reset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const demo = (btn as HTMLElement).closest('.phone-demo');
      const iframe = demo?.querySelector('iframe') as HTMLIFrameElement | null;
      if (!iframe) return;
      const base = iframe.dataset.src || iframe.src.replace(/[?&]_r=\d+/, '');
      iframe.dataset.src = base;
      const sep = base.includes('?') ? '&' : '?';
      iframe.src = base + sep + '_r=' + Date.now();
    });
  });
</script>
```

- [ ] **Step 4: `TryIt.astro`** (port `.phone-demo.try-it`, `.play-sticker`, `.phone-iframe`; composes PhoneFrame-style frame + iframe + ResetButton)

```astro
---
import ResetButton from './ResetButton.astro';
interface Props { src: string; title: string; }
const { src, title } = Astro.props;
---
<div class="phone-demo try-it">
  <div class="play-sticker">Play with me</div>
  <ResetButton />
  <div class="phone-frame">
    <iframe class="phone-iframe" src={src} title={title} loading="eager"
      allow="autoplay; encrypted-media" referrerpolicy="no-referrer-when-downgrade"
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>
  </div>
</div>
<style>/* PORT: `.phone-demo.try-it`, `.play-sticker`, `.phone-demo.try-it .phone-frame`, `.phone-iframe` from the prototype. */</style>
```

- [ ] **Step 5: `ColorWheel.astro`** — port the entire Circle-of-Fifths SVG verbatim from the prototype (anchor `<div class="color-wheel-demo">` and its `<svg viewBox="0 0 400 400"`), plus the `.color-wheel-demo` and `.note-label` styles (anchor `.color-wheel-demo {`).

```astro
---
---
<div class="color-wheel-demo">
  <!-- PORT: the full <svg> ... </svg> verbatim from the prototype color-wheel-demo. -->
</div>
<style>/* PORT: `.color-wheel-demo`, `.color-wheel-demo svg`, `.note-label`, `.color-wheel-title` from the prototype. */</style>
```

- [ ] **Step 6: Verify** `pnpm build`. Commit.

```bash
git add src/components/content/
git commit -m "feat: add StackTrailer/Footnotes/Ref/ResetButton/TryIt/ColorWheel primitives"
```

### Task 1.7: BackLink + MarketingButton + work page shell

**Files:**
- Create: `src/components/BackLink.astro`, `src/components/MarketingButton.astro`, `src/pages/work/[slug].astro`

Port `.crumbs` -> BackLink; create the top-right marketing button (new styling, balances the crumb). Port `.dive-title`, `.dive-role`, `.dive-body` and `.case-body p` into the work page's scoped style (anchor `.dive-title {`).

- [ ] **Step 1: `BackLink.astro`** (port `.crumbs`)

```astro
---
---
<a class="crumbs" href="/">&#8592; Ross Miller</a>
<style>/* PORT: `.crumbs` and `.crumbs:hover` from the prototype. */</style>
```

- [ ] **Step 2: `MarketingButton.astro`**

```astro
---
interface Props { href: string; label: string; }
const { href, label } = Astro.props;
---
<a class="marketing-btn" href={href} data-astro-reload>{label} &#8599;</a>
<style>
  .marketing-btn {
    position: absolute; top: 0; right: 0;
    font-size: 13px; color: var(--ink); text-decoration: none;
    border: 1px solid var(--hair); border-radius: 999px; padding: 6px 14px;
    transition: border-color 160ms ease, background 160ms ease;
  }
  .marketing-btn:hover { border-color: var(--hairHigh); background: rgba(17,17,17,0.025); }
</style>
```

- [ ] **Step 3: `src/pages/work/[slug].astro`** — dynamic body via a component map. Bodies are stubbed until Tasks 1.8 to 1.14 fill them in.

```astro
---
import PortfolioLayout from '../../layouts/PortfolioLayout.astro';
import BackLink from '../../components/BackLink.astro';
import MarketingButton from '../../components/MarketingButton.astro';
import { WORK, getProject } from '../../data/work';

import ChordColors from '../../components/work/ChordColors.astro';
import Tutor from '../../components/work/Tutor.astro';
import Forge from '../../components/work/Forge.astro';
import Symphony from '../../components/work/Symphony.astro';
import Openpath from '../../components/work/Openpath.astro';
import Sms from '../../components/work/Sms.astro';
import Vivy from '../../components/work/Vivy.astro';

const bodies: Record<string, any> = {
  'chord-colors': ChordColors, tutor: Tutor, forge: Forge, symphony: Symphony,
  openpath: Openpath, sms: Sms, vivy: Vivy,
};

export function getStaticPaths() {
  return WORK.map((p) => ({ params: { slug: p.slug } }));
}
const { slug } = Astro.params;
const project = getProject(slug!)!;
const Body = bodies[project.slug];
---
<PortfolioLayout title={`${project.title} - Ross Miller`} description={project.cardDesc}>
  <div class="container dive">
    {project.marketingUrl && <MarketingButton href={project.marketingUrl} label={project.marketingLabel ?? 'Visit site'} />}
    <BackLink />
    <h1 class="dive-title">{project.title}</h1>
    <p class="dive-role">{project.role}</p>
    <div class="dive-body case-body"><Body /></div>
  </div>
</PortfolioLayout>
<style>
  .container.dive { position: relative; }
  /* PORT: `.dive-title`, `.dive-role`, `.dive-body p`, `.case-body p`, `.case-body code`
     and the case-body link styles from the prototype. */
</style>
```

- [ ] **Step 4: Create 7 stub body components** so the page builds. For each of `ChordColors, Tutor, Forge, Symphony, Openpath, Sms, Vivy`, create `src/components/work/<Name>.astro` containing only:

```astro
---
---
<p>stub</p>
```

- [ ] **Step 5: Verify all 7 routes build**

Run: `pnpm build`
Then: `ls dist/work/chord-colors/index.html dist/work/tutor/index.html dist/work/forge/index.html dist/work/symphony/index.html dist/work/openpath/index.html dist/work/sms/index.html dist/work/vivy/index.html`
Expected: all exist.
Then: `grep -c 'marketing-btn' dist/work/tutor/index.html dist/work/forge/index.html dist/work/chord-colors/index.html`
Expected: `1`, `1`, `0` respectively (only tutor and forge have the marketing button).

- [ ] **Step 6: Commit**

```bash
git add src/components/BackLink.astro src/components/MarketingButton.astro src/pages/work/ src/components/work/
git commit -m "feat: add work page shell, BackLink, MarketingButton, body stubs"
```

### Tasks 1.8 - 1.14: Port the seven case-study bodies

Each task ports one `<template data-case="<slug>">` block from the prototype into its
`src/components/work/<Name>.astro`, replacing raw HTML with the primitives. They share one recipe.

**Porting recipe (apply per project):**
1. In the prototype, find `<template data-case="<slug>">` (anchor: that exact string) and read to its `</template>`.
2. Recreate the body in the component, importing only the primitives it uses from `../content/`.
3. Map raw markup to primitives:
   - `<p class="case-lede">...` -> `<Lede>...</Lede>`
   - `<h2 class="dive-h">X</h2>` plus following content -> `<Section title="X"> ... </Section>`
   - `<div class="case-stats">` with `.case-stat-num`/`.case-stat-lbl` -> `<Stats><Stat num=".." label=".." /></Stats>`
   - `<div class="phone-demo">...<div class="phone-screen <theme>" data-label="x.mp4">` -> `<PhoneFrame><Screen theme="<theme>" label="x.mp4" /></PhoneFrame>`
   - `<div class="desktop-demo">...<div class="desktop-screen <theme>" data-label="x.mp4">` -> `<DesktopFrame><Screen kind="desktop" theme="<theme>" label="x.mp4" /></DesktopFrame>`
   - `<p class="feature-caption">...` -> `<Caption>...</Caption>`
   - `<p class="stack-trailer">A · B · C</p>` -> `<StackTrailer items={["A","B","C"]} />`
   - footnotes `<ol>`/`<li>` -> `<Footnotes>`; inline `<sup><a href="#fn..">n</a></sup>` -> `<Ref id="fn.." n={n} />`
   - keep plain `<p>`, `<a>` (bio-style links), and `<code>` as raw HTML inside the components.
4. Leave the `data-label` placeholder values exactly as in the prototype (real videos drop in later via the Screen slot).
5. Verify content parity (Step pattern below), then commit.

The only project-specific extras:
- **Chord Colors** also uses `<TryIt src="https://chordcolors.com/chords?embed=iphone" title="Chord Colors interactive demo" />` (anchor `phone-demo try-it`) and `<ColorWheel />` (anchor `color-wheel-demo`). Both gradient diagrams and the "Color" section copy come from the prototype template.

---

### Task 1.8: Chord Colors body

**Files:** Create body in `src/components/work/ChordColors.astro` (replace stub).

- [ ] **Step 1:** Apply the porting recipe to `<template data-case="chord-colors">`. Imports: `Lede, Section, PhoneFrame, DesktopFrame, Screen, Caption, StackTrailer, TryIt, ColorWheel` as needed.
- [ ] **Step 2: Verify parity** Run: `pnpm build` then `grep -c 'chordcolors.com/chords' dist/work/chord-colors/index.html` Expected: at least `1` (the TryIt iframe). Then `grep -o 'The Circle of Fifths' dist/work/chord-colors/index.html | head -1` Expected: matches.
- [ ] **Step 3: Commit** `git add src/components/work/ChordColors.astro && git commit -m "feat: port Chord Colors case study"`

### Task 1.9: Tutor body

**Files:** `src/components/work/Tutor.astro`.

- [ ] **Step 1:** Apply the recipe to `<template data-case="tutor">`.
- [ ] **Step 2: Verify** Run: `pnpm build` then `grep -o 'Tutor' dist/work/tutor/index.html | head -1` Expected: matches; build clean.
- [ ] **Step 3: Commit** `git add src/components/work/Tutor.astro && git commit -m "feat: port Tutor case study"`

### Task 1.10: Forge body

**Files:** `src/components/work/Forge.astro`.

- [ ] **Step 1:** Apply the recipe to `<template data-case="forge">`.
- [ ] **Step 2: Verify** `pnpm build` clean; `grep -o 'Forge' dist/work/forge/index.html | head -1` matches.
- [ ] **Step 3: Commit** `git add src/components/work/Forge.astro && git commit -m "feat: port Forge case study"`

### Task 1.11: Symphony body

**Files:** `src/components/work/Symphony.astro`.

- [ ] **Step 1:** Apply the recipe to `<template data-case="symphony">`.
- [ ] **Step 2: Verify** `pnpm build` clean; `grep -o 'iPad' dist/work/symphony/index.html | head -1` matches.
- [ ] **Step 3: Commit** `git add src/components/work/Symphony.astro && git commit -m "feat: port Symphony Pro case study"`

### Task 1.12: Openpath body

**Files:** `src/components/work/Openpath.astro`.

- [ ] **Step 1:** Apply the recipe to `<template data-case="openpath">`.
- [ ] **Step 2: Verify** `pnpm build` clean; `grep -o 'Motorola' dist/work/openpath/index.html | head -1` matches.
- [ ] **Step 3: Commit** `git add src/components/work/Openpath.astro && git commit -m "feat: port Openpath case study"`

### Task 1.13: SMS body

**Files:** `src/components/work/Sms.astro`.

- [ ] **Step 1:** Apply the recipe to `<template data-case="sms">`.
- [ ] **Step 2: Verify** `pnpm build` clean; `grep -o 'Grub Runner' dist/work/sms/index.html | head -1` matches.
- [ ] **Step 3: Commit** `git add src/components/work/Sms.astro && git commit -m "feat: port SMS ordering case study"`

### Task 1.14: Vivy body

**Files:** `src/components/work/Vivy.astro`.

- [ ] **Step 1:** Apply the recipe to `<template data-case="vivy">`.
- [ ] **Step 2: Verify** `pnpm build` clean; `grep -o 'GLP-1' dist/work/vivy/index.html | head -1` matches.
- [ ] **Step 3: Commit** `git add src/components/work/Vivy.astro && git commit -m "feat: port Vivy case study"`

### Task 1.15: Manual SPA smoke test

- [ ] **Step 1: Preview and click through**

Run: `pnpm preview` (serves `dist/` at http://localhost:4321).
In a browser: load `/`, click each project card -> URL becomes `/work/<slug>/`, content shows. Press Back -> returns to `/`. Refresh a `/work/<slug>/` URL -> still renders. Open `/work/vivy/` directly in a new tab -> renders.
Expected: all true, no console errors. (Transitions are the default fade for now.)

- [ ] **Step 2:** Remove the old root homepage now that Astro owns `/`.

```bash
git rm index.html
pnpm build && ls dist/index.html
```
Expected: `dist/index.html` still exists (generated by Astro).

- [ ] **Step 3: Commit** `git commit -m "chore: remove legacy root index.html (superseded by Astro home)"`

---

# PHASE 2: Intro fade+slide + per-project enter transition

End state: first load and direct loads play a staggered fade + slide-up; navigating to non-ripple projects uses a fade+slide; reduced-motion is respected.

### Task 2.1: Staggered fade + slide-up intro

**Files:**
- Modify: `src/styles/global.css` (add the intro animation)
- Modify: `src/pages/index.astro` and `src/pages/work/[slug].astro` (mark staggered children)

- [ ] **Step 1: Add the intro animation to `global.css`**

```css
@keyframes riseIn {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
[data-rise] > * {
  opacity: 0;
  animation: riseIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: calc(var(--rise-i, 0) * 80ms);
}
@media (prefers-reduced-motion: reduce) {
  [data-rise] > * { opacity: 1; transform: none; animation: none; }
}
```

- [ ] **Step 2: Mark the home and work content as a stagger container.** In `index.astro`, add `data-rise` to the `.container` and set `style={`--rise-i:${i}`}` on each staggered child (name, updated, bio, section heading, the list, the now-line). In `[slug].astro`, add `data-rise` to `.container.dive` and increasing `--rise-i` on crumb, title, role, body.

(Exact edit: wrap the existing top-level children; set `--rise-i` 0,1,2,... in document order.)

- [ ] **Step 3: Verify** Run: `pnpm build` then `grep -c 'data-rise' dist/index.html` Expected: at least `1`. Preview and confirm the home content rises in on load; toggle OS reduce-motion and confirm it appears instantly.

- [ ] **Step 4: Commit** `git add src/styles/global.css src/pages/index.astro src/pages/work/[slug].astro && git commit -m "feat: staggered fade+slide-up intro (benji.org style)"`

### Task 2.2: Per-project fade+slide enter transition

**Files:**
- Modify: `src/pages/work/[slug].astro` (apply a transition name to non-ripple bodies)

Use Astro's `transition:animate` on the dive container for fade+slide, so client navigations to fade-slide projects animate. Chord Colors is excluded here (handled by the ripple in Phase 3).

- [ ] **Step 1:** Define a custom fade+slide `TransitionDirectionalAnimations` in a small module `src/scripts/transitions-config.ts`:

```ts
import type { TransitionDirectionalAnimations } from 'astro';
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const dir = (sign: number) => ({
  old: { name: 'fadeOut', duration: '0.18s', easing: EASE, fillMode: 'both' },
  new: { name: 'riseIn', duration: '0.5s', easing: EASE, fillMode: 'both' },
});
export const fadeSlide: TransitionDirectionalAnimations = {
  forwards: dir(1),
  backwards: dir(-1),
};
```

(Reuse the `riseIn` keyframes from global.css; add a `fadeOut` keyframe there: `@keyframes fadeOut { to { opacity: 0 } }`.)

- [ ] **Step 2:** In `[slug].astro`, import `fadeSlide` and apply `transition:animate={project.transition === 'fade-slide' ? fadeSlide : 'none'}` to `.container.dive`. Add `fadeOut` to `global.css`.

- [ ] **Step 3: Verify** Run: `pnpm build` clean. Preview: clicking Tutor/Forge/etc from home fades+slides; clicking Chord Colors still just swaps (ripple added next); Back fades.

- [ ] **Step 4: Commit** `git add -A && git commit -m "feat: fade+slide enter transition for non-ripple projects"`

---

# PHASE 3: WebGL ripple for Chord Colors

End state: clicking the Chord Colors card from home plays the WebGL ripple from the click point while navigating to `/work/chord-colors/`; deep-link and Back do not ripple; if the integration fails it falls back to fade+slide.

### Task 3.1: RippleCanvas + ported WebGL module

**Files:**
- Create: `src/components/RippleCanvas.astro`, `src/scripts/ripple.ts`
- Modify: `src/layouts/PortfolioLayout.astro` (mount the canvas, persisted)

- [ ] **Step 1: Create `src/components/RippleCanvas.astro`**

```astro
---
---
<canvas class="ripple-canvas" data-ripple-canvas transition:persist></canvas>
<style is:global>
  .ripple-canvas {
    position: fixed; inset: 0; width: 100%; height: 100%;
    z-index: 60; pointer-events: none; opacity: 0; transition: opacity 120ms ease;
  }
  .ripple-canvas.visible { opacity: 1; transition: opacity 0ms; }
</style>
<script>
  import '../scripts/ripple.ts';
</script>
```

- [ ] **Step 2: Create `src/scripts/ripple.ts`** by porting the WebGL setup from the prototype:
  - Shaders `vsSrc`/`fsSrc` verbatim (anchor `const vsSrc =` and `const fsSrc =`).
  - `setupGL`, `compile`, `sizeCanvas` verbatim (anchor `function setupGL()`), retargeted to `document.querySelector('[data-ripple-canvas]')`.
  - The `VARIANTS['chord-colors']` shader inputs come from the project's `ripple` config (mode/band/period/sat/light/easeIn/easeOut), not a controls panel.
  - Export a function `playRipple(x: number, y: number, cfg: RippleConfig): Promise<void>` that runs the clip-path + canvas-band animation from the prototype's `navigateTo` (anchor `const anim = diveEl.animate(`) but resolves a Promise when the ripple completes, and draws onto the persisted canvas. It does NOT itself navigate.

```ts
// Skeleton; fill the WebGL body from the prototype as described above.
import type { RippleConfig } from '../data/work';
let gl: WebGLRenderingContext | null = null;
// ... ported vsSrc, fsSrc, setupGL(), compile(), sizeCanvas() ...
export function playRipple(x: number, y: number, cfg: RippleConfig): Promise<void> {
  // 1. show canvas, size it, compute maxR from (x,y) to the farthest corner + band.
  // 2. drive an rAF loop drawing the cosine band (ported from the prototype `frame()`),
  //    using cfg for sat/light/period/band/mode and easeIn/easeOut for timing.
  // 3. resolve when elapsed >= cfg.durationMs; hide canvas on resolve.
  return new Promise((resolve) => { /* ported animation, then resolve() */ });
}
window.addEventListener('resize', () => {/* sizeCanvas() */});
```

- [ ] **Step 3: Mount in the layout** Add `import RippleCanvas from '../components/RippleCanvas.astro';` and place `<RippleCanvas />` as the last child of `<body>` in `PortfolioLayout.astro`.

- [ ] **Step 4: Verify** Run: `pnpm build` clean; `grep -c 'data-ripple-canvas' dist/index.html` Expected: `1` (persisted canvas present on every portfolio page).

- [ ] **Step 5: Commit** `git add src/components/RippleCanvas.astro src/scripts/ripple.ts src/layouts/PortfolioLayout.astro && git commit -m "feat: add persisted ripple canvas and ported WebGL module"`

### Task 3.2: Hook the ripple into Chord Colors navigation

**Files:**
- Create: `src/scripts/ripple-nav.ts`
- Modify: `src/components/RippleCanvas.astro` (import ripple-nav)

The controller intercepts clicks on the Chord Colors card, plays the ripple, then lets ClientRouter swap. Deep-links and Back never ripple (no captured origin).

- [ ] **Step 1: Create `src/scripts/ripple-nav.ts`**

```ts
import { navigate } from 'astro:transitions/client';
import { playRipple } from './ripple';
import { getProject } from '../data/work';

// Capture clicks on the ripple project's card. Intercept, play the ripple from the
// click point, then navigate. ClientRouter keeps the canvas (transition:persist).
function wire() {
  document.querySelectorAll('a.deep-dive[data-transition="ripple"]').forEach((a) => {
    a.addEventListener('click', async (e) => {
      const link = a as HTMLAnchorElement;
      const slug = link.dataset.slug!;
      const cfg = getProject(slug)?.ripple;
      if (!cfg) return; // fall back to normal navigation
      e.preventDefault();
      const me = e as MouseEvent;
      await playRipple(me.clientX, me.clientY, cfg);
      navigate(link.href);
    }, { once: false });
  });
}
document.addEventListener('astro:page-load', wire); // re-wire after every swap
```

- [ ] **Step 2:** In `RippleCanvas.astro`'s `<script>`, also `import '../scripts/ripple-nav.ts';`.

- [ ] **Step 3: Verify (browser)** Run: `pnpm preview`. From `/`, click Chord Colors -> ripple plays from the click point, then `/work/chord-colors/` loads. Open `/work/chord-colors/` directly -> NO ripple (fade+slide intro). Click a non-Chord-Colors card -> fade+slide, no ripple. Back from Chord Colors -> fade, no reverse ripple.
Expected: all true, no console errors.

- [ ] **Step 4: Fallback check** Temporarily force `playRipple` to throw; confirm the card still navigates (wrap the `await playRipple` in try/catch that proceeds to `navigate` on error). Keep the try/catch.

- [ ] **Step 5: Commit** `git add src/scripts/ripple-nav.ts src/components/RippleCanvas.astro && git commit -m "feat: drive Chord Colors ripple through ClientRouter navigation"`

---

# PHASE 4: Marketing conversions (parallel sub-agents)

End state: `/tutor/` and `/forge/` are Astro pages that render identically to the originals. Each conversion is dispatched to its own sub-agent (independent, same shape).

### Task 4.1: Convert `/tutor` (sub-agent)

**Files:**
- Create: `src/pages/tutor/index.astro`
- Move: `tutor/screenshots/*` -> `public/tutor/screenshots/*`
- Remove: the old `tutor/` dir once parity is confirmed

- [ ] **Step 1: Move screenshots into public**

```bash
mkdir -p public/tutor/screenshots
git mv tutor/screenshots/* public/tutor/screenshots/
```

- [ ] **Step 2: Create `src/pages/tutor/index.astro`** Port `tutor/index.html` faithfully: move its inline `<style>` into the `.astro` file's scoped `<style>` (or `<style is:global>` if it relies on global selectors), keep the body markup, and rewrite image `src` paths to `/tutor/screenshots/...`. Use `BaseHead` for `<head>` meta but keep the page's own design. Wrap in a minimal local layout or inline the `<html>` shell (this page does NOT use PortfolioLayout, so it has no ripple/ClientRouter unless desired).

```astro
---
import BaseHead from '../../components/BaseHead.astro';
---
<!doctype html>
<html lang="en">
  <head><BaseHead title="Tutor" /></head>
  <body>
    <!-- PORT: tutor/index.html body verbatim; image src -> /tutor/screenshots/... -->
  </body>
</html>
<style is:global>/* PORT: tutor/index.html inline CSS. */</style>
```

- [ ] **Step 3: Verify parity** Run: `pnpm build` then `ls dist/tutor/index.html dist/tutor/screenshots/reader.png`. Open `dist/tutor/index.html` in a browser next to the original `prototypes/.../tutor` (or the prior `tutor/index.html` from git) and confirm visual parity: same sections, images load, layout matches.
Expected: renders identically; all 9 screenshots load.

- [ ] **Step 4: Remove the old dir** `git rm -r tutor` (the HTML is now Astro; screenshots moved to public).

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: convert /tutor marketing page to Astro"`

### Task 4.2: Convert `/forge` (sub-agent)

**Files:**
- Create: `src/pages/forge/index.astro`
- Move: `forge/screenshots/*` -> `public/forge/screenshots/*`
- Remove: the old `forge/` dir once parity is confirmed

- [ ] **Step 1: Move screenshots**

```bash
mkdir -p public/forge/screenshots
git mv forge/screenshots/* public/forge/screenshots/
```

- [ ] **Step 2: Create `src/pages/forge/index.astro`** Port `forge/index.html` faithfully (same recipe as Task 4.1 Step 2): inline CSS -> scoped/global `<style>`, body verbatim, image `src` -> `/forge/screenshots/...`, `BaseHead` for meta, keep its own design.

- [ ] **Step 3: Verify parity** Run: `pnpm build` then `ls dist/forge/index.html dist/forge/screenshots/list-mode.png`. Browser-compare to the original; confirm both screenshots load and layout matches.

- [ ] **Step 4: Remove the old dir** `git rm -r forge`.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: convert /forge marketing page to Astro"`

**Execution note:** Tasks 4.1 and 4.2 are independent and identical in shape. Dispatch one sub-agent each, in parallel, each handed this plan section plus the source file. Each sub-agent verifies parity before committing.

---

# PHASE 5: Full verification + deploy

### Task 5.1: Full route + asset verification

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && pnpm build && pnpm test`
Expected: build succeeds, all data tests pass.

- [ ] **Step 2: Every route exists**

Run:
```bash
for r in index work/chord-colors work/tutor work/forge work/symphony work/openpath work/sms work/vivy tutor forge; do
  test -f "dist/$r/index.html" 2>/dev/null || test -f "dist/$r.html" 2>/dev/null && echo "ok: $r" || echo "MISSING: $r";
done
```
Expected: every line `ok:` (note: `index` is `dist/index.html`). Fix any `MISSING`.

- [ ] **Step 3: Existing static still present**

Run: `ls dist/CNAME dist/games dist/fonts dist/robots.txt dist/sitemap.xml dist/llms.txt dist/profile.webp`
Expected: all exist. `dist/CNAME` is `rossmiller.dev`.

- [ ] **Step 4: Browser pass on `pnpm preview`** Confirm: home intro animation; ripple on Chord Colors click; fade+slide on other projects and on first load; Back fades; deep-link to `/work/chord-colors/` has no ripple; marketing buttons on `/work/tutor` and `/work/forge` navigate to `/tutor` and `/forge`; `/tutor` and `/forge` look right; `/games` still loads. No console errors.

- [ ] **Step 5: Commit** any fixes. If none, proceed.

### Task 5.2: Merge to master and enable the Actions deploy

- [ ] **Step 1: Merge the branch**

```bash
git checkout master
git merge --no-ff astro-migration -m "Migrate portfolio to Astro with bookmarkable URLs and SPA transitions"
```

- [ ] **Step 2: USER ACTION (cannot be automated):** In GitHub repo Settings -> Pages -> Build and deployment -> Source, select **GitHub Actions**. (Until this is flipped, the workflow runs but Pages still serves the old branch deploy.)

- [ ] **Step 3: Push and watch the deploy**

```bash
git push origin master
```
Then watch the Actions run (Run: `gh run watch` or check the Actions tab). Expected: build + deploy succeed.

- [ ] **Step 4: Verify live** Load `https://rossmiller.dev/`, click through to `/work/<slug>/`, confirm bookmarking/refresh/Back work live, `/tutor` and `/forge` render, `/games` still works, custom domain resolves (CNAME preserved).

- [ ] **Step 5:** If anything regressed, fix forward on `master` (or revert the merge) before further changes.

---

## Self-review

**Spec coverage:** home + `/work/<slug>` pages (Phase 1), `/work/` scheme avoiding collisions (Task 1.7), data-file content model (1.1), full component architecture incl. all primitives + layout + chrome (1.2-1.7, 3.1), all 5 transition behaviors (Phase 2 intro/fade-slide + Phase 3 ripple, deep-link/Back covered in 3.2 Step 3), marketing button (1.7, data in 1.1), `/tutor` + `/forge` conversion via sub-agents (Phase 4), repo restructure to `public/` (0.2), GitHub Actions deploy + CNAME + Pages toggle (0.5, 5.2), verification before deploy (1.15, 5.1). Image-optimization is correctly left out (spec marks it future).

**Placeholders:** Content ports reference exact prototype templates by anchor string rather than reproducing thousands of lines. That is a concrete instruction, not a TODO. New infrastructure (config, data, primitives skeletons, ripple glue, workflow, tests) has complete code. The `/* PORT: ... */` markers each name the exact source rules to copy.

**Type consistency:** `Project`/`RippleConfig` fields defined in Task 1.1 are used consistently in `WorkCard` (1.2), `[slug].astro` (1.7), `ripple.ts`/`ripple-nav.ts` (3.1/3.2): `slug, transition, ripple, marketingUrl, marketingLabel, thumbClass, thumbImage`. `playRipple(x, y, cfg)` signature matches between definition (3.1) and call site (3.2). `getWork`/`getProject` used as defined.

## Risks

- **Ripple x ClientRouter (Phase 3)** is the main unknown. Mitigation: it ships last, behind a try/catch fallback to normal navigation, and the site is fully usable after Phase 2 even if Phase 3 is deferred.
- **`withastro/action` package-manager detection:** if it fails to detect pnpm, pin it via the action's `package-manager` input.
- **Deploy cutover:** verified on branch first; the manual Pages toggle is the only irreversible-ish step and is the user's to make.
