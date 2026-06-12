# Portfolio Rebuild Master Plan

> Target: a portfolio for **Artisan** (FE role, design systems + AI prototypes). Reviewer is a visual person. Budget 3 to 6 days. Send to `alejandra@artisan.co`.
>
> Heroes: **Chord Colors** (visual taste, real design system), **Tutor** (AI prototyping speed). Supporting: Forge, Vivy, Symphony Pro, Openpath, Earlier work.
>
> North-star end state: a single-column site in your existing Rams/Braun aesthetic, project list in narrative order, two heroes carrying poster-then-loop videos, and a separate `/system/` page with click-to-copy OKLCH swatches plus a Chord-Colors-as-design-system playground as the unique wow.

This plan is written as **interleaved tracks**. Each phase has a Ross track, an AI track, and explicit 🛑 STOP gates where one of you cannot continue without the other. Where you need to brief the AI, the prompt is given verbatim under `💬 TELL THIS TO AI`.

There are exactly three sync points: G1 (decisions before build — now resolved), G3-G10 (each video clip before its wiring), G11 (hue stops before playground). Everything else runs in parallel.

---

## Decisions (resolved 2026-06-03)

| # | Question | Answer |
|---|---|---|
| Q1 | Hero manifesto | **Keep current.** No manifesto stack. Two role subtitle lines stay as they are on rossmiller.dev today. |
| Q2 | Project order | Chord Colors → Tutor → Forge → Vivy → Symphony Pro → Openpath → Earlier |
| Q3 | Text2Order + GrubRunner | Merge into one **Earlier** row at the bottom |
| Q4 | Lab section | **Drop entirely.** Bray 8 is the only game Ross authored; the volume-as-pace-signal play doesn't hold. `/games/` stays at the URL but is not surfaced on home. |
| Q5 | Project descriptions | All 7 rewritten for Artisan punch (see table below) |
| Q6 | Chord playground hue stops | **Pending paste.** Ross will provide the real Chord Colors mapping. Until then, fallback is 12 evenly-spaced OKLCH hues at L=72%, C=0.13, hue 0/30/60/.../330. |
| Q7 | Email tone | Deferred. Ross handles independently at send time. |

### Locked project descriptions

| # | Project | Role | One-liner | Tags |
|---|---|---|---|---|
| 1 | Chord Colors | Creator | Music theory as a color system. 12 notes, 113 chords, 148 scales. | Design System / Mobile / Web / Music Theory |
| 2 | Tutor | Creator | AI writes a custom book on any subject. Asks, answers, and tests as you read. | AI Prototype / Education / UX / Open Source |
| 3 | Forge | Creator | Native macOS terminal for running many AI coding agents in parallel. | macOS / AI / Developer Tools / SwiftUI |
| 4 | Vivy | Founder | #1 doctor-led GLP-1 companion app on the App Store. | Mobile / Health / AI |
| 5 | Symphony Pro | Founder | World's first iPad sheet music notation app. Apple-spotlighted on launch. | iPad / Music / Design |
| 6 | Openpath Security | Software Engineering Manager, #2 Employee | Access control at scale. Millions of door unlocks per day. Acquired by Motorola. | Mobile / WebRTC / Reliability / Scale |
| 7 | Earlier | Founder | SMS food and drink ordering at music festivals and stadium events. Two startups: Text2Order, GrubRunner. | SMS / Lean Startup / Ops / Reliability |

---

## How to drive the AI

Open a Claude Code session in `/Users/ross/code/personal/rsml.github.io/` for every AI track. Each `💬 TELL THIS TO AI` block is the entire prompt for that batch. Paste verbatim. The AI has the repo context.

When the AI finishes a batch, look at it, then move to the next prompt. Do not paste two prompts at once. Resist the urge to expand a prompt midway. Capture sessions are the bottleneck so the worst thing you can do is loiter at the keyboard while the camera waits.

---

## Phase 0 — Scaffold (decisions already resolved)

**Goal:** Scaffold new files and tokens. All copy decisions are already locked in the table above, so the AI can move straight to scaffolding without waiting.

### 💬 TELL THIS TO AI

