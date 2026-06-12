# Astro portfolio: bookmarkable project URLs + SPA transitions

Date: 2026-06-04
Status: Approved design, pending implementation plan
Repo: rsml/rsml.github.io (custom domain `rossmiller.dev`)

## Summary

Rebuild the portfolio prototype (`prototypes/chord-hover.html`) as an Astro site. Each
project gets its own real, bookmarkable URL under `/work/<slug>/`, with native back/forward
and refresh, while keeping a single-page feel and the signature WebGL ripple. Also convert
the two existing marketing sub-sites (`/tutor`, `/forge`) to Astro. Astro is chosen for
performance and because pre-rendered per-project pages are the cleanest way to get real URLs
on a static host.

## Goals

1. Every project page has a distinct, bookmarkable URL; refresh and browser Back/Forward work.
2. Preserve the SPA feel (no white flash between pages).
3. Keep the WebGL ripple for the flagship (Chord Colors); elegant fade + slide elsewhere.
4. Better performance via Astro (ship per-page only what each page needs).
5. Convert `/tutor` and `/forge` marketing pages to Astro too.

## Scope

In scope:
- Portfolio home (`/`) and project pages (`/work/<slug>/`), replacing `index.html`.
- Conversion of `/tutor` and `/forge` marketing pages to Astro.
- Transition system (intro, ripple, fade/slide, back).
- GitHub Actions build-and-deploy; preserve custom domain and all existing URLs.

Out of scope (stays static, served verbatim from `public/`):
- `/games` and any other existing top-level content not named above.
- Image optimization of marketing screenshots (noted as a fast-follow, see Future).

## Current state

- Plain static site, no build step. GitHub Pages "deploy from branch", custom domain via `CNAME` (`rossmiller.dev`).
- `index.html` is the live homepage (separate from the prototype).
- The prototype `prototypes/chord-hover.html` is a single self-contained file: inline CSS/JS,
  WebGL ripple reveal between a home page and a per-project "dive" page. Project bodies live in
  `<template data-case="...">` blocks; navigation is click-driven (`navigateTo`/`navigateBack`).
  This file is the source of truth for the exact case-study markup, styles, and ripple params.
- Existing marketing sub-sites: `tutor/index.html` (+ 9 screenshots, ~18MB) and
  `forge/index.html` (+ 2 screenshots). Each is one self-contained HTML file, inline CSS, no JS.

## URL model

- `/` -> home (bio + "My work" cards). Replaces `index.html`.
- `/work/<slug>/` -> one pre-rendered page per project.
  Slugs and order: `chord-colors`, `tutor`, `forge`, `symphony`, `openpath`, `sms`, `vivy`.
- `/tutor/`, `/forge/` -> converted Astro marketing pages (same URLs as today).
- `/games/` and other existing paths -> unchanged (static passthrough).

A `/work/` prefix is used so project slugs never collide with the top-level `/tutor` and
`/forge` sub-sites.

## Content model

Project content is hand-built HTML (device frames, SVG color wheel, footnotes, iframes), not
prose, so we use a data file + per-project body components rather than Markdown/MDX.

- `src/data/work.ts` - single source of truth, one typed entry per project:
  `slug, order, title, role, cardTitle, cardDesc, thumbClass, transition: "ripple" | "fade-slide",
  marketingUrl?, marketingLabel?, ripple?` (ripple config only for Chord Colors: mode, color1,
  color2, band, period, sat, light, easing - ported from the prototype's `controls` defaults and
  `VARIANTS['chord-colors']`).
  Currently `marketingUrl` is set for `tutor` (`/tutor`) and `forge` (`/forge`).
- `src/components/work/<Slug>.astro` - each case-study body, ported from the prototype templates
  and recomposed from the content primitives below.
- `src/pages/index.astro` - maps over the data to render `WorkCard`s linking to `/work/<slug>/`.
- `src/pages/work/[slug].astro` - `getStaticPaths()` over the data; renders dive chrome
  (`BackLink`, title, role, optional `MarketingButton`) + the matching body component.

## Component architecture

Tier 1 - shell / layout:
- `BaseHead.astro` - `<head>` (meta, SEO/OpenGraph, fonts, favicon). Shared by every page.
- `PortfolioLayout.astro` - composes `BaseHead` + global tokens + `<ClientRouter/>` +
  persisted `<RippleCanvas/>` + page `<slot/>`. Used by home and `/work` pages.
