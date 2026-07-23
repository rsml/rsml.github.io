#!/usr/bin/env node
/**
 * Generates the Open Graph social cards, the images that unfurl when a link to
 * this site is pasted into LinkedIn, X, Slack, or iMessage.
 *
 * Run `pnpm og` after adding an essay or a case study, then commit the PNGs.
 * This is a manual generator, like `pnpm favicons`, not part of `astro build`.
 * Cards change rarely and the output is committed, so paying the cost on every
 * CI build would buy nothing.
 *
 * ## Why headless Chrome and not satori
 *
 * The site's only font files are WOFF2, which satori cannot read. Chrome reads
 * WOFF2 natively and applies the same font, tracking, and antialiasing the real
 * site uses, so a card is guaranteed to look like the site rather than an
 * approximation of it. The repo already screenshots with headless Chrome in
 * tools/editor/server.ts, so this reuses a pattern rather than adding one.
 *
 * Fonts and images are inlined as data URIs. A file:// page cannot reliably
 * load sibling file:// subresources, and embedding sidesteps the whole issue.
 *
 * ## Design
 *
 * Dieter Rams by way of the site's own tokens. One white field, Inter, a strict
 * 72px margin, and a single hairline that turns the footer into a measured
 * scale rather than decoration. The twelve ticks are the Chord Colors palette
 * in Circle of Fifths order, which is what makes the ramp read as a spectrum
 * instead of a random rainbow. They sit ON the rule, like gradations on a Braun
 * dial, which is the difference between a mark and a sticker.
 *
 * Output: 1200x630 (the OG standard), captured at 2x and downsampled so the
 * type edges stay clean.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import sharp from 'sharp';
import yaml from 'js-yaml';

const execFileP = promisify(execFile);
const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');
const OUT_DIR = join(PUBLIC, 'og');
const TMP = join(ROOT, 'node_modules', '.cache', 'og');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1200;
const H = 630;

/**
 * The Chord Colors palette in Circle of Fifths order (C clockwise to F), which
 * steps evenly through the spectrum. Chromatic order would zigzag. The same
 * twelve values live in src/scripts/sim-controls-core.ts, keyed by note.
 */
const SPECTRUM = [
  '#FF0000', '#FF5900', '#FF8F00', '#FFC400', '#FEFF00', '#78CB00',
  '#00B200', '#00A5CB', '#0063BB', '#0800AC', '#6E00AC', '#D7007F',
];

// Site tokens, mirrored from src/styles/global.css. Cards are always light.
const INK = 'rgb(17, 17, 17)';
const MUTED = 'rgb(110, 110, 110)';
const HAIR = 'rgba(17, 17, 17, 0.10)';

const dataUri = (path, mime) =>
  `data:${mime};base64,${readFileSync(join(PUBLIC, path)).toString('base64')}`;