```
We are rebuilding rossmiller.dev for an Artisan frontend application. I will brief the rebuild in phases. This is Phase 0, scaffolding only. Do not change copy or reorder yet.

Goals for this batch:
1. Add motion tokens to the :root block in index.html (currently lines ~186-205):
     --motion-fast: 180ms;
     --motion-med: 320ms;
     --motion-slow: 560ms;
     --ease: cubic-bezier(0.2, 0.7, 0.1, 1);
2. Add a single global prefers-reduced-motion guard at the end of the inline <style> block:
     @media (prefers-reduced-motion: reduce) {
       *, *::before, *::after {
         animation-duration: 0.01ms !important;
         animation-iteration-count: 1 !important;
         transition-duration: 0.01ms !important;
         scroll-behavior: auto !important;
       }
     }
3. Add `html { scroll-behavior: smooth; }` to the global CSS.
4. Create /system/index.html as a scaffold:
   - Copy the <head>, <style> token block, and @font-face declarations from /index.html so the new page inherits the same aesthetic.
   - Render seven empty <section> elements with these IDs and headings, in order: #premise (h1 "Design system"), #color (h2 "Color"), #type (h2 "Type"), #space (h2 "Space and hairlines"), #primitives (h2 "Primitives"), #motion (h2 "Motion"), #playground (h2 "Chord-Colors playground"). Plus a <footer id="principles">.
   - Each section gets a one-line placeholder comment describing what will fill it later.
5. Create /media/ directory with a README.md describing the asset spec:
   - Per-file table listing: chord-hero.mp4, chord-hero.av1.mp4, chord-colors-poster.webp, tutor-hero.mp4, tutor-hero.av1.mp4, tutor-poster.webp, forge-loop.mp4, forge-poster.webp, vivy-loop.mp4, vivy-poster.webp, chord-card-loop.mp4, chord-card-poster.webp, tutor-card-loop.mp4, tutor-card-poster.webp, symphony-loop.mp4, symphony-poster.webp, openpath-loop.mp4, openpath-poster.webp.
   - Universal specs: muted, no audio track, ≤8s seamless loop, H.264 baseline + AV1 alternates, posters WebP q80, sub-300KB per video target.
   - ffmpeg one-liners for H.264 + AV1 encoding.
6. Add /system/ entry to sitemap.xml.
7. Add an /system/ paragraph + bullet to llms.txt.

Do NOT change copy, order, or any project section content yet. Do NOT add JS beyond what's listed. Do NOT delete anything. Show me a diff summary when done.
```

---

## Phase 1 — Static rebuild

**Goal:** Site looks meaningfully better even if you never capture a single video. Reorder, rewrite descriptions, embed static posters from existing screenshots, add footer, ship hover/focus/fade-rise microinteractions. Hero stays unchanged (decision Q1).

### 💬 TELL THIS TO AI

Paste this verbatim. All decisions are already filled in.

