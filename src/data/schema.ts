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
 *   pdf     a PDF document, shown through the same lazy <iframe> path as
 *           `embed` (the browser's native PDF viewer).
 */
const AssetTypeSchema = z.enum(['image', 'gif', 'video', 'youtube', 'embed', 'pdf']);

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
  })
  .refine((a) => !(a.type === 'pdf' && !a.poster), {
    message: 'a `pdf` asset needs a `poster` (a document cannot be a strip thumbnail; `pnpm editor` renders one automatically on drop)',
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
  /** Optional freeform display date ("2024", "2019-2021", "2018-present"), shown after the role. */
  date: z.string().optional(),
  cardDesc: z.string(),
  /** One-sentence explainer (kept for meta/reuse; not shown on the row). */
  blurb: z.string(),
  device: DeviceSchema,
  thumbClass: z.string(), // e.g. "thumb-chord" (drives Thumb.astro variant)
  thumbImage: z.string().optional(), // e.g. "/logos/chord-colors.jpg"
  transition: TransitionSchema,
  /** Prepends a "Deep dive" link (to /craft/<slug>/) on the home row + lightbox. */
  deepDive: z.boolean().default(false),
  /** Platform/store links on the home row + the lightbox "Links" dropdown. */
  links: z.array(LinkSchema).default([]),
  /** Gallery shown in the home row's strip and the lightbox. */
  assets: z.array(AssetSchema).default([]),
  /** Height (px) of every thumbnail in this project's home-row strip; widths follow each asset's aspect. */
  shotHeight: z.number().int().positive().default(200),
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