const FONT = dataUri('fonts/InterVariable.woff2', 'font/woff2');

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Shared chrome: the reset, the font face, and the footer scale. */
const shell = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face {
    font-family: 'Inter';
    src: url('${FONT}') format('woff2');
    font-weight: 100 900;
    font-display: block;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; }
  body {
    background: #fff;
    color: ${INK};
    font-family: 'Inter';
    font-weight: 460;
    /* Match the site's optical settings so type renders identically. */
    -webkit-font-smoothing: antialiased;
    font-synthesis: none;
  }
  .card { width: ${W}px; height: ${H}px; display: flex; }
  /* The typographic column. 72px margin on every side, nothing breaks it. */
  .panel {
    flex: 1; min-width: 0;
    padding: 72px;
    display: flex; flex-direction: column;
  }
  .eyebrow {
    font-size: 15px; font-weight: 600; letter-spacing: 0.16em;
    text-transform: uppercase; color: ${MUTED};
  }
  /* Titles carry the site's tight display tracking. Balanced wrapping splits a
     line into even halves instead of leaving one orphaned word on line two,
     which is the difference between typeset and merely wrapped. */
  .title { font-weight: 600; letter-spacing: -0.035em; line-height: 1.02; text-wrap: balance; }
  .subtitle { color: ${MUTED}; letter-spacing: -0.011em; text-wrap: balance; }
  .spacer { flex: 1; }
  /* The rule plus the twelve gradations. Ticks sit on the line, not near it. */
  .rule { height: 1px; background: ${HAIR}; }
  .foot {
    margin-top: 18px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .ticks { display: flex; gap: 5px; }
  .tick { width: 20px; height: 6px; border-radius: 1px; }
  .meta { font-size: 19px; font-weight: 500; color: ${MUTED}; letter-spacing: -0.01em; }
</style></head><body>${body}</body></html>`;

const footer = (meta) => `
  <div class="rule"></div>
  <div class="foot">
    <div class="ticks">${SPECTRUM.map((c) => `<div class="tick" style="background:${c}"></div>`).join('')}</div>
    <div class="meta">${esc(meta)}</div>
  </div>`;

/**
 * Identity card. Used as the default for every page without one of its own, so
 * it has to work standing alone. Name large, role quiet, everything else silent.
 */
const identityCard = ({ title, subtitle, meta }) => shell(`
  <div class="card"><div class="panel">
    <div class="spacer"></div>
    <div class="title" style="font-size:86px">${esc(title)}</div>
    <div class="subtitle" style="font-size:30px; margin-top:20px">${esc(subtitle)}</div>
    <div class="spacer"></div>
    ${footer(meta)}
  </div></div>`);

/**
 * Essay card. The title is the whole point, so it gets the space and the
 * description sits under it as a quiet second line. The eyebrow labels the kind
 * of thing this is, the way Braun labels a control.
 */
const essayCard = ({ eyebrow, title, subtitle, meta }) => shell(`
  <div class="card"><div class="panel">
    <div class="eyebrow">${esc(eyebrow)}</div>
    <div class="spacer"></div>
    <div class="title" style="font-size:62px; line-height:1.1">${esc(title)}</div>
    ${subtitle ? `<div class="subtitle" style="font-size:26px; line-height:1.45; margin-top:24px; max-width:900px">${esc(subtitle)}</div>` : ''}
    <div class="spacer"></div>
    ${footer(meta)}
  </div></div>`);

/**
 * Case study card. The product photograph earns the left edge full bleed, no
 * frame and no drop shadow, because the honest thing is to show the work at the
 * largest size the format allows. Type takes the right column on the same grid.
 */
const caseStudyCard = ({ image, focus, eyebrow, title, subtitle, meta }) => shell(`
  <div class="card">
    <div style="width:480px; height:${H}px; flex:none; position:relative; background:#f1f1f1">
      <img src="${image}" style="width:100%; height:100%; object-fit:cover; object-position:${focus}; display:block">
      <!-- Hairline seam so a pale photo still resolves against the white panel. -->
      <div style="position:absolute; top:0; right:0; width:1px; height:100%; background:${HAIR}"></div>
    </div>
    <div class="panel">
      <div class="eyebrow">${esc(eyebrow)}</div>
      <div class="spacer"></div>
      <div class="title" style="font-size:58px">${esc(title)}</div>
      <div class="subtitle" style="font-size:26px; line-height:1.45; margin-top:22px">${esc(subtitle)}</div>
      <div class="spacer"></div>
      ${footer(meta)}
    </div>
  </div>`);

const SITE = 'rossmiller.dev';
const BYLINE = `Ross Miller · ${SITE}`;

/**
 * Case-study copy is deliberately not work.yaml's copy. A social card is read
 * cold by someone who has never heard of the project, so it says what the thing
 * IS, where the site can assume more context.
 */
const CASE_STUDIES = [
  {
    slug: 'forge',
    out: 'forge',
    eyebrow: 'macOS app',
    title: 'Forge',
    subtitle: 'Run many AI coding agents at once, and know the moment one needs you',
    // Stack mode, cropped onto the agent transcript. The old card pointed at
    // list-mode, which is a near empty terminal and reads as a black rectangle.
    image: '/forge/screenshots/stack-mode-2-poster.webp',
    // Hard left, so the crop is all agent transcript. Any further right and it
    // clips the browser pane and the card turns into two half-things.
    focus: '3% 48%',
  },
  {
    slug: 'chord-colors',
    title: 'Chord Colors',
    subtitle: 'Explore music theory interactively on web and iOS',
    image: '/chord-colors/chordcolors-wheel.webp',
    focus: '52% 50%',
  },
  {
    slug: 'tutor',
    title: 'Tutor',
    subtitle: 'Books that learn how you learn',
    // The New Book dialog, not the library grid. A narrow crop needs a single
    // central subject, and a wall of book covers just gets sliced in half at
    // both edges. This one also happens to show what the product does.
    image: '/tutor/screenshots/book-generation-poster.webp',
    focus: '50% 50%',
  },
];

/** Reads title and description straight out of the essay frontmatter. */
function essays() {
  const dir = join(ROOT, 'src', 'content', 'writing');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f) && !f.startsWith('_'))
    .map((f) => {
      const raw = readFileSync(join(dir, f), 'utf8');
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      const data = fm ? yaml.load(fm[1]) : {};
      return { slug: f.replace(/\.mdx?$/, ''), ...data };
    });
}

/** Renders one HTML string to a PNG at exactly W x H. */
async function shoot(html, outPath, label) {
  mkdirSync(TMP, { recursive: true });
  const htmlPath = join(TMP, 'card.html');
  const rawPath = join(TMP, 'card@2x.png');
  writeFileSync(htmlPath, html);
  rmSync(rawPath, { force: true });

  await execFileP(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${W},${H}`,
    // Capture at 2x and downsample, which keeps the type edges clean.
    '--force-device-scale-factor=2',
    '--virtual-time-budget=4000',
    `--screenshot=${rawPath}`,
    `file://${htmlPath}`,
  ], { timeout: 30_000 });

  if (!existsSync(rawPath)) throw new Error(`Chrome produced no screenshot for ${label}`);
  await sharp(rawPath).resize(W, H, { fit: 'fill' }).png({ compressionLevel: 9 }).toFile(outPath);
  const kb = Math.round(readFileSync(outPath).byteLength / 1024);
  console.log(`  ${label.padEnd(42)} -> ${outPath.replace(ROOT + '/', '')} (${kb} KB)`);
}

