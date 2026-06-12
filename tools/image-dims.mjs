/**
 * Build-time image dimension reader used by WorkRow.astro to emit width/height
 * HTML attributes on strip thumbnails. Reads only the image header (fast).
 *
 * Returns undefined for external URLs (except YouTube, which are hardcoded
 * 320x180) and for files that don't exist or can't be probed.
 */
import { existsSync } from 'node:fs';

let sharp;

/** @returns {{ width: number, height: number } | undefined} */
export async function getDims(src) {
  if (src.startsWith('https://i.ytimg.com/')) return { width: 320, height: 180 };
  if (!src.startsWith('/')) return undefined;
  const abs = `${process.cwd()}/public${src}`;
  if (!existsSync(abs)) return undefined;
  try {
    if (!sharp) sharp = (await import('sharp')).default;
    const { width, height } = await sharp(abs).metadata();
    return width && height ? { width, height } : undefined;
  } catch {
    return undefined;
  }
}