```
Phase 1 of the portfolio rebuild. Same repo. We now do the visible static restructure. Hero is staying exactly as it is — do not touch the .hero section in index.html. Do not add a Lab section anywhere.

Do all of the following in /Users/ross/code/personal/rsml.github.io/index.html:

1. Reorder <section class="proj"> blocks in the .work section to this exact top-to-bottom order:
   1. Chord Colors
   2. Tutor
   3. Forge
   4. Vivy
   5. Symphony Pro
   6. Openpath Security
   7. Earlier (newly merged — see step 2)

2. Merge Text2Order and GrubRunner into a single <section class="proj" id="earlier">:
   - Title: Earlier
   - Role: Founder
   - Description: "SMS food and drink ordering at music festivals and stadium events. Two startups: Text2Order, GrubRunner."
   - Tags: SMS / Lean Startup / Ops / Reliability
   - No external chip links unless they exist.
   Delete the standalone Text2Order and GrubRunner sections after merging.

3. Replace each project's <p> description with the rewritten copy below:
   - Chord Colors: "Music theory as a color system. 12 notes, 113 chords, 148 scales."
   - Tutor: "AI writes a custom book on any subject. Asks, answers, and tests as you read."
   - Forge: "Native macOS terminal for running many AI coding agents in parallel."
   - Vivy: "#1 doctor-led GLP-1 companion app on the App Store."
   - Symphony Pro: "World's first iPad sheet music notation app. Apple-spotlighted on launch."
   - Openpath Security: "Access control at scale. Millions of door unlocks per day. Acquired by Motorola."
   - Earlier: "SMS food and drink ordering at music festivals and stadium events. Two startups: Text2Order, GrubRunner."

4. Update each project's taglist <ul class="taglist"> to these values (in order):
   - Chord Colors: Design System / Mobile / Web / Music Theory
   - Tutor: AI Prototype / Education / UX / Open Source
   - Forge: macOS / AI / Developer Tools / SwiftUI  (keep as-is)
   - Vivy: Mobile / Health / AI  (keep as-is)
   - Symphony Pro: iPad / Music / Design  (reorder)
   - Openpath Security: Mobile / WebRTC / Reliability / Scale  (keep as-is)
   - Earlier: SMS / Lean Startup / Ops / Reliability

5. Uncomment every .proj-media block (currently commented). For each project, render an <img class="proj-poster" loading="lazy"> pointing to the best available local image:
   - Chord Colors: leave src empty; add a comment NOTE: placeholder pending /media/chord-colors-poster.webp. Use a CSS gradient fallback of var(--hair) to var(--bg) until the real asset lands.
   - Tutor: pick the most product-looking PNG from /tutor/screenshots/ (you choose; reason from filenames). Comment NOTE: placeholder pending /media/tutor-poster.webp.
   - Forge: pick from /forge/screenshots/ (you choose). Comment NOTE: placeholder pending /media/forge-poster.webp.
   - Vivy / Symphony Pro / Openpath / Earlier: empty src + gradient fallback + NOTE placeholder pending /media/<slug>-poster.webp.
   Aspect ratios stay 16:10 web and 9:19.5 phone as already defined.

6. Add a <footer id="footer"> after </main>'s closing or just before. Inside:
   - One-line "Now" sentence (use this default unless I provide one): "Right now: building Forge and pushing Chord Colors v2."
   - A second line: <span>Updated <time datetime="2026-06-03">2026-06-03</time> · <span data-commit>dev</span> · <span data-localtime>—</span></span>
   - Inline <script> at the bottom of <body> that sets data-localtime to the visitor's Intl-derived "h:mm a in <City>" using Intl.DateTimeFormat().resolvedOptions().timeZone. Keep data-commit as "dev" for now (real hash wired in Phase 4).

7. Microinteractions, all CSS only:
   - Card hover (@media (hover:hover) and (pointer:fine)):
       .proj { transition: border-color var(--motion-med) var(--ease) }
       .proj:hover { border-top-color: var(--hairHighlight) }
       .proj-poster { transition: transform var(--motion-med) var(--ease) }
       .proj:hover .proj-poster { transform: scale(1.02) }
     The MARKETING chip gets a `::after { content:" ↗" }` that fades in on hover.
   - Chip press: .chip:active transform: translateY(1px), border-color: var(--ink), 120ms.
   - Hero stays as-is, no fade-rise on load (we are not changing the hero).

8. Smooth scroll for anchor links: already set globally in Phase 0.

Do NOT touch the hero section. Do NOT add a Lab/Experiments/Toys/Games section. Do NOT add any <video> tags yet. Do NOT yet wire IntersectionObserver. Do NOT modify /system/ in this phase.

Show me the diff with line counts touched. Note the local-preview command in the README so I can review.
```

### 🛑 STOP — Site is now demonstrably better

Pause. Open `localhost`, scroll the homepage. If you ran out of time today, you have a shippable v0.5. The static rebuild alone is a meaningful upgrade from the current flat link-list. Phase 2 unlocks the hero motion that does the real selling.

---

## Phase 2 — Capture session (Ross blocks AI on per-clip gates)

**This is the only day where you are the bottleneck.** AI runs design-system content in parallel so you are never idle while the camera works.

### Track Ross — record in priority order

Block four hours of focused capture. Bash through in this exact order so the AI can start wiring as each clip lands.

For each clip: record at 1600px+ wide, screen recorder of choice (CleanShot / QuickTime / OBS). Trim to ≤8s, seamless loop (last frame matches first). Then encode:

```bash
# H.264 baseline
ffmpeg -i raw.mov -vf "crop=W:H:X:Y,scale=1600:-2,fps=30" \
  -c:v libx264 -crf 22 -pix_fmt yuv420p -movflags +faststart \
  -an /Users/ross/code/personal/rsml.github.io/media/<name>.mp4

# AV1 alternate (slower, run in background)
ffmpeg -i raw.mov -vf "crop=W:H:X:Y,scale=1600:-2,fps=30" \
  -c:v libsvtav1 -crf 30 -movflags +faststart -an \
  /Users/ross/code/personal/rsml.github.io/media/<name>.av1.mp4

# Poster (grab a punchy single frame)
ffmpeg -i raw.mov -ss 00:00:02 -vframes 1 /tmp/poster.png
cwebp -q 80 /tmp/poster.png -o /Users/ross/code/personal/rsml.github.io/media/<name>-poster.webp
```

