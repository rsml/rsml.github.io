import { describe, expect, it } from 'vitest';
import {
  MARKER, classifyVideo, encodeArgs, extractChromeRefs, extractRefs,
  findCollisions, outputFps, remuxArgs, rewriteRefs, targetPath,
} from './optimize-portfolio.mjs';

describe('extractRefs', () => {
  it('finds unquoted yaml paths and quoted astro paths, deduped and sorted', () => {
    const yaml = 'assets:\n  - src: /chord-colors/wheel.MOV\n    poster: /chord-colors/wheel-poster.png\n';
    const astro = '<img src="/tutor/screenshots/library.png" /> <img src="/tutor/screenshots/library.png" />';
    expect(extractRefs(yaml)).toEqual(['/chord-colors/wheel-poster.png', '/chord-colors/wheel.MOV']);
    expect(extractRefs(astro)).toEqual(['/tutor/screenshots/library.png']);
  });

  it('ignores site-chrome lines and excluded folders', () => {
    const text = [
      '<meta property="og:image" content="/og.png" />',
      '<meta name="twitter:image" content="/card.png" />',
      '<link rel="icon" href="/favicon.png" />',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
      '<img src="/games/snake/board.png" />',
      '<img src="/fonts/specimen.png" />',
      '<img src="/forge/screenshots/list-mode.png" />',
    ].join('\n');
    expect(extractRefs(text)).toEqual(['/forge/screenshots/list-mode.png']);
  });

  it('does not match external urls or extension-less paths', () => {
    expect(extractRefs('href: https://example.com/x.png and /work/chord-colors/ page')).toEqual([]);
  });
});

describe('extractChromeRefs', () => {
  it('captures paths used by og/twitter/icon lines, including absolute urls', () => {
    const text = [
      '<meta property="og:image" content="https://rossmiller.dev/forge/screenshots/list-mode.png" />',
      '<link rel="icon" href="/favicon.png" />',
      '<img src="/forge/screenshots/list-mode.png" />',
    ].join('\n');
    expect(extractChromeRefs(text)).toEqual(['/favicon.png', '/forge/screenshots/list-mode.png']);
  });
});

describe('targetPath', () => {
  it('normalizes videos to lowercase .mp4 and PNG/GIF to .webp', () => {
    expect(targetPath('/a/Clip.MOV')).toBe('/a/Clip.mp4');
    expect(targetPath('/a/clip.m4v')).toBe('/a/clip.mp4');
    expect(targetPath('/a/shot.PNG')).toBe('/a/shot.webp');
    expect(targetPath('/a/loop.gif')).toBe('/a/loop.webp');
  });

  it('leaves jpg, webp, and already-mp4 names alone', () => {
    expect(targetPath('/a/photo.jpg')).toBe('/a/photo.jpg');
    expect(targetPath('/a/done.webp')).toBe('/a/done.webp');
    expect(targetPath('/a/video.mp4')).toBe('/a/video.mp4');
  });
});

describe('classifyVideo', () => {
  const base = { codec: 'h264', pixFmt: 'yuv420p', width: 1920, height: 1080, marker: false };

  it('skips marked files', () => {
    expect(classifyVideo({ ...base, marker: true }).action).toBe('skip');
  });

  it('picks the profile by orientation, square counts as portrait', () => {
    expect(classifyVideo({ ...base, width: 1320, height: 2868 })).toMatchObject({ profile: 'portrait', crf: 24 });
    expect(classifyVideo({ ...base, width: 2560, height: 1600 })).toMatchObject({ profile: 'landscape', crf: 23 });
    expect(classifyVideo({ ...base, width: 1000, height: 1000 })).toMatchObject({ profile: 'portrait' });
  });

  it('forces conversion for wrong codec or pixel format, not for clean h264', () => {
    expect(classifyVideo({ ...base, codec: 'hevc' }).forceConvert).toBe(true);
    expect(classifyVideo({ ...base, pixFmt: 'yuv420p10le' }).forceConvert).toBe(true);
    expect(classifyVideo(base).forceConvert).toBe(false);
  });
});

describe('outputFps', () => {
  it('caps at 60 and never raises a lower rate', () => {
    expect(outputFps(120)).toBe(60);
    expect(outputFps(59.94)).toBe(60);
    expect(outputFps(30)).toBe(30);
    expect(outputFps(23.976)).toBe(24);
  });

  it('defaults to 60 when unknown', () => {
    expect(outputFps(0)).toBe(60);
    expect(outputFps(NaN)).toBe(60);
  });
});

describe('encodeArgs / remuxArgs', () => {
  const plan = { crf: 18 };

  it('encodes quality-first H.264 with the marker, never scaling beyond even-rounding', () => {
    const joined = encodeArgs(plan, 60, true, 'in.mov', 'out.mp4').join(' ');
    expect(joined).toContain('-c:v libx264');
    expect(joined).toContain('-preset veryslow');
    expect(joined).toContain('-crf 18');
    expect(joined).toContain('-x264-params aq-mode=3');
    expect(joined).toContain('fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2');
    expect(joined).toContain(`comment=${MARKER}`);
    expect(joined).toContain('-movflags +faststart');
    expect(joined).toContain('-c:a aac -b:a 160k');
  });

  it('writes no audio track for silent sources', () => {
    const joined = encodeArgs(plan, 30, false, 'in.mov', 'out.mp4').join(' ');
    expect(joined).toContain('-an');
    expect(joined).not.toContain('-c:a');
  });

  it('remuxes with copied streams, faststart, and the marker', () => {
    const joined = remuxArgs('in.mp4', 'out.mp4').join(' ');
    expect(joined).toContain('-c copy');
    expect(joined).toContain(`comment=${MARKER}`);
    expect(joined).toContain('-movflags +faststart');
    expect(joined).not.toContain('libx264');
  });
});

describe('rewriteRefs', () => {
  it('replaces every occurrence across quoting styles', () => {
    const renames = new Map([['/a/shot.png', '/a/shot.webp']]);
    const text = 'src: /a/shot.png\n<img src="/a/shot.png" />';
    expect(rewriteRefs(text, renames)).toBe('src: /a/shot.webp\n<img src="/a/shot.webp" />');
  });

  it('handles one path prefixing another (longest first)', () => {
    const renames = new Map([
      ['/a/shot.png', '/a/shot.webp'],
      ['/a/shot.png.mov', '/a/shot.png.mp4'],
    ]);
    const text = 'x /a/shot.png y /a/shot.png.mov z';
    expect(rewriteRefs(text, renames)).toBe('x /a/shot.webp y /a/shot.png.mp4 z');
  });
});

describe('findCollisions', () => {
  it('reports sources that map to the same optimized name', () => {
    const collisions = findCollisions(['/a/demo.mov', '/a/demo.mp4', '/a/other.png']);
    expect(collisions).toEqual([['/a/demo.mp4', ['/a/demo.mov', '/a/demo.mp4']]]);
  });
});
