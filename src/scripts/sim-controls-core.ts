// Pure core for the embedded Chord Colors demo controls.
//
// Knows the SHAPE of the controllable state (key, instrument) and how to map
// between our internal picker codes and the ExternalControl bridge's wire form.
// No DOM, no I/O. Every function here is a pure transform, unit-tested in
// sim-controls-core.test.ts. The adapter (sim-controls.ts) imports this and is
// the only place real DOM/postMessage work happens.
//
// Wire contract (app repo src/features/ExternalControl): keys travel as musical
// names (C, C#, Bb, …, case-insensitive in, canonical out); the app may emit
// either enharmonic spelling for a black key, so inbound matching accepts both.
// Instrument tokens are 'guitar' / 'keyboard' ('piano' is an inbound alias).

export const CHORD_COLORS_ORIGIN = 'https://app.chordcolors.com';

export type InstrumentValue = 'guitar' | 'keyboard';

export interface KeyDef {
  /** internal picker code, also written to data-key (e.g. 'Cs') */
  code: string;
  /** display label (e.g. 'C♯') */
  label: string;
  /** Chord Colors palette hue */
  hex: string;
  /** canonical wire name we SEND (e.g. 'C#') */
  wire: string;
  /** extra enharmonic spellings to MATCH on inbound (e.g. ['Db']) */
  alts: string[];
}

// 12 pitch classes. Hexes are the Chord Colors palette (Circle of Fifths).
export const KEYS: KeyDef[] = [
  { code: 'C', label: 'C', hex: '#FF0000', wire: 'C', alts: ['B#'] },
  { code: 'Cs', label: 'C♯', hex: '#00A5CB', wire: 'C#', alts: ['Db'] },
  { code: 'D', label: 'D', hex: '#FF8F00', wire: 'D', alts: [] },
  { code: 'Ds', label: 'D♯', hex: '#0800AC', wire: 'D#', alts: ['Eb'] },
  { code: 'E', label: 'E', hex: '#FEFF00', wire: 'E', alts: ['Fb'] },
  { code: 'F', label: 'F', hex: '#D7007F', wire: 'F', alts: ['E#'] },
  { code: 'Fs', label: 'F♯', hex: '#00B200', wire: 'F#', alts: ['Gb'] },
  { code: 'G', label: 'G', hex: '#FF5900', wire: 'G', alts: [] },
  { code: 'Gs', label: 'G♯', hex: '#0063BB', wire: 'G#', alts: ['Ab'] },
  { code: 'A', label: 'A', hex: '#FFC400', wire: 'A', alts: [] },
  { code: 'As', label: 'A♯', hex: '#6E00AC', wire: 'A#', alts: ['Bb'] },
  { code: 'B', label: 'B', hex: '#78CB00', wire: 'B', alts: ['Cb'] },
];

const KEY_BY_CODE = new Map(KEYS.map((k) => [k.code, k]));

// Every accepted wire spelling (lowercased) -> internal code.
const CODE_BY_WIRE = new Map<string, string>();
for (const k of KEYS) {
  CODE_BY_WIRE.set(k.wire.toLowerCase(), k.code);
  for (const alt of k.alts) CODE_BY_WIRE.set(alt.toLowerCase(), k.code);
}

export function findKey(code: string): KeyDef {
  return KEY_BY_CODE.get(code) ?? KEYS[0];
}

export function keyToWire(code: string): string {
  return findKey(code).wire;
}

/** Map an inbound wire key name (any accepted enharmonic, any case) to our code. */
export function wireToKeyCode(wireName: string): string | undefined {
  return CODE_BY_WIRE.get(wireName.trim().toLowerCase());
}

// --- instrument -------------------------------------------------------------

const INSTRUMENT_BY_TOKEN: Record<string, InstrumentValue> = {
  guitar: 'guitar',
  keyboard: 'keyboard',
  piano: 'keyboard',
};

export const INSTRUMENT_LABELS: Record<InstrumentValue, string> = {
  guitar: 'Guitar',
  keyboard: 'Piano',
};

export function wireToInstrument(token: string): InstrumentValue | undefined {
  return INSTRUMENT_BY_TOKEN[token.trim().toLowerCase()];
}

