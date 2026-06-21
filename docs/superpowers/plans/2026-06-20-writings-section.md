# Writings Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Writings" section above "Selected works" on the home page, backed by Astro Content Collections (MDX), with a reading-focused essay detail page at `/writing/[slug]`.

**Architecture:** MDX essays live in `src/content/writing/`, defined by a Zod schema in `src/content/config.ts`. The home page queries them via `getCollection('writing')` and renders a title + date list. The detail page at `src/pages/writing/[slug].astro` uses `render()` from `astro:content` to compile MDX.

**Tech Stack:** Astro 6, `@astrojs/mdx` (new dependency), Astro Content Collections, Zod (via `astro:content`), Vitest.

## Global Constraints

- No em-dashes anywhere in code, comments, or content. Use periods, commas, or parentheses instead.
- All CSS custom properties follow the existing palette: `--bg`, `--ink`, `--muted`, `--hair`, `--focus`, `--container: 706px`, `--gutter: 24px`.
- Global body font is 14px. Essay body uses 17px.
- Slug for the first essay is `stochastic-workers` (from filename `stochastic-workers.mdx`). Do not write essay content, only frontmatter + an empty body.
- Use `render` (not `entry.render()`) from `astro:content` - this is the Astro 5+ API.

---

### Task 1: Install MDX and register the writing content collection

**Files:**
- Modify: `astro.config.mjs`
- Modify: `package.json` (via `pnpm add`)
- Create: `src/content/config.ts`
- Create: `src/content/writing/stochastic-workers.mdx`

**Interfaces:**
- Produces: `writing` content collection with schema `{ title: string, date: Date, description?: string }`. Slug is derived from filename: `stochastic-workers.mdx` → `stochastic-workers`.

- [ ] **Step 1: Install `@astrojs/mdx`**

```bash
pnpm add @astrojs/mdx
```

Expected: resolves cleanly, `@astrojs/mdx` appears in `package.json` dependencies.

- [ ] **Step 2: Add MDX integration to `astro.config.mjs`**

Open `astro.config.mjs`. The current integrations array contains only `sitemap(...)`. Add `mdx()` as the first integration:

```js
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://rossmiller.dev',
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => {
        if (page.includes('/craft/')) {
          return page.endsWith('/craft/chord-colors/') || page.endsWith('/craft/tutor/');
        }
        return true;
      },
    }),
  ],
  build: {
    inlineStylesheets: 'always',
  },
});
```

- [ ] **Step 3: Create `src/content/config.ts`**

```ts
import { defineCollection, z } from 'astro:content';

const writing = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
  }),
});

export const collections = { writing };
```

- [ ] **Step 4: Create `src/content/writing/stochastic-workers.mdx`**

The file has frontmatter only. Leave the body empty for now (content will be written separately).

```mdx
---
title: "Stochastic workers inside deterministic scaffolding"
date: "2026-06-20"
---
```

- [ ] **Step 5: Verify type checking passes**

```bash
pnpm check
```

Expected: zero errors. If Astro reports a missing `src/content/config.ts` or unrecognized collection, verify the file is at exactly that path (not `src/content/config.mjs`).

- [ ] **Step 6: Commit**

```bash
git add astro.config.mjs package.json pnpm-lock.yaml src/content/config.ts src/content/writing/stochastic-workers.mdx
git commit -m "feat: add MDX integration and writing content collection"
```

---

### Task 2: Essay detail page at `/writing/[slug]`

**Files:**
- Create: `src/pages/writing/[slug].astro`

**Interfaces:**
- Consumes: `writing` collection from Task 1. Access via `getCollection('writing')` and `render(essay)` from `astro:content`. `essay.data.title: string`, `essay.data.date: Date`, `essay.data.description?: string`, `essay.slug: string`.
- Consumes: `PortfolioLayout` from `src/layouts/PortfolioLayout.astro` (props: `title: string`, `description?: string`).
- Consumes: `BackLink` from `src/components/BackLink.astro` (no props).
- Produces: Static pages at `/writing/stochastic-workers` (and any future essay slugs).

- [ ] **Step 1: Create `src/pages/writing/[slug].astro`**