async function main() {
  if (!existsSync(CHROME)) {
    console.error(`headless Chrome not found at ${CHROME}`);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  console.log('Generating Open Graph cards\n');

  // The identity card keeps the historical /og.png path so links already shared
  // and cached by LinkedIn or X pick up the new art instead of breaking.
  await shoot(
    identityCard({
      title: 'Ross Miller',
      // Matches the site's own hero line rather than inventing a second tagline.
      subtitle: 'Developer, designer, 4x founder',
      meta: SITE,
    }),
    join(PUBLIC, 'og.png'),
    'identity',
  );

  for (const e of essays()) {
    await shoot(
      essayCard({ eyebrow: 'Essay', title: e.title, subtitle: e.description, meta: BYLINE }),
      join(OUT_DIR, `writing-${e.slug}.png`),
      `essay: ${e.slug}`,
    );
  }

  for (const c of CASE_STUDIES) {
    const name = c.out ?? `craft-${c.slug}`;
    await shoot(
      caseStudyCard({
        eyebrow: c.eyebrow ?? 'Case study',
        title: c.title,
        subtitle: c.subtitle,
        image: dataUri(c.image.replace(/^\//, ''), 'image/webp'),
        focus: c.focus,
        meta: BYLINE,
      }),
      join(OUT_DIR, `${name}.png`),
      `card: ${c.slug}`,
    );
  }

  rmSync(TMP, { recursive: true, force: true });
  console.log('\nDone. Commit the PNGs.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
