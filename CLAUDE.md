# rsml.github.io: Ross Miller's portfolio

Astro static site (SSG). Deploys to GitHub Pages via GitHub Actions on push to `master`.

## Commands

- `pnpm dev` local preview (http://localhost:4321)
- `pnpm editor` local visual editor for `work.yaml` (http://127.0.0.1:4399): drag-reorder
  projects/images/links, drop images, videos, or PDFs in almost any format to add them
  (non-web formats are transcoded on the way in: video like MOV/AVI to web-ready H.264
  MP4 via ffmpeg, images like HEIC/TIFF to JPEG via sips; video + PDF posters render via
  ffmpeg/sips; ⌖ frame on any video scrubs to re-pick its thumbnail frame), add YouTube
  or web-view assets by URL (web-view posters screenshot via headless Chrome), edit text
  fields. Dev-only (`tools/editor/`), never ships. (Named `editor` because pnpm hands
  `edit` to npm.)
- `pnpm optimize` (or `pnpm optimize --dry` to preview) compresses every asset the
  site references, in place: videos to web-safe H.264 MP4 (orientation picks the
  profile; long edge capped at 1920 and level pinned to High@5.1 because iPhone
  hardware decoders stop at Level 5.2; re-runs skip marked in-spec files via an
  embedded marker and re-encode anything outside that spec, so out-of-spec files
  self-heal), and every display image (posters plus full-size lightbox and page
  screenshots) re-derived FROM its raw master in `masters/`, capped to 1920px
  long edge as lossy WebP q80 with an `.avif` sibling (q55, effort 9, 4:4:4) that
  a `<picture>` serves first and the WebP backs up. Compressing from the master,
  not the already-lossy public file, keeps re-runs idempotent (a quality tweak
  re-derives cleanly, never compounding loss); a WebP-only master (no lossless
  raw survived) keeps its WebP and only gains an AVIF. Renames rewrite work.yaml
  and the .astro files; originals are backed up to `public-backup-<timestamp>/`
  (gitignored).
  It also generates strip-thumbnail sidecars (WebP + AVIF, 1x and 2x DPR:
  `<name>-thumb.webp`, `<name>-thumb-1x.webp`, and `.avif` twins) scaled to the
  project's `shotHeight`, plus app-icon logo sidecars. Every render site
  (WorkRow, Lightbox, case-study and landing pages) serves images through an
  inline `<picture>` built by `src/lib/pictureSource.ts`, which uses the AVIF
  when the sibling exists and falls back to the WebP otherwise. Derived files
  (thumbs, logos, `.avif`) are excluded from the orphan report. Settings and
  rationale live in `tools/optimize-portfolio.mjs`. Needs ffmpeg.
- `masters/` is the committed raw store (repo root, so it is versioned but never
  ships to the deployed site). `pnpm optimize` compresses every display image
  FROM it, so images can always be re-derived from the original. Populate or
  refresh it with `node tools/consolidate-masters.mjs`, which recovers the
  truest raw of each asset from the `public-backup-*` dirs, falling back to the
  current public file when no lossless raw survives.
- `pnpm push-chunked` pushes the current branch in <= 40 MB slices via a
  throwaway seed branch, then the real push sends almost nothing
  (`--chunk-mb N` to change the slice size). Use it when a plain `git push`
  with new media dies mid-upload ("broken pipe" / "RPC failed"): some
  networks reset large sustained uploads. A single file can't be sliced, so
  one bigger than the network can sustain has to be shrunk, not re-pushed.
- `pnpm favicons` regenerates the rasterized icons from `public/favicon.svg`
  (the single source of truth). Writes `favicon.ico` (16/32/48, transparent,
  matching the SVG so the tab icon is identical whichever file a browser picks)
  and `apple-touch-icon.png` (180px, opaque tile on `#111111` because iOS turns
  transparency black and masks its own corners). The mark and brand color come
  from the SVG; only the touch-tile background lives in the script. Run after
  editing `favicon.svg`. Settings live in `tools/gen-favicons.mjs`. Needs sharp
  (already a devDependency).
- `pnpm build` static build to `dist/`
- `pnpm check` Astro + TypeScript diagnostics
- `pnpm test` Vitest unit tests

## Editing the projects (the part you usually want)

All project content lives in ONE file: **`src/data/work.yaml`**. It is the single
source of truth for every project's title, subtitle, role, description, links, and
gallery assets (plus device, transition, ripple, and marketing fields).

- To add, remove, reorder, or edit a project, edit `work.yaml`. Projects appear on
  the home page in the order they are listed. Nothing else needs editing.
- Prefer a GUI? `pnpm editor` serves a local drag-and-drop editor for the same
  file. It preserves the YAML comments and writes through the same Zod schema.
- The file's header comment documents every field. Read it before editing.
- Do NOT edit `src/data/work.ts` or `src/data/schema.ts` for content. `schema.ts`
  is the Zod schema (the one definition of a project's shape; a typo or missing
  field fails `pnpm build` / `pnpm check` with a precise message, and the types
  are inferred from it). `work.ts` is the loader that applies it to the YAML.
  Touch `schema.ts` only to change the shape itself.

### Links

A project's `links:` is a list of `{ label, href }`. Just paste the URL. The arrow
and new-tab behavior are derived from it: an `href` starting with `/` is an internal
page (renders a right arrow), and one starting with `http` is external (renders an
up-right arrow and opens in a new tab).

### Gallery assets

A project's `assets:` is the gallery shown in the home-row strip and the full-screen
lightbox. Put the files in `public/` and reference them by absolute path (e.g.
`/tutor/screenshots/library.png`). Each asset is `{ type, src, alt, orientation, poster? }`:

| `type`    | what it is                                           | `poster`  |
|-----------|------------------------------------------------------|-----------|
| `image`   | a PNG/JPG screenshot                                 | optional  |
| `gif`     | an animated GIF (autoplays)                          | optional  |
| `video`   | an MP4/WebM, played with the Plyr player             | REQUIRED  |
| `youtube` | a YouTube video (by URL or id), played through Plyr  | auto      |
| `embed`   | a live web view / interactive demo (lazy `<iframe>`) | REQUIRED  |
| `pdf`     | a PDF document (native viewer, same lazy `<iframe>`) | REQUIRED  |

`poster` is the still shown in the strip; it is required for `video` and `embed`
because a clip/live page can't be a thumbnail. For `youtube`, `src` is the video
URL or id (e.g. `https://www.youtube.com/embed/ID` or just `ID`) and the poster is
derived from the id automatically (you can still set one to override). `orientation`
(`portrait` or `landscape`; YouTube is `landscape`) drives the strip sizing and
lightbox framing, so keep a project's assets homogeneous. `type` defaults to `image`.

## Architecture and gotchas

- Data flow: `work.yaml` to `work.ts` (Zod validate + type infer; exports
  `WORK` / `getWork` / `getProject`) to `index.astro`, `work/[slug].astro`,
  `WorkRow.astro`, and `Lightbox.astro`.
- `work.ts` is BUILD-TIME only (server). Do not import it as a *value* from a client
  `<script>`: it reads the YAML via Vite `?raw`, so a client value-import would pull
  the parser into the browser bundle. Import only its *types* from the client. For
  example, `src/scripts/ripple-nav.ts` reads its ripple config from a `data-ripple`
  DOM attribute and imports `work.ts` types only.
- The lightbox (`Lightbox.astro`) renders image/gif as `<img>`, `video` with Plyr
  (the `plyr` dep, themed via `--plyr-*` CSS vars), and `embed` as an iframe that
  is loaded only while its project is the open slide (and blanked on leave/close).

## Conventions

- No em-dashes anywhere, including code comments and content. Use periods, commas,
  or parentheses instead. (Owner preference.)