Recording order and target durations:

| # | Filename root | Source | Frame | Duration | Capture |
|---|---|---|---|---|---|
| G3 | `chord-hero` | chordcolors.com | 16:10 | 10s loop, I-IV-V-vi progression | 1.5h |
| G4 | `tutor-hero` | rossmiller.dev/tutor live | 16:10 | 12s loop, book title → 3 chapters generating + one inline chat | 1.5h |
| G5 | `forge-loop` | Forge running 2 agents | 16:10 | 6s loop | 0.7h |
| G6 | `tutor-card-loop` | Tutor (zoomed UX of one panel) | 16:10 | 6s loop | 0.7h |
| G7 | `vivy-loop` | App Store recordings reused if possible | 9:19.5 | 6s loop | 0.7h |
| G8 | `chord-card-loop` | Chord Colors iOS phone | 9:19.5 | 6s loop | 0.7h |
| G9 | `symphony-loop` (P1) | iPad simulator | varies | 6s loop | 0.7h |
| G10 | `openpath-loop` (P1) | Admin dashboard tour | 16:10 | 6s loop | 0.5h |

After each clip lands in `/media/`, you can either batch-wire later or fire the wiring prompt now (see Phase 3). The AI can wire clip-by-clip.

### Track AI — runs in parallel while you capture

Paste this once at the start of your capture session. The AI will work for ~4h on `/system/` content while you record. This work has zero dependency on your videos.

#### 💬 TELL THIS TO AI

```
Phase 2 of the portfolio rebuild. Ross is in a capture session, you work on /system/ in parallel. Do not touch index.html or /media/ during this phase.

Build out /system/index.html progressively. The page was scaffolded with empty sections in Phase 0. Fill them in this order:

A. #space (Space and hairlines)
   - A visual 4-grid ruler showing --s-1 (4px), --s-2 (8px), --s-3 (12px), --s-4 (16px), --s-5 (24px), --s-6 (32px), --s-7 (48px), --s-8 (64px). Render as 8 horizontal bars labeled with token name + pixel value.
   - Hairline demo: a 1px line at oklch(... / 0.14) on bg, with a code chip showing the variable name. Click the line → copy --hair value to clipboard, toast appears.
   - --measure 72ch demo: render a paragraph of placeholder text constrained to 72ch.

B. #primitives (Primitives)
   - Six live components in a 2-column grid: Button, Input, Card, Pill, Chip, Focus ring demo.
   - Each component is rendered using the page's tokens. Below each, a <pre> code chip shows the CSS variables consumed by that component (--ink, --bg, --hair, --focus, --motion-fast, --ease).
   - Components must respond to hover and focus correctly.

C. #motion (Motion)
   - Three small squares animate left-to-right using --motion-fast / --motion-med / --motion-slow. Each labeled with its token name and ms value.
   - A "Play again" button restarts all three simultaneously (toggle a class off, then on, in next frame).
   - Below: a small visualization of cubic-bezier(0.2, 0.7, 0.1, 1) — a curve drawn in SVG with the four control points labeled.

D. #color (Color)
   - Render a primitive tier (12-note chord-color row): 12 swatches at L=72 C=0.13, hue stepping 0, 30, 60, …, 330. Each swatch is a clickable button. Onclick: copy OKLCH value to clipboard. Onclick + shiftKey: copy nearest hex. Toast confirmation "copied" for 1.4s.
   - On hover each swatch slides up a small <dl> showing L / C / H values. Transition 220ms.
   - Render a semantic tier (--bg --ink --hair --muted --focus) below as five labeled pills, also click-to-copy.

E. #type (Type)
   - Instrument Sans specimen at 6 sizes: 72, 48, 32, 20, 16, 14. Same pangram on each: "Almost before we knew it, we had left the ground."
   - IBM Plex Mono specimen at 14, 13, 12 with a tabular-nums sample.
   - Range slider (input type=range, min 400, max 700) that updates a single specimen line's font-variation-settings 'wght'.

Do NOT yet build #premise (Ross will write copy in Phase 3) or #playground (Phase 4) or #principles footer (Phase 4).

Use only CSS, vanilla JS (no Motion One yet, not needed here), and the existing token set. Every interactive state must respect prefers-reduced-motion.

Show me a diff summary and a screenshot list of what each section looks like when done.
```

