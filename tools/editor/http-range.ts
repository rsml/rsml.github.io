/**
 * HTTP Range header parsing for the editor's static file server (pure; the
 * server does the I/O). Chrome will not scrub a <video> whose file is served
 * as a length-less 200, so media needs real 206 responses; this implements
 * the single-range `bytes=` subset browsers actually send. Multipart ranges
 * and If-Range are deliberately out of scope: per RFC 9110 a server MAY
 * ignore Range, so anything unsupported falls back to a full 200 (`null`).
 */
export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * Resolve a Range header against a file of `size` bytes.
 * Returns inclusive byte offsets for a 206, 'unsatisfiable' for a 416, or
 * null when the request should just get the whole file as a 200.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, first, last] = m;
  if (first === '' && last === '') return null;

  let start: number;
  let end: number;
  if (first === '') {
    // Suffix form `bytes=-N`: the last N bytes. N=0 is an empty range (416).
    const n = Number(last);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(first);
    end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  }
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null; // inverted range: invalid per RFC, ignore it
  return { start, end };
}
