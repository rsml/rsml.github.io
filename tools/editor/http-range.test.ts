import { describe, expect, it } from 'vitest';
import { parseRange } from './http-range.ts';

// size 100 file: valid offsets are 0..99.
describe('parseRange', () => {
  it('returns null when there is no Range header (plain 200)', () => {
    expect(parseRange(undefined, 100)).toBeNull();
  });

  it('parses an open-ended range (what Chrome sends first for media)', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=40-', 100)).toEqual({ start: 40, end: 99 });
  });

  it('parses a bounded range, inclusive on both ends', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=0-0', 100)).toEqual({ start: 0, end: 0 });
  });

  it('clamps an end past EOF to the last byte', () => {
    expect(parseRange('bytes=10-999', 100)).toEqual({ start: 10, end: 99 });
  });

  it('parses a suffix range (last N bytes, used for tail moov atoms)', () => {
    expect(parseRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
    expect(parseRange('bytes=-200', 100)).toEqual({ start: 0, end: 99 });
  });

  it('is unsatisfiable when the start is at or past EOF (416)', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
  });

  it('ignores malformed or unsupported headers (serve a full 200 instead)', () => {
    expect(parseRange('bytes=-', 100)).toBeNull(); // no numbers at all
    expect(parseRange('bytes=20-10', 100)).toBeNull(); // inverted
    expect(parseRange('apples=0-5', 100)).toBeNull(); // unknown unit
    expect(parseRange('bytes=0-5,10-15', 100)).toBeNull(); // multipart: not needed for <video>
    expect(parseRange('bytes=abc-def', 100)).toBeNull();
  });
});