### 🛑 STOP — Each clip gates its own wiring (G3-G10)

You do not need a single hard stop here. Each clip lands → AI wires it. The fastest cadence is: record one clip → drop in `/media/` → paste the Phase 3 micro-prompt for that one clip → keep recording the next while AI wires.

If you batch all eight first, fine — paste the Phase 3 full-batch prompt instead.

---

## Phase 3 — Wire media and finish design system

**Goal:** Replace static posters with poster-then-loop `<video>` elements that play on scroll-in. Finish `/system/` color and type interactions. Integrate motion tokens globally.

### Track AI — full batch prompt

Paste once all P0 clips (chord-hero, tutor-hero, forge-loop, tutor-card-loop, vivy-loop, chord-card-loop) are in `/media/`. If you only have some, paste only the relevant section and re-prompt later for the rest.

#### 💬 TELL THIS TO AI

```
Phase 3 of the portfolio rebuild. /media/ now contains the P0 video assets. Wire them into index.html and finish the /system/ §0 and §1 content.

Part 1: Video wiring in index.html

For each project that has clips landed, replace its existing <img class="proj-poster"> with a <video> element:

<video class="proj-loop" poster="/media/<slug>-poster.webp"
       muted playsinline preload="none" loop>
  <source src="/media/<slug>-loop.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"'>
  <source src="/media/<slug>-loop.mp4" type="video/mp4">
</video>

Mapping (only wire projects whose clips exist in /media/):
- Chord Colors hero card (top, 16:10) → /media/chord-hero.mp4 + /media/chord-colors-poster.webp
- Tutor hero card (16:10) → /media/tutor-hero.mp4 + /media/tutor-poster.webp
- Forge card (16:10) → /media/forge-loop.mp4 + /media/forge-poster.webp
- Tutor card phone slot (9:19.5) → /media/tutor-card-loop.mp4 + /media/tutor-card-poster.webp
- Vivy card phone slot (9:19.5) → /media/vivy-loop.mp4 + /media/vivy-poster.webp
- Chord Colors phone slot (9:19.5) → /media/chord-card-loop.mp4 + /media/chord-card-poster.webp
- Symphony Pro / Openpath: skip if assets not present, keep static posters.

Add a single inline <script> at the end of <body>:
- IntersectionObserver with threshold 0.35, rootMargin "0px 0px -10% 0px"
- On entry: video.play() (catch + ignore promise rejection)
- On exit: video.pause()
- Bail entirely if matchMedia("(prefers-reduced-motion: reduce)").matches — leave videos with preload="none" and never autoplay; user can tap to play via the poster (no controls UI, but keep a CSS ::after "Tap to play" hint visible only on reduced-motion).
- Cross-fade poster to video over 320ms once `loadeddata` fires (set a .loaded class).

Part 2: Project hairline reveal on scroll (C4)

Replace `border-top: 1px solid var(--hair)` on .proj with a pseudo-element approach:
- .proj { position: relative; border-top: none; }
- .proj::before { content:""; position:absolute; top:0; left:0; height:1px; width:0; background: var(--hair); transition: width 700ms var(--ease); }
- IntersectionObserver adds .proj--seen → width: 100%.

Part 3: /system/ #premise (Section 0)

Render this paragraph in #premise:

<p>This site is the design system. The note-color mapping in <a href="https://chordcolors.app/">Chord Colors</a> maps 12 chromatic notes to 12 colors. That mapping IS the design system. Below: its anatomy, the typographic and spatial primitives this site is built from, and a live playground.</p>

Above the paragraph, render a small version chip: `<span class="version-chip">v0.1</span>`. Mono font, hairline border, --muted color.

Part 4: /system/ #color (Section 1) — already built in Phase 2. Verify D1 (click-to-copy) and D2 (hover OKLCH label) both still work after any Phase 2 refactor.

Part 5: Show me a diff summary, a screenshot for each new state on /system/ and / index.html, and run a quick Lighthouse audit. Report performance score and any failures.
```

### Track Ross — review and write `/system/` Premise copy

While AI wires, do these in any order (~1h total):
1. Open `localhost`, walk through each project card. Confirm clips loop seamlessly. If one is glitchy, re-record. Each retake is ~30 min round trip.
2. Write your version of the `/system/` Premise paragraph. AI used a default; replace with yours if you have one.
3. Eyeball the design system page on `/system/`. Does the color grid feel like Chord Colors or a generic Tailwind clone? If it feels generic, you need to provide your actual hue stops in G11.