export function instrumentToWire(value: InstrumentValue): InstrumentValue {
  return value === 'guitar' ? 'guitar' : 'keyboard';
}

// --- theme ------------------------------------------------------------------
//
// The bridge accepts dark/light/default (and system/auto -> default). Our toggle
// is binary, so we send/parse only light/dark; default/system/auto/unknown map to
// undefined on the way in (ignored). Because every embed is pinned to light or
// dark on first paint, the app never sits in `default` for us.

export type ThemeValue = 'light' | 'dark';

const THEME_BY_TOKEN: Record<string, ThemeValue> = {
  light: 'light',
  dark: 'dark',
};

export function wireToTheme(token: string): ThemeValue | undefined {
  return THEME_BY_TOKEN[token.trim().toLowerCase()];
}

export function themeToWire(value: ThemeValue): ThemeValue {
  return value === 'dark' ? 'dark' : 'light';
}

export function nextTheme(value: ThemeValue): ThemeValue {
  return value === 'dark' ? 'light' : 'dark';
}

// --- saved chords / pinned scale ---------------------------------------------
//
// Authored embed config, passed through to the bridge verbatim (we never edit
// these client-side). Keys here are the bridge's musical names ('C', 'F#',
// 'Bb', …), NOT our internal picker codes — invalid values are dropped
// silently by the app.

export interface SavedChord {
  /** musical key name in the bridge's wire form (e.g. 'C', 'F#') */
  key: string;
  /** chord suffix (e.g. 'M', 'm', '7') */
  suffix: string;
  /** optional voicing/position index */
  positionIndex?: number;
}

/** Bridge wire form for `savedChords`: a JSON array. `[]` clears the list. */
export function savedChordsToWire(chords: SavedChord[]): string {
  return JSON.stringify(chords);
}

// --- src building -----------------------------------------------------------

export interface SrcParams {
  base: string;
  key: string; // internal code
  instrument: InstrumentValue;
  theme: ThemeValue;
  /** wire form 'C:Major' (see bridge contract); '' clears a persisted pin */
  pinnedScale?: string;
  /** wire form from savedChordsToWire(); '[]' clears persisted saved chords */
  savedChords?: string;
}

/** First-paint / reset iframe URL. Query params are the bridge's deep-link form. */
export function buildSrc({
  base,
  key,
  instrument,
  theme,
  pinnedScale,
  savedChords,
}: SrcParams): string {
  const params = new URLSearchParams({
    embed: 'iphone',
    skipOnboarding: '1',
    key: keyToWire(key),
    instrument: instrumentToWire(instrument),
    theme: themeToWire(theme),
  });
  // Omitted entirely when undefined: the app then keeps its own state. An empty
  // string is meaningful (it clears), so test against undefined, not truthiness.
  if (pinnedScale !== undefined) params.set('pinnedScale', pinnedScale);
  if (savedChords !== undefined) params.set('savedChords', savedChords);
  return `${CHORD_COLORS_ORIGIN}${base}?${params.toString()}`;
}

// --- snapshot parsing -------------------------------------------------------

export interface ParsedSnapshot {
  key?: string; // internal code
  instrument?: InstrumentValue;
  theme?: ThemeValue;
}

/**
 * Extract only the fields we drive from an inbound `{ chordcolors: … }` payload,
 * normalised to our internal codes. Returns null for anything that is not a
 * chordcolors snapshot; returns {} for a snapshot with no usable fields.
 */
export function parseSnapshot(data: unknown): ParsedSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const payload = (data as Record<string, unknown>).chordcolors;
  if (!payload || typeof payload !== 'object') return null;
  const cc = payload as Record<string, unknown>;
  const out: ParsedSnapshot = {};
  if (typeof cc.key === 'string') {
    const code = wireToKeyCode(cc.key);
    if (code) out.key = code;
  }
  if (typeof cc.instrument === 'string') {
    const inst = wireToInstrument(cc.instrument);
    if (inst) out.instrument = inst;
  }
  if (typeof cc.theme === 'string') {
    const theme = wireToTheme(cc.theme);
    if (theme) out.theme = theme;
  }
  return out;
}