- `RippleCanvas.astro` - singleton persisted `<canvas transition:persist>` plus the
  WebGL/transition controller script.

Tier 2 - page chrome:
- `WorkCard.astro` (home card) composes `Thumb.astro` (image-icon vs CSS-drawn-mark variants).
- `BackLink.astro` - back crumb (top-left).
- `MarketingButton.astro` - top-right marketing-site link, `{ href, label }`, uses
  `data-astro-reload` (full navigation, since the marketing sites are outside the SPA router or
  have their own design).

Tier 3 - case-study content primitives (reusable, composable):
- `Section.astro` - `dive-h` heading + trailing rule, content slot.
- `Lede.astro` - large intro paragraph.
- `Stats.astro` + `Stat.astro` - stat grid (compose `Stat` children).
- `PhoneFrame.astro` / `DesktopFrame.astro` - device frames; prop `label`; slot for media.
- `Screen.astro` - themed gradient placeholder carrying `data-label`, swap for `<img>`/`<video>`
  in the slot without changing the frame.
- `Caption.astro` - feature caption under a demo.
- `Footnotes.astro` + `Ref.astro` - footnote list + inline superscript refs.
- `StackTrailer.astro` - tech-stack mono line, prop `items`.
- Specials: `TryIt.astro` (composes `PhoneFrame` + iframe + `ResetButton` + play sticker),
  `ResetButton.astro`, `ColorWheel.astro` (the SVG).

Composability principles:
- Props for data, slots for content. Frames/sections wrap arbitrary children, so swapping a
  placeholder for a real `<video>` never touches the frame.
- Astro scoped `<style>` per component, so internals change without breaking consumers.
- Shared design tokens (`--bg/--ink/--muted/--hair`, type, container width) live in one
  `src/styles/global.css` imported by the layout.
- Each project body is composition of primitives + prose, not raw HTML. Adding a project = a new
  `work.ts` entry + a body that reuses primitives.

Example body shape:
```astro
<Section title="Color">
  <p>...prose...</p>
  <PhoneFrame label="wheel.mp4"><Screen theme="color-system" /></PhoneFrame>
  <Caption>The 12-note wheel, one hue per fifth.</Caption>
</Section>
```

## Transitions

Behaviors:
1. First load / direct load / refresh (any URL): CSS staggered fade + slide-up of content
   (benji.org style: pure CSS keyframes + per-element `animation-delay`). Honors
   `prefers-reduced-motion` (drops to instant or simple fade). Starting values to tune:
   `opacity 0 -> 1`, `translateY ~20px -> 0`, soft ease-out, ~80ms stagger, ~0.8s.
2. Home -> Chord Colors (in-app click): WebGL ripple from the click point, revealing the Chord
   Colors page. Same feel as today.
3. Home -> other project (in-app click): fade + slide-up of the destination (same motion as the intro).
4. Back to home (browser Back or back crumb): quick cross-fade. Not the full staggered intro, not
   a reverse ripple (no pointer origin).
5. Deep-link straight to `/work/chord-colors`: no pointer origin, so no ripple; uses the standard
   fade + slide-up. The ripple is reserved for the in-app click where a real origin exists.

Wiring (ClientRouter):
- `<ClientRouter/>` in `PortfolioLayout` gives client-side navigation: real URLs, history, no flash.
- Fade/slide (cases 1, 3, 4) use Astro `transition:animate` (custom fade+slide), mostly CSS.
- Chord Colors ripple (case 2) is the one custom piece: `<canvas transition:persist>` keeps the
  WebGL context across the swap; on the Chord Colors card click we capture `(x,y)` and drive the
  ripple through the View Transitions lifecycle (`astro:before-preparation` / `astro:before-swap`),
  revealing the destination under the expanding clip (same mechanic as the prototype).

De-risking (build in shippable stages):
- Stage 1: real pages + URLs + Back with a plain fade everywhere.
- Stage 2: add the fade + slide-up intro.
- Stage 3: port the WebGL ripple onto the Chord Colors transition.
If stage 3 fights the framework, Chord Colors falls back to fade+slide and still works.

## Marketing pages conversion (`/tutor`, `/forge`)

- Each becomes a real Astro page: `src/pages/tutor/index.astro`, `src/pages/forge/index.astro`,
  building to `/tutor/` and `/forge/` (same URLs).