### 🛑 STOP — Gate G11 (hue stops)

Before Phase 4 chord playground build, you must give the AI either:
- The 12-note hue mapping from the actual Chord Colors app (preferred), or
- A green light to derive 12 evenly-spaced OKLCH hues.

---

## Phase 4 — Playground, principles, polish

**Goal:** Ship the unique-wow chord playground, write the principles footer, audit. No Lab section to populate (dropped). Email is handled by Ross independently at send time.

### Track Ross — two deliverables before AI can finish

1. **Hue stops (G11):** Paste your real Chord Colors note → color mapping into the AI prompt below, or say "derive."
2. **Principles (G12):** Write 6 to 10 Rauno-style one-line rules. Examples (write your own, not these):
   - "OKLCH for everything."
   - "Hairlines always use alpha."
   - "Animations under 200ms or they feel slow."
   - "Tabular-nums in code, lining-nums in prose."
   - "Reduced-motion is a first-class citizen, not an afterthought."
   - "Sub-domain for live demos. Index is the sampler."

### Track AI — full batch prompt

Paste once you have hue stops and principles ready. Replace the two bracketed sections.

```
Phase 4 of the portfolio rebuild. Final batch.

Inputs from Ross:
- HUE_STOPS: [paste your 12-note → OKLCH hue mapping here, OR write "derive 12 evenly-spaced OKLCH hues at L=72 C=0.13"]
- PRINCIPLES (one per line, 6 to 10):
[paste your principles here]

Do all of the following:

1. /system/ #playground (Section 6) — the unique wow

Build a chord-picker component:
- A 12-button row of common chord qualities: C maj, D min, E min, F maj, G maj, A min, B dim, C7, D7, G7, F maj7, A min7 (adjust if HUE_STOPS implies a different chord set).
- On selection: 12 swatch tiles below animate their background-color from current to the chord's note-color set using HUE_STOPS. Each swatch shows the note name (C, C#, D, …) and its OKLCH value below.
- Active notes (those in the selected chord) light up to full saturation. Inactive notes drop to 25% lightness, dim.
- Below the swatches, a code block lists the active notes' OKLCH values, one per line, click-to-copy on each.
- URL hash sync: ?chord=Cmaj reflects state. Sharing the URL lands on that chord.
- Transitions: --motion-med (320ms) for color changes, --ease.

If HUE_STOPS was "derive", compute 12 hues at hue = i * 30 for i in 0..11, L=72%, C=0.13. Label them C, C#, D, D#, E, F, F#, G, G#, A, A#, B.

2. /system/ #principles (Footer)

Render PRINCIPLES as a numbered list. Mono font, --muted color, no bullets, just numbers 01, 02, etc. with 1ch separator. Each principle one line. Match the Rauno interfaces.rauno.me aesthetic.

3. index.html #footer — wire real commit hash

Add to Makefile a `build` target that runs `sed -i '' "s|<span data-commit>dev</span>|<span data-commit>$$(git rev-parse --short HEAD)</span>|" index.html` so the static-site commit hash gets injected at build time. Update README to document the build command.

4. Sticky hairline nav (E2)

Add a 32px-tall sticky <nav> with hairline border-bottom that appears once the hero scrolls past the viewport. Content: Chord · Tutor · Forge · Vivy · Symphony · Openpath · System — each linking to its anchor. Slide down from translateY(-100%) over 360ms when hero exits viewport (IntersectionObserver on .hero). Hide under 600px width.

5. Polish pass

- Open Lighthouse in Chrome DevTools; run audits for / and /system/. Target ≥95 on Performance, Accessibility, Best Practices, SEO. Fix anything below 95.
- Run pa11y or axe-core if available; fix any contrast or aria failures.
- Smoke test on Safari, Chrome, Firefox. Note any issues you cannot fix without my input.
- Verify all videos respect prefers-reduced-motion. Toggle the system setting and reload.
- Verify the design system page interactions all work under reduced motion (static fallbacks where animation was the affordance).

6. Update llms.txt and sitemap.xml

Reflect the new /system/ structure: list each anchor section as a navigable subroute in llms.txt. Update sitemap.xml's lastmod date.

7. Show me final diff summary, Lighthouse screenshots, and the URLs to spot-check.
```

