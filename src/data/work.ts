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