- Faithful port: keep each site's existing design, inline CSS moved into the `.astro` page.
- Screenshots move to `public/tutor/screenshots/*` and `public/forge/screenshots/*` (same paths),
  referenced by absolute URL.
- They share `BaseHead` (and tokens if compatible) but keep their own self-contained bodies. A
  shared `Screenshot`/`Figure` is extracted only if it is an obvious win; do not force two design
  languages to share bodies.
- Execution: the two conversions are independent and identical in shape, so each is handled by its
  own sub-agent in parallel. Each sub-agent: port the HTML, move screenshots, verify the route
  renders identically to the original.

## Repo structure

```
astro.config.mjs                # site: https://rossmiller.dev
package.json
.github/workflows/deploy.yml
src/
  layouts/PortfolioLayout.astro
  components/BaseHead.astro
  components/RippleCanvas.astro
  components/WorkCard.astro, Thumb.astro, BackLink.astro, MarketingButton.astro
  components/content/Section.astro, Lede.astro, Stats.astro, Stat.astro,
            PhoneFrame.astro, DesktopFrame.astro, Screen.astro, Caption.astro,
            Footnotes.astro, Ref.astro, StackTrailer.astro, TryIt.astro,
            ResetButton.astro, ColorWheel.astro
  components/work/ChordColors.astro, Tutor.astro, Forge.astro, Symphony.astro,
            Openpath.astro, Sms.astro, Vivy.astro
  data/work.ts
  pages/index.astro
  pages/work/[slug].astro
  pages/tutor/index.astro
  pages/forge/index.astro
  scripts/ripple.ts             # WebGL ripple + transition controller
  styles/global.css             # design tokens + base
public/
  CNAME, robots.txt, sitemap.xml, llms.txt, profile.png, profile.webp, fonts/
  games/                        # unchanged
  tutor/screenshots/*, forge/screenshots/*
  prototypes/                   # keep for reference (optional removal later)
```

## Deployment

- `.github/workflows/deploy.yml` using Astro's official Pages actions: checkout, setup Node,
  `astro build`, upload `dist/`, deploy to Pages.
- One-time manual step (user): flip Pages source from "Deploy from branch" to "GitHub Actions" in
  repo settings. Claude cannot toggle this.
- `CNAME` lives in `public/` so the custom domain survives the build.
- `astro.config.mjs`: `site: 'https://rossmiller.dev'`, base `/` (custom-domain root).

## Verification (before any deploy)

- `astro build` + `astro preview`; confirm every route renders: `/`, all `/work/<slug>/`,
  `/tutor`, `/forge`, plus untouched `/games` and assets (fonts, profile image, sitemap).
- Browser-check transitions: ripple (Chord Colors click), fade/slide (other projects + intro),
  Back behavior, deep-link to `/work/chord-colors` (no ripple).
- Check marketing buttons on `/work/tutor` and `/work/forge` navigate to `/tutor` and `/forge`.
- Confirm no existing URL broke. Deploy only after this passes.

## Risks and mitigations

- Ripple x ClientRouter integration is the main technical risk. Mitigation: staged build with a
  fade+slide fallback for Chord Colors.
- Deploy-model switch could briefly affect the live site. Mitigation: verify the built `dist/`
  locally first; the workflow only deploys on success; keep `CNAME` in `public/`.
- Large Tutor screenshots (18MB) hurt the perf goal. Mitigation: faithful first pass, then the
  `astro:assets` optimization follow-up.

## Future / fast-follow (not now)

- Run marketing screenshots through `astro:assets` (responsive, modern formats) for large savings.
- Optionally migrate `/games` and remaining static content into Astro later.
- Optionally remove `prototypes/` once the Astro site fully replaces it.

## Decisions log

- Scope: portfolio page only for the main migration, plus convert `/tutor` and `/forge`. Other
  static content stays.
- URL scheme: `/work/<slug>` (avoids collision with `/tutor`, `/forge`).
- Transitions: ripple only for Chord Colors (in-app click); fade + slide-up for other projects,
  for first load, and for deep links; quick cross-fade on Back. Intro modeled on benji.org
  (pure CSS staggered fade+slide, no animation library).
- Approach: Astro multi-page + View Transitions (`<ClientRouter/>`), real pre-rendered pages.
- Deploy: GitHub Actions build-and-deploy; existing static content under `public/`.
- Content model: data file + per-project body components (not Markdown/MDX).
- Marketing conversions executed via parallel sub-agents.
