import { describe, it, expect } from 'vitest';
import {
  KEYS,
  findKey,
  keyToWire,
  wireToKeyCode,
  instrumentToWire,
  wireToInstrument,
  INSTRUMENT_LABELS,
  themeToWire,
  wireToTheme,
  nextTheme,
  buildSrc,
  savedChordsToWire,
  parseSnapshot,
} from './sim-controls-core';

describe('keys', () => {
  it('has 12 pitch classes with unique codes and wire names', () => {
    expect(KEYS).toHaveLength(12);
    expect(new Set(KEYS.map((k) => k.code)).size).toBe(12);
    expect(new Set(KEYS.map((k) => k.wire)).size).toBe(12);
  });

  it('keyToWire maps internal code to the musical wire name', () => {
    expect(keyToWire('C')).toBe('C');
    expect(keyToWire('Cs')).toBe('C#');
    expect(keyToWire('As')).toBe('A#');
  });

  it('wireToKeyCode accepts canonical sharps, case-insensitively', () => {
    expect(wireToKeyCode('C#')).toBe('Cs');
    expect(wireToKeyCode('c#')).toBe('Cs');
    expect(wireToKeyCode('A')).toBe('A');
  });

  it('wireToKeyCode accepts the enharmonic flats the app may emit', () => {
    expect(wireToKeyCode('Db')).toBe('Cs');
    expect(wireToKeyCode('Eb')).toBe('Ds');
    expect(wireToKeyCode('Gb')).toBe('Fs');
    expect(wireToKeyCode('Ab')).toBe('Gs');
    expect(wireToKeyCode('Bb')).toBe('As');
  });

  it('wireToKeyCode returns undefined for unknown spellings', () => {
    expect(wireToKeyCode('H')).toBeUndefined();
    expect(wireToKeyCode('')).toBeUndefined();
  });

  it('findKey falls back to C for an unknown code', () => {
    expect(findKey('zzz').code).toBe('C');
  });
});

describe('instrument', () => {
  it('maps wire tokens to internal values, including the piano alias', () => {
    expect(wireToInstrument('guitar')).toBe('guitar');
    expect(wireToInstrument('keyboard')).toBe('keyboard');
    expect(wireToInstrument('piano')).toBe('keyboard');
    expect(wireToInstrument('PIANO')).toBe('keyboard');
  });

  it('instrumentToWire emits canonical guitar/keyboard', () => {
    expect(instrumentToWire('guitar')).toBe('guitar');
    expect(instrumentToWire('keyboard')).toBe('keyboard');
  });

  it('returns undefined for an unknown instrument token', () => {
    expect(wireToInstrument('kazoo')).toBeUndefined();
  });

  it('exposes user-facing labels', () => {
    expect(INSTRUMENT_LABELS.keyboard).toBe('Piano');
    expect(INSTRUMENT_LABELS.guitar).toBe('Guitar');
  });
});

describe('theme', () => {
  it('maps wire tokens to internal values', () => {
    expect(wireToTheme('light')).toBe('light');
    expect(wireToTheme('dark')).toBe('dark');
    expect(wireToTheme('DARK')).toBe('dark');
  });

  it('ignores the follow-OS values the binary toggle cannot represent', () => {
    expect(wireToTheme('default')).toBeUndefined();
    expect(wireToTheme('system')).toBeUndefined();
    expect(wireToTheme('nope')).toBeUndefined();
  });

  it('themeToWire emits canonical light/dark', () => {
    expect(themeToWire('light')).toBe('light');
    expect(themeToWire('dark')).toBe('dark');
  });

  it('nextTheme flips between light and dark', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});

describe('buildSrc', () => {
  it('builds a C / keyboard / light url with the embed + skipOnboarding flags', () => {
    expect(buildSrc({ base: '/chords', key: 'C', instrument: 'keyboard', theme: 'light' })).toBe(
      'https://chordcolors.com/chords?embed=iphone&skipOnboarding=1&key=C&instrument=keyboard&theme=light',
    );
  });

  it('url-encodes sharp keys and carries guitar + dark theme', () => {
    expect(buildSrc({ base: '/wheel', key: 'Cs', instrument: 'guitar', theme: 'dark' })).toBe(
      'https://chordcolors.com/wheel?embed=iphone&skipOnboarding=1&key=C%23&instrument=guitar&theme=dark',
    );
  });

  it('omits pinnedScale and savedChords when not provided', () => {
    const src = buildSrc({ base: '/chords', key: 'C', instrument: 'keyboard', theme: 'light' });
    expect(src).not.toContain('pinnedScale');
    expect(src).not.toContain('savedChords');
  });

  it('appends pinnedScale and savedChords in the bridge wire form', () => {
    const src = buildSrc({
      base: '/chords',
      key: 'C',
      instrument: 'keyboard',
      theme: 'light',
      pinnedScale: 'C:Major',
      savedChords: savedChordsToWire([
        { key: 'C', suffix: 'M' },
        { key: 'F#', suffix: '7', positionIndex: 1 },
      ]),
    });
    // Round-trip through URL decoding: this is exactly what the app's
    // parseControls sees on the other side.
    const params = new URL(src).searchParams;
    expect(params.get('pinnedScale')).toBe('C:Major');
    expect(JSON.parse(params.get('savedChords')!)).toEqual([
      { key: 'C', suffix: 'M' },
      { key: 'F#', suffix: '7', positionIndex: 1 },
    ]);
  });

  it('keeps explicit empty values, which clear persisted app state', () => {
    const params = new URL(
      buildSrc({
        base: '/chords',
        key: 'C',
        instrument: 'keyboard',
        theme: 'light',
        pinnedScale: '',
        savedChords: '[]',
      }),
    ).searchParams;
    expect(params.get('pinnedScale')).toBe('');
    expect(params.get('savedChords')).toBe('[]');
  });
});

describe('savedChordsToWire', () => {
  it('serializes chords to the bridge JSON wire form', () => {
    expect(savedChordsToWire([{ key: 'C', suffix: 'M' }])).toBe('[{"key":"C","suffix":"M"}]');
    expect(savedChordsToWire([])).toBe('[]');
  });
});

describe('parseSnapshot', () => {
  it('parses key + instrument + theme from a chordcolors payload', () => {
    expect(
      parseSnapshot({ chordcolors: { key: 'F#', instrument: 'guitar', theme: 'dark' } }),
    ).toEqual({ key: 'Fs', instrument: 'guitar', theme: 'dark' });
  });

  it('parses key only (enharmonic flat)', () => {
    expect(parseSnapshot({ chordcolors: { key: 'Bb' } })).toEqual({ key: 'As' });
  });

  it('parses instrument only', () => {
    expect(parseSnapshot({ chordcolors: { instrument: 'keyboard' } })).toEqual({
      instrument: 'keyboard',
    });
  });

  it('parses theme only, ignoring the follow-OS value', () => {
    expect(parseSnapshot({ chordcolors: { theme: 'light' } })).toEqual({ theme: 'light' });
    expect(parseSnapshot({ chordcolors: { theme: 'default' } })).toEqual({});
  });

  it('returns an empty object when chordcolors is present but has no usable fields', () => {
    expect(parseSnapshot({ chordcolors: {} })).toEqual({});
    expect(parseSnapshot({ chordcolors: { key: 'H', instrument: 'kazoo' } })).toEqual({});
  });

  it('returns null for non-chordcolors payloads', () => {
    expect(parseSnapshot({ foo: 1 })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('hi')).toBeNull();
  });
});