### 🛑 STOP — Final QA before send

After AI finishes Phase 4:

1. **You walk the site as a stranger.** Open `localhost` in a private window. Scroll the homepage, click into every project, navigate to `/system/`, play with the chord picker, copy a swatch.
2. **Walk it on phone.** Pull up `192.168.x.y:8000` from your laptop on your phone (or use ngrok / cloudflared). Confirm posters look fine, videos play on scroll, nav stays out of the way.
3. **Walk it with reduced-motion on.** macOS System Settings > Accessibility > Display > Reduce motion. Reload. Confirm posters never auto-swap to video, focus rings still work, color swatches are still copyable.
4. **Walk it with screen reader on.** macOS VoiceOver (Cmd+F5). Tab through hero, project cards, system swatches. Confirm alt text and aria-labels are correct.

If anything is off, fire a one-line AI prompt: "Fix [specific thing]." Iterate until clean.

### Ship

Email tone and timing is your call (Q7 deferred). When you do send, useful artifact to have ready: a GIF inline preview of the chord-cascade hero.

```bash
ffmpeg -i /Users/ross/code/personal/rsml.github.io/media/chord-hero.mp4 \
  -vf "fps=24,scale=600:-1" -loop 0 /tmp/chord-cascade.gif
```

Optional follow-up: ping Jaspar on LinkedIn with a one-liner.

---

## Cut list (if time runs short)

### 3-day version
Drop: `/system/` §3 Space, §4 Primitives, §5 Motion (replace with one-line "more coming" stub). B1' Symphony + Openpath video clips (static posters only). C2 taglist shimmer, C5 avatar breathe, E2 sticky nav, D3 type slider, D4 motion playground.

Keep: Phase 0+1+2 (P0 captures only) + Phase 3 partial + Phase 4 chord playground + principles.

### Emergency 1.5-day "send today" version
Keep only:
- Phase 0 token additions + scaffolding.
- Phase 1 reorder + rewritten descriptions + static posters from existing screenshots.
- One A1 chord-hero clip (~1.5h capture + 30min wire). Skip A2 and all B1.
- `/system/` §1 Color (click-to-copy) + §6 Chord playground only. Skip all other system sections.
- Footer with Now + Updated.

This is still meaningfully better than the current site.

---

## Inspiration citations (for your reference)

- **Samuel Kraft** (samuelkraft.com) — closest structural fit, the skeleton being copied
- **Rauno Freiberg** (rauno.me) — manifesto stack, taste discipline, interfaces.rauno.me as principles model
- **Emil Kowalski** (emilkowal.ski) — portfolio as sampler, demos on sub-domains
- **Maxime Heckel** (blog.maximeheckel.com/design/) — template for the `/system/` page section order
- **Tailwind v4 Colors** (tailwindcss.com/docs/colors) — click-to-copy OKLCH gold standard
- **Vercel Geist** (vercel.com/geist/colors) — semantic token tiering
- **Radix Colors** (radix-ui.com/colors) — 12-step usage taxonomy
- **Paco Coursey** (paco.me) — "Now" section pattern
- **Benji Taylor** (benji.org) — "Updated [date]" pattern
- **Henry Heffernan** (henryheffernan.com) — edge case; reference only for the easter-egg-hidden-demo idea

---

## File reference

- `/Users/ross/code/personal/rsml.github.io/index.html` — single-file homepage. Tokens 162-205, hero 540-571, work 573-922, commented `.proj-media` at e.g. 627-644 is the wiring point for every project's media block.
- `/Users/ross/code/personal/rsml.github.io/system/index.html` — to be created, design system page.
- `/Users/ross/code/personal/rsml.github.io/media/` — to be created, all video + poster assets.
- `/Users/ross/code/personal/rsml.github.io/tutor/screenshots/` — Tutor PNG fallbacks for Phase 1 static posters.
- `/Users/ross/code/personal/rsml.github.io/forge/screenshots/` — Forge PNG fallbacks.
- `/Users/ross/code/personal/rsml.github.io/games/` — 12 folders, source of Lab strip + thumbnails.
- `/Users/ross/code/personal/rsml.github.io/sitemap.xml` — append /system/.
- `/Users/ross/code/personal/rsml.github.io/llms.txt` — append /system/ section.
- `/Users/ross/code/personal/rsml.github.io/Makefile` — extend with build hash injection in Phase 4.
