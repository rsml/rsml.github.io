# Writings Section Design

**Date:** 2026-06-20
**Status:** Approved

## Summary

Add a "Writings" section to the portfolio homepage (above "Selected works") and a reading-focused essay detail page at `/writing/[slug]`. First essay: "Stochastic workers inside deterministic scaffolding" (content TBW).

## Data Model

**Technology:** Astro Content Collections with MDX.

**New files:**
```
src/content/config.ts
src/content/writing/stochastic-workers.mdx
src/pages/writing/[slug].astro
```

**Frontmatter schema (Zod):**
```ts
title: z.string()
date:  z.coerce.date()          // "YYYY-MM-DD" string coerced to Date
description: z.string().optional()  // meta description only, not shown on home
```

The collection is named `writing`. Essays are sorted by date descending on the home page via `getCollection('writing')`.

## Home Page Changes (`src/pages/index.astro`)

A new "Writings" section is inserted between the bio and "Selected works":

```html
<h2 class="home-section-h" style="--rise-i:1">Writings</h2>
<ul class="writings">
  {writings.map(w => (
    <li>
      <a href={`/writing/${w.slug}`}>{w.data.title}</a>
      <span class="writing-date">{formatted date}</span>
    </li>
  ))}
</ul>
<h2 class="home-section-h" style="--rise-i:2">Selected works</h2>
```

**Styling:**
- No bullets on the list
- Links styled like bio links: quiet underline at rest (22% opacity), fills to full ink on hover, 200ms ease transition
- Date in `var(--muted)`, small, after the title
- Compact list, not cards
- `--rise-i` indices on "Writings" h2 = 1, "Selected works" h2 = 2; the works div stays at 0 (no change needed there)

## Essay Detail Page (`src/pages/writing/[slug].astro`)

Uses `PortfolioLayout` wrapper (same as all other pages).

**Structure:**
```
BackLink (top-left)

<article class="essay">
  <header>
    <h1>{title}</h1>
    <time datetime={iso}>{formatted date}</time>
  </header>
  {MDX content}
</article>
```

**Reading-focused CSS:**
- Prose column max-width: ~640px, centered in the existing container
- Body font size: 17px (vs global 15/16px)
- Line-height: 1.75
- Generous paragraph margin (1.4em)
- `<h2>`, `<h3>`, `<code>`, `<blockquote>` all styled to the site's existing type palette
- No sidebar, no tags, no table of contents

## Out of Scope

- RSS feed
- Tag/category filtering
- Reading time estimates
- Comment system
- Essay list as a separate `/writing` index page (home page list only)