```astro
---
import { getCollection, render } from 'astro:content';
import PortfolioLayout from '../../layouts/PortfolioLayout.astro';
import BackLink from '../../components/BackLink.astro';

export async function getStaticPaths() {
  const essays = await getCollection('writing');
  return essays.map((essay) => ({
    params: { slug: essay.slug },
    props: { essay },
  }));
}

const { essay } = Astro.props;
const { Content } = await render(essay);
const formattedDate = essay.data.date.toLocaleDateString('en-US', {
  month: 'long',
  year: 'numeric',
});
---
<PortfolioLayout
  title={`${essay.data.title} - Ross Miller`}
  description={essay.data.description}
>
  <main class="container essay" data-rise>
    <div class="rise-slot back-row" style="--rise-i:0">
      <BackLink />
    </div>
    <article style="--rise-i:1">
      <header class="essay-header">
        <h1 class="essay-title">{essay.data.title}</h1>
        <time class="essay-date" datetime={essay.data.date.toISOString()}>
          {formattedDate}
        </time>
      </header>
      <div class="essay-body">
        <Content />
      </div>
    </article>
  </main>
</PortfolioLayout>
<style>
  .container.essay {
    max-width: 640px;
    margin: 0 auto;
    padding: 80px 24px 96px;
  }
  .back-row { margin-bottom: 40px; }
  .essay-header { margin-bottom: 48px; }
  .essay-title {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 560;
    line-height: 1.3;
    letter-spacing: -0.3px;
  }
  .essay-date {
    display: block;
    color: var(--muted);
    font-size: 13px;
  }
  .essay-body {
    font-size: 17px;
    line-height: 1.75;
    letter-spacing: -0.1px;
  }
  .essay-body p { margin: 0 0 1.4em; }
  .essay-body p:last-child { margin-bottom: 0; }
  .essay-body h2 {
    margin: 2em 0 0.5em;
    font-size: 16px;
    font-weight: 560;
    letter-spacing: -0.15px;
  }
  .essay-body h3 {
    margin: 1.5em 0 0.4em;
    font-size: 15px;
    font-weight: 540;
  }
  .essay-body code {
    font-family: ui-monospace, "SF Mono", "Fira Code", monospace;
    font-size: 0.88em;
    background: var(--shot-bg);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .essay-body pre {
    background: var(--shot-bg);
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.6;
  }
  .essay-body pre code {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  .essay-body blockquote {
    margin: 0 0 1.4em;
    padding: 0 0 0 16px;
    border-left: 2px solid var(--hair);
    color: var(--muted);
  }
  .essay-body a {
    color: inherit;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    text-decoration-color: color-mix(in srgb, var(--ink) 22%, transparent);
    transition: text-decoration-color 200ms ease;
  }
  .essay-body a:hover { text-decoration-color: var(--ink); }
</style>
```

- [ ] **Step 2: Verify type checking and build**

```bash
pnpm check
```

Expected: zero errors.

```bash
pnpm build
```

Expected: build completes, `dist/writing/stochastic-workers/index.html` exists. Verify:

```bash
ls dist/writing/
```

Expected output: `stochastic-workers/`

- [ ] **Step 3: Commit**

```bash
git add src/pages/writing/
git commit -m "feat: add essay detail page at /writing/[slug]"
```

---

### Task 3: Add Writings section to home page

**Files:**
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `writing` collection from Task 1. `getCollection('writing')` returns `Array<{ slug: string, data: { title: string, date: Date, description?: string } }>`.
- Produces: "Writings" section on homepage listing essays with title + date, above "Selected works".

- [ ] **Step 1: Add `getCollection` import and writings query to `src/pages/index.astro`**

At the top of the frontmatter block (after the existing imports), add:

```ts
import { getCollection } from 'astro:content';
```

Then after `const work = getWork();`, add:

```ts
const writings = (await getCollection('writing')).sort(
  (a, b) => b.data.date.getTime() - a.data.date.getTime()
);
```

- [ ] **Step 2: Insert the Writings section and update rise-i indices**

In the template, find:

```html
<h2 class="home-section-h" style="--rise-i:1">Selected works</h2>
```

Replace it with the Writings section followed by the updated Selected works heading:

```html
<h2 class="home-section-h" style="--rise-i:1">Writings</h2>
<ul class="writings" style="--rise-i:0">
  {writings.map((w) => {
    const label = w.data.date.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    return (
      <li>
        <a href={`/writing/${w.slug}`}>{w.data.title}</a>
        <span class="writing-date">{label}</span>
      </li>
    );
  })}
</ul>
<h2 class="home-section-h" style="--rise-i:2">Selected works</h2>
```

- [ ] **Step 3: Add styles for the writings list**

In the `<style>` block of `index.astro`, add after the existing styles:

```css
.writings {
  list-style: none;
  margin: 0 0 48px;
  padding: 0;
}
.writings li {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--hair);
}
.writings li:first-child { border-top: 1px solid var(--hair); }
.writings a {
  color: inherit;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, var(--ink) 22%, transparent);
  transition: text-decoration-color 200ms ease;
  flex: 1;
}
.writings a:hover { text-decoration-color: var(--ink); }
.writing-date {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm build
```

Expected: zero errors, `dist/index.html` contains the Writings section.

- [ ] **Step 5: Visual check in browser**

```bash
pnpm dev
```

Open http://localhost:4321. Verify:
- "Writings" heading appears above "Selected works"
- Essay title and date appear in the list
- Clicking the essay title navigates to `/writing/stochastic-workers`
- Essay page shows title, date, and empty body
- BackLink navigates back to home
- No layout regressions on the work rows or NowClock

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: add Writings section to homepage"
```
