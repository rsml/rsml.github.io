/**
 * Build-time helper for AVIF <picture> sources.
 *
 * Given a webp `src` under public/ (and optionally its webp `srcset` for DPR
 * variants), returns the matching AVIF `srcset` to put on a
 * <picture><source type="image/avif">, or null when the `.avif` sibling(s) do
 * not exist on disk (so the caller renders a plain <img> and never emits a
 * <source> that would 404). AVIF siblings are produced by `pnpm optimize`
 * (see avifPath: shot.webp -> shot.avif).
 *
 * Server-only: it reads the filesystem, so import it in .astro frontmatter,
 * never a client <script>.
 */
import { existsSync } from 'node:fs';
import { avifPath } from '../../tools/optimize-portfolio.mjs';

/** The `.avif` sibling path for one webp ref if it exists on disk, else null. */
function localAvif(ref: string): string | null {
  if (!ref.startsWith('/')) return null;
  const avif = avifPath(ref);
  return existsSync(`${process.cwd()}/public${avif}`) ? avif : null;
}

/**
 * The AVIF `srcset` for a <source>, or null when any webp entry lacks its avif
 * sibling. Pass the same `srcset` you put on the <img> (DPR descriptors are
 * preserved); omit it for a single-image case and only `src` is mapped.
 */
export function avifSourceFor(src: string, srcset?: string): string | null {
  if (srcset) {
    const mapped = srcset
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
      .map((entry) => {
        const [p, descriptor] = entry.split(/\s+/);
        const avif = localAvif(p);
        return avif ? (descriptor ? `${avif} ${descriptor}` : avif) : null;
      });
    return mapped.length && mapped.every(Boolean) ? mapped.join(', ') : null;
  }
  return localAvif(src);
}
