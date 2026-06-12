# Chord Colors demo controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reload-based key picker on the Chord Colors case study with a single composite control cluster (Instrument | Key | Theme | Reset) that drives each embedded demo through the app's ExternalControl bridge (query params on first paint, `postMessage` live, two-way sync), and bake a jagged "Play with me" sticker into every embed.

**Architecture:** A pure, unit-tested core (`sim-controls-core.ts`) holds all value mapping, URL building, and snapshot parsing with no DOM. A thin adapter (`sim-controls.ts`) does all DOM + `postMessage` I/O. Astro components compose the UI: `EmbeddedDemo` (unified from `EmbeddedDemo` + `TryIt`) owns the iframe and renders `PlaySticker` plus `SimControls`, which in turn renders `InstrumentPicker`, `KeyPicker`, `ThemePicker`, and the existing `ResetButton`.

**Tech Stack:** Astro 6, TypeScript, Vitest 4, plain DOM (no framework runtime). Spec: `docs/superpowers/specs/2026-06-05-chord-colors-demo-controls-design.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/scripts/sim-controls-core.ts` | Pure core: `KEYS` table, key/instrument wire mapping, `buildSrc`, `parseSnapshot`. No DOM. |
| `src/scripts/sim-controls-core.test.ts` | Vitest unit tests for the core. |
| `src/scripts/sim-controls.ts` | Adapter: build menus, delegated clicks, optimistic repaint, `postMessage`, inbound two-way sync, reset. |
| `src/styles/sim-controls.css` | Shared styles: the `.sim-controls` row, key + instrument dropdowns, theme toggle, reset button. |
| `src/components/content/KeyPicker.astro` | Key dropdown markup (menu built by JS). |
| `src/components/content/InstrumentPicker.astro` | Instrument dropdown markup (menu built by JS). |
| `src/components/content/ThemePicker.astro` | Light/dark icon toggle (sun/moon). |
| `src/components/content/PlaySticker.astro` | Decorative jagged "Play with me" seal (scoped styles). |
| `src/components/content/SimControls.astro` | The composite: renders the child controls, imports the CSS + adapter script. |
| `src/components/content/EmbeddedDemo.astro` | Unified demo wrapper: owns the iframe + phone frame; renders `PlaySticker` + `SimControls`; builds the iframe src. |
| `src/components/content/ResetButton.astro` | Unchanged (reset button markup). |
| `src/components/work/ChordColors.astro` | Drop `TryIt`; hero demo uses `<EmbeddedDemo … eager bare />`. |

Deletions (Task 8): `src/components/content/TryIt.astro`, `src/scripts/key-picker.ts`, `src/styles/key-picker.css`.

---

## Task 1: Pure core module (`sim-controls-core.ts`)

**Files:**
- Create: `src/scripts/sim-controls-core.ts`
- Test: `src/scripts/sim-controls-core.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/scripts/sim-controls-core.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/scripts/sim-controls-core.test.ts`
Expected: FAIL. Cannot resolve module `./sim-controls-core` (file does not exist yet).

- [ ] **Step 3: Write the core implementation**

Create `src/scripts/sim-controls-core.ts`:

```ts
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

export const CHORD_COLORS_ORIGIN = 'https://chordcolors.com';

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

// --- src building -----------------------------------------------------------

export interface SrcParams {
  base: string;
  key: string; // internal code
  instrument: InstrumentValue;
  theme: ThemeValue;
}

/** First-paint / reset iframe URL. Query params are the bridge's deep-link form. */
export function buildSrc({ base, key, instrument, theme }: SrcParams): string {
  const params = new URLSearchParams({
    embed: 'iphone',
    skipOnboarding: '1',
    key: keyToWire(key),
    instrument: instrumentToWire(instrument),
    theme: themeToWire(theme),
  });
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/scripts/sim-controls-core.test.ts`
Expected: PASS. All tests green.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/sim-controls-core.ts src/scripts/sim-controls-core.test.ts
git commit -m "feat: pure core for Chord Colors demo controls (key/instrument mapping, src, snapshot)"
```

---

## Task 2: Shared control styles (`sim-controls.css`)

**Files:**
- Create: `src/styles/sim-controls.css`

Note: this is a NEW file. The old `src/styles/key-picker.css` stays until Task 8 (its importers are migrated first). The new layout is a single flex row `.sim-controls` (replacing today's two separate absolutely-positioned controls), plus an instrument dropdown mirroring the key dropdown.

- [ ] **Step 1: Create the stylesheet**

Create `src/styles/sim-controls.css`:

```css
/* Composite demo controls for embedded Chord Colors demos: instrument + key
   dropdowns and a reset button, laid out as one flex row pinned to the top-right
   of each .phone-demo. Imported once by SimControls.astro (global, not scoped).
   CSS variables (--bg, --ink, --muted, --text, --hair, --hairHigh) come from
   src/styles/global.css. */

.sim-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
}

/* Reset button (icon). Now a flex item in the row, no longer self-positioned. */
.sim-reset {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--hair);
  background: var(--bg);
  color: var(--text);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 120ms ease;
}
.sim-reset:hover {
  background: oklch(95% 0 0);
}
.sim-reset:active {
  transform: rotate(180deg);
  transition: transform 240ms ease;
}

/* Theme toggle (icon button). Both icons render; we show the moon in light mode
   (click -> dark) and the sun in dark mode (click -> light), driven by the
   demo's data-theme. */
.theme-toggle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--hair);
  background: var(--bg);
  color: var(--ink);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 120ms ease;
}
.theme-toggle:hover {
  background: oklch(95% 0 0);
}
.theme-icon {
  width: 17px;
  height: 17px;
  display: block;
}
.theme-icon--sun {
  display: none;
}
.phone-demo[data-theme='dark'] .theme-icon--moon {
  display: none;
}
.phone-demo[data-theme='dark'] .theme-icon--sun {
  display: block;
}

/* Shared dropdown shell for the key + instrument pickers. position:relative so
   each menu anchors to its own trigger. */
.key-picker,
.instrument-picker {
  --current-hue: #ff0000;
  position: relative;
}

.key-picker-trigger,
.instrument-picker-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  margin: 0;
  border: 1px solid var(--hair);
  border-radius: 999px;
  background: var(--bg);
  color: var(--ink);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.05px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 140ms ease, border-color 140ms ease;
}
.key-picker-trigger:hover,
.instrument-picker-trigger:hover {
  background: oklch(96.5% 0 0);
}
.key-picker[data-open='true'] .key-picker-trigger {
  border-color: color-mix(in oklab, var(--current-hue) 35%, var(--hairHigh) 65%);
  background: color-mix(in oklab, var(--current-hue) 5%, var(--bg) 95%);
}
.instrument-picker[data-open='true'] .instrument-picker-trigger {
  border-color: var(--hairHigh);
  background: oklch(96.5% 0 0);
}

.key-picker-trigger-label,
.instrument-picker-trigger-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
  font-weight: 600;
}

.key-picker-swatch {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--swatch-color, currentColor);
  box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.12);
}

.key-picker-value,
.instrument-picker-value {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.1px;
  text-align: left;
  color: var(--ink);
}
.key-picker-value {
  min-width: 14px;
}

.key-picker-caret,
.instrument-picker-caret {
  width: 9px;
  height: 6px;
  color: var(--muted);
  transition: transform 220ms ease;
}
.key-picker[data-open='true'] .key-picker-caret,
.instrument-picker[data-open='true'] .instrument-picker-caret {
  transform: rotate(180deg);
}

/* Shared dropdown menu. */
.key-picker-menu,
.instrument-picker-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 144px;
  max-height: 360px;
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--hair);
  border-radius: 12px;
  padding: 4px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.1), 0 2px 6px rgba(0, 0, 0, 0.04);
  opacity: 0;
  transform: translateY(-4px);
  pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease;
  list-style: none;
  margin: 0;
}
.key-picker[data-open='true'] .key-picker-menu,
.instrument-picker[data-open='true'] .instrument-picker-menu {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.key-picker-option,
.instrument-picker-option {
  --swatch-color: #ff0000;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  margin: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.1px;
  cursor: pointer;
  text-align: left;
}
.key-picker-option:hover {
  background: color-mix(in oklab, var(--swatch-color) 8%, var(--bg) 92%);
}
.key-picker-option[aria-selected='true'] {
  background: color-mix(in oklab, var(--swatch-color) 16%, var(--bg) 84%);
}
.instrument-picker-option:hover {
  background: oklch(96.5% 0 0);
}
.instrument-picker-option[aria-selected='true'] {
  background: oklch(93% 0 0);
}
.key-picker-option-letter,
.instrument-picker-option-letter {
  flex: 1;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/sim-controls.css
git commit -m "feat: shared styles for composite demo controls (instrument + key + reset row)"
```

---

## Task 3: Child UI components (KeyPicker, InstrumentPicker, PlaySticker)

**Files:**
- Create: `src/components/content/KeyPicker.astro`
- Create: `src/components/content/InstrumentPicker.astro`
- Create: `src/components/content/PlaySticker.astro`

- [ ] **Step 1: Create `KeyPicker.astro`**

This is the key dropdown, extracted from the old inline markup. Its frontmatter imports `findKey` from the core so the initial trigger label + swatch are correct server-side. The menu is built client-side by the adapter.

```astro
---
import { findKey } from '../../scripts/sim-controls-core';

interface Props {
  defaultKey?: string;
}

const { defaultKey = 'C' } = Astro.props;
const key = findKey(defaultKey);
---

<div class="key-picker" data-open="false" style={`--current-hue: ${key.hex}`}>
  <button
    class="key-picker-trigger"
    type="button"
    aria-haspopup="listbox"
    aria-expanded="false"
    aria-label="Choose key"
  >
    <span class="key-picker-trigger-label">Key</span>
    <span class="key-picker-swatch" aria-hidden="true" style={`--swatch-color: ${key.hex}`}></span>
    <span class="key-picker-value">{key.label}</span>
    <svg
      class="key-picker-caret"
      viewBox="0 0 10 6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
  </button>
  <div class="key-picker-menu" role="listbox" aria-label="Key"></div>
</div>
```

- [ ] **Step 2: Create `InstrumentPicker.astro`**

Mirrors the key picker. Two options (Piano / Guitar) are built client-side by the adapter; the trigger shows the default label.

```astro
---
import { INSTRUMENT_LABELS } from '../../scripts/sim-controls-core';
import type { InstrumentValue } from '../../scripts/sim-controls-core';

interface Props {
  defaultInstrument?: InstrumentValue;
}

const { defaultInstrument = 'keyboard' } = Astro.props;
---

<div class="instrument-picker" data-open="false">
  <button
    class="instrument-picker-trigger"
    type="button"
    aria-haspopup="listbox"
    aria-expanded="false"
    aria-label="Choose instrument"
  >
    <span class="instrument-picker-trigger-label">Instrument</span>
    <span class="instrument-picker-value">{INSTRUMENT_LABELS[defaultInstrument]}</span>
    <svg
      class="instrument-picker-caret"
      viewBox="0 0 10 6"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
  </button>
  <div class="instrument-picker-menu" role="listbox" aria-label="Instrument"></div>
</div>
```

- [ ] **Step 3: Create `PlaySticker.astro`**

A decorative, jagged 12-point seal (three overlapped squares) with two lines of text, rotated askew into the phone's top-left corner. `pointer-events: none` so it never blocks the iframe; styles are scoped to the component. (Exact look is tuned visually in Task 9.)

```astro
---
// Decorative "Play with me" sticker. The jagged seal is three overlapped
// squares (rotated 0/30/60deg) whose union reads as a 12-point starburst; the
// two-line text sits on top. Purely decorative: aria-hidden + pointer-events:none.
---

<div class="play-sticker" aria-hidden="true">
  <span class="play-sticker__burst"></span>
  <span class="play-sticker__text">
    <span>Play with</span>
    <span>me</span>
  </span>
</div>

<style>
  .play-sticker {
    position: absolute;
    top: -14px;
    left: -14px;
    z-index: 7;
    width: 88px;
    height: 88px;
    transform: rotate(-9deg);
    pointer-events: none;
    filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.18));
  }

  .play-sticker__burst,
  .play-sticker__burst::before,
  .play-sticker__burst::after {
    position: absolute;
    inset: 0;
    background: oklch(72% 0.2 25);
    border-radius: 4px;
  }
  .play-sticker__burst::before {
    content: '';
    transform: rotate(30deg);
  }
  .play-sticker__burst::after {
    content: '';
    transform: rotate(60deg);
  }

  .play-sticker__text {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: #fff;
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-weight: 800;
    font-size: 13px;
    line-height: 1.08;
    letter-spacing: -0.02em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  }
</style>
```

- [ ] **Step 4: Create `ThemePicker.astro`**

A compact light/dark icon toggle. It renders both a moon and a sun SVG; `sim-controls.css` shows the one matching `.phone-demo[data-theme]`. The adapter (Task 4) handles the click: it flips `data-theme`, updates `aria-pressed`, and posts `{ theme }` to the app.

```astro
---
// Light/dark theme toggle. Both icons render; sim-controls.css shows the one
// for the current .phone-demo[data-theme]. Clicks are handled by the adapter
// (delegated), which flips data-theme, repaints aria-pressed, and posts { theme }.
---

<button
  class="theme-toggle"
  type="button"
  aria-pressed="false"
  aria-label="Toggle dark mode"
  title="Toggle dark mode"
>
  <svg
    class="theme-icon theme-icon--moon"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"><path d="M6 1.5A6.5 6.5 0 1 0 14.5 10 5 5 0 0 1 6 1.5z" /></svg>
  <svg
    class="theme-icon theme-icon--sun"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    aria-hidden="true">
    <circle cx="8" cy="8" r="3.2" />
    <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M13 3l-1.1 1.1M4.1 11.9 3 13" />
  </svg>
</button>
```

- [ ] **Step 5: Verify the components compile**

Run: `pnpm build`
Expected: build succeeds (these components are not yet imported anywhere, so this confirms no syntax errors and that the core import resolves from `.astro` frontmatter).

- [ ] **Step 6: Commit**

```bash
git add src/components/content/KeyPicker.astro src/components/content/InstrumentPicker.astro src/components/content/ThemePicker.astro src/components/content/PlaySticker.astro
git commit -m "feat: KeyPicker, InstrumentPicker, ThemePicker, and jagged PlaySticker components"
```

---

## Task 4: Adapter script (`sim-controls.ts`)

**Files:**
- Create: `src/scripts/sim-controls.ts`

The adapter is the DOM/messaging glue. It is verified by build + manual run (matching the app repo's own convention for its bridge glue), not unit tests; all testable logic lives in the core.

- [ ] **Step 1: Create the adapter**

Create `src/scripts/sim-controls.ts`:

```ts
// Adapter for the embedded Chord Colors demo controls.
//
// All DOM + postMessage I/O lives here; pure mapping/serialization is in
// sim-controls-core.ts. State per demo lives as data attributes on the
// .phone-demo wrapper (data-base, data-key, data-instrument). The controller:
//   - builds the key + instrument dropdown menus (idempotent),
//   - handles open/close, selection, and reset via delegated clicks,
//   - on a user change, repaints optimistically and posts to the iframe,
//   - listens once for inbound { chordcolors: … } snapshots and syncs the UI.
//
// Registered on astro:page-load so it re-runs after every client navigation
// (ClientRouter / View Transitions). Init is idempotent; delegated handlers and
// the message listener attach once for the page lifecycle.

import {
  KEYS,
  findKey,
  keyToWire,
  instrumentToWire,
  themeToWire,
  nextTheme,
  INSTRUMENT_LABELS,
  buildSrc,
  parseSnapshot,
  CHORD_COLORS_ORIGIN,
  type InstrumentValue,
  type ThemeValue,
  type KeyDef,
} from './sim-controls-core';

const DEFAULT_KEY = 'C';
const DEFAULT_INSTRUMENT: InstrumentValue = 'keyboard';
const DEFAULT_THEME: ThemeValue = 'light';
const INSTRUMENTS: InstrumentValue[] = ['keyboard', 'guitar']; // Piano listed first

// ── chrome painting ───────────────────────────────────────────────────────

function paintKey(demo: Element, key: KeyDef): void {
  const picker = demo.querySelector('.key-picker');
  if (!picker) return;
  (picker as HTMLElement).style.setProperty('--current-hue', key.hex);
  const swatch = picker.querySelector(
    '.key-picker-trigger .key-picker-swatch',
  ) as HTMLElement | null;
  if (swatch) swatch.style.setProperty('--swatch-color', key.hex);
  const valueEl = picker.querySelector('.key-picker-value');
  if (valueEl) valueEl.textContent = key.label;
  picker.querySelectorAll('.key-picker-option').forEach((opt) => {
    opt.setAttribute(
      'aria-selected',
      (opt as HTMLElement).dataset.code === key.code ? 'true' : 'false',
    );
  });
}

function paintInstrument(demo: Element, value: InstrumentValue): void {
  const picker = demo.querySelector('.instrument-picker');
  if (!picker) return;
  const valueEl = picker.querySelector('.instrument-picker-value');
  if (valueEl) valueEl.textContent = INSTRUMENT_LABELS[value];
  picker.querySelectorAll('.instrument-picker-option').forEach((opt) => {
    opt.setAttribute(
      'aria-selected',
      (opt as HTMLElement).dataset.value === value ? 'true' : 'false',
    );
  });
}

// Theme is reflected by CSS via .phone-demo[data-theme]; here we only keep the
// toggle's aria-pressed in sync.
function paintTheme(demo: Element, value: ThemeValue): void {
  const toggle = demo.querySelector('.theme-toggle');
  if (toggle) toggle.setAttribute('aria-pressed', value === 'dark' ? 'true' : 'false');
}

// ── messaging ─────────────────────────────────────────────────────────────

function postToApp(demo: Element, payload: Record<string, unknown>): void {
  const iframe = demo.querySelector('iframe') as HTMLIFrameElement | null;
  iframe?.contentWindow?.postMessage({ chordcolors: payload }, '*');
}

// ── apply (user-initiated): repaint optimistically, then tell the app ───────

function applyKey(demo: HTMLElement, code: string): void {
  const key = findKey(code);
  demo.dataset.key = key.code;
  paintKey(demo, key);
  postToApp(demo, { key: keyToWire(key.code) });
}

function applyInstrument(demo: HTMLElement, value: InstrumentValue): void {
  demo.dataset.instrument = value;
  paintInstrument(demo, value);
  postToApp(demo, { instrument: instrumentToWire(value) });
}

function applyTheme(demo: HTMLElement, value: ThemeValue): void {
  demo.dataset.theme = value;
  paintTheme(demo, value);
  postToApp(demo, { theme: themeToWire(value) });
}

// ── reset (full reset to defaults): reload to a clean default src ───────────

function resetDemo(demo: HTMLElement): void {
  const base = demo.dataset.base;
  if (!base) return;
  demo.dataset.key = DEFAULT_KEY;
  demo.dataset.instrument = DEFAULT_INSTRUMENT;
  demo.dataset.theme = DEFAULT_THEME;
  paintKey(demo, findKey(DEFAULT_KEY));
  paintInstrument(demo, DEFAULT_INSTRUMENT);
  paintTheme(demo, DEFAULT_THEME);
  const iframe = demo.querySelector('iframe') as HTMLIFrameElement | null;
  if (!iframe) return;
  const src = buildSrc({
    base,
    key: DEFAULT_KEY,
    instrument: DEFAULT_INSTRUMENT,
    theme: DEFAULT_THEME,
  });
  iframe.dataset.src = src;
  // buildSrc always has a query string, so a cache-bust is always '&'-joined.
  iframe.src = `${src}&_r=${Date.now()}`;
}

// ── menus (built once, client-side) ─────────────────────────────────────────

function buildKeyMenu(demo: Element): void {
  const menu = demo.querySelector('.key-picker-menu');
  if (!menu || menu.children.length) return;
  menu.innerHTML = KEYS.map(
    (k) =>
      `<button type="button" class="key-picker-option" role="option" data-code="${k.code}" style="--swatch-color: ${k.hex}" aria-selected="false">` +
      `<span class="key-picker-swatch" aria-hidden="true" style="--swatch-color: ${k.hex}"></span>` +
      `<span class="key-picker-option-letter">${k.label}</span>` +
      `</button>`,
  ).join('');
}

function buildInstrumentMenu(demo: Element): void {
  const menu = demo.querySelector('.instrument-picker-menu');
  if (!menu || menu.children.length) return;
  menu.innerHTML = INSTRUMENTS.map(
    (v) =>
      `<button type="button" class="instrument-picker-option" role="option" data-value="${v}" aria-selected="false">` +
      `<span class="instrument-picker-option-letter">${INSTRUMENT_LABELS[v]}</span>` +
      `</button>`,
  ).join('');
}

function initDemo(demo: Element | null): void {
  if (!demo) return;
  buildKeyMenu(demo);
  buildInstrumentMenu(demo);
  const el = demo as HTMLElement;
  paintKey(demo, findKey(el.dataset.key ?? DEFAULT_KEY));
  paintInstrument(demo, (el.dataset.instrument as InstrumentValue) ?? DEFAULT_INSTRUMENT);
  paintTheme(demo, (el.dataset.theme as ThemeValue) ?? DEFAULT_THEME);
}

function initAll(): void {
  document.querySelectorAll('.phone-demo[data-base]').forEach(initDemo);
}

// ── open / close ────────────────────────────────────────────────────────────

function closeAllPickers(): void {
  document
    .querySelectorAll('.key-picker[data-open="true"], .instrument-picker[data-open="true"]')
    .forEach((p) => {
      (p as HTMLElement).dataset.open = 'false';
      p.querySelector('[aria-expanded]')?.setAttribute('aria-expanded', 'false');
    });
}

function togglePicker(picker: HTMLElement, trigger: Element): void {
  initDemo(picker.closest('.phone-demo')); // cover content cloned in after init
  const wasOpen = picker.dataset.open === 'true';
  closeAllPickers();
  if (!wasOpen) {
    picker.dataset.open = 'true';
    trigger.setAttribute('aria-expanded', 'true');
  }
}

// ── inbound two-way sync ─────────────────────────────────────────────────────

function findDemoBySource(source: MessageEventSource | null): HTMLElement | null {
  if (!source) return null;
  const demos = document.querySelectorAll('.phone-demo[data-base]');
  for (const demo of demos) {
    const iframe = demo.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow === source) return demo as HTMLElement;
  }
  return null;
}

// ── delegated handlers (attached once) ───────────────────────────────────────

let handlersAttached = false;

function attachHandlers(): void {
  if (handlersAttached) return;
  handlersAttached = true;

  document.addEventListener('click', (e) => {
    const target = e.target as Element;

    if (target.closest('.sim-reset')) {
      const demo = target.closest('.phone-demo') as HTMLElement | null;
      if (demo) resetDemo(demo);
      return;
    }

    if (target.closest('.theme-toggle')) {
      const demo = target.closest('.phone-demo') as HTMLElement | null;
      if (demo) {
        const current = (demo.dataset.theme as ThemeValue) ?? DEFAULT_THEME;
        applyTheme(demo, nextTheme(current));
      }
      return;
    }

    const keyTrigger = target.closest('.key-picker-trigger');
    if (keyTrigger) {
      const picker = keyTrigger.closest('.key-picker') as HTMLElement | null;
      if (picker) togglePicker(picker, keyTrigger);
      return;
    }

    const instTrigger = target.closest('.instrument-picker-trigger');
    if (instTrigger) {
      const picker = instTrigger.closest('.instrument-picker') as HTMLElement | null;
      if (picker) togglePicker(picker, instTrigger);
      return;
    }

    const keyOption = target.closest('.key-picker-option') as HTMLElement | null;
    if (keyOption) {
      const demo = keyOption.closest('.phone-demo') as HTMLElement | null;
      if (demo) applyKey(demo, keyOption.dataset.code ?? DEFAULT_KEY);
      closeAllPickers();
      return;
    }

    const instOption = target.closest('.instrument-picker-option') as HTMLElement | null;
    if (instOption) {
      const demo = instOption.closest('.phone-demo') as HTMLElement | null;
      if (demo) {
        applyInstrument(demo, (instOption.dataset.value as InstrumentValue) ?? DEFAULT_INSTRUMENT);
      }
      closeAllPickers();
      return;
    }

    if (!target.closest('.key-picker') && !target.closest('.instrument-picker')) {
      closeAllPickers();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') closeAllPickers();
  });

  // Inbound snapshots from the embedded app -> sync the dropdowns (UI only).
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== CHORD_COLORS_ORIGIN) return;
    const parsed = parseSnapshot(e.data);
    if (!parsed) return;
    const demo = findDemoBySource(e.source);
    if (!demo) return;
    if (parsed.key) {
      demo.dataset.key = parsed.key;
      paintKey(demo, findKey(parsed.key));
    }
    if (parsed.instrument) {
      demo.dataset.instrument = parsed.instrument;
      paintInstrument(demo, parsed.instrument);
    }
    if (parsed.theme) {
      demo.dataset.theme = parsed.theme;
      paintTheme(demo, parsed.theme);
    }
  });
}

// ── entry point ──────────────────────────────────────────────────────────────

document.addEventListener('astro:page-load', () => {
  attachHandlers();
  initAll();
});
```

- [ ] **Step 2: Verify it compiles and typechecks**

Run: `pnpm build`
Expected: build succeeds (the adapter is not imported yet, so this only confirms it parses; full typecheck happens in Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/scripts/sim-controls.ts
git commit -m "feat: adapter wiring composite controls to the iframe via postMessage + two-way sync"
```

---

## Task 5: The composite (`SimControls.astro`)

**Files:**
- Create: `src/components/content/SimControls.astro`

This is the component the user described: it contains the child controls and owns their behavior (via the imported adapter), and it imports the shared CSS once.

- [ ] **Step 1: Create `SimControls.astro`**

```astro
---
import InstrumentPicker from './InstrumentPicker.astro';
import KeyPicker from './KeyPicker.astro';
import ThemePicker from './ThemePicker.astro';
import ResetButton from './ResetButton.astro';
import '../../styles/sim-controls.css';
import type { InstrumentValue } from '../../scripts/sim-controls-core';

interface Props {
  defaultKey?: string;
  defaultInstrument?: InstrumentValue;
}

const { defaultKey = 'C', defaultInstrument = 'keyboard' } = Astro.props;
---

<div class="sim-controls">
  <InstrumentPicker defaultInstrument={defaultInstrument} />
  <KeyPicker defaultKey={defaultKey} />
  <ThemePicker />
  <ResetButton />
</div>

<script>
  import '../../scripts/sim-controls.ts';
</script>
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/content/SimControls.astro
git commit -m "feat: SimControls composite (instrument + key + reset) wired to the adapter"
```

---

## Task 6: Unify `EmbeddedDemo.astro`

**Files:**
- Modify (full rewrite): `src/components/content/EmbeddedDemo.astro`

Fold `TryIt`'s variants into props (`eager`, `bare`), always render `PlaySticker`, render `SimControls`, and build the iframe src via `buildSrc`. Drop the old `key-picker.css` / `key-picker.ts` imports and the inline picker markup.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/components/content/EmbeddedDemo.astro` with:

```astro
---
import PlaySticker from './PlaySticker.astro';
import SimControls from './SimControls.astro';
import { buildSrc } from '../../scripts/sim-controls-core';
import type { InstrumentValue, ThemeValue } from '../../scripts/sim-controls-core';

interface Props {
  base: string;
  defaultKey?: string;
  defaultInstrument?: InstrumentValue;
  defaultTheme?: ThemeValue;
  title?: string;
  /** Eager-load the iframe (use for the first, above-the-fold demo). */
  eager?: boolean;
  /** Plain padding instead of the bordered card. */
  bare?: boolean;
}

const {
  base,
  defaultKey = 'C',
  defaultInstrument = 'keyboard',
  defaultTheme = 'light',
  title = 'Chord Colors interactive demo',
  eager = false,
  bare = false,
} = Astro.props;

const initialSrc = buildSrc({
  base,
  key: defaultKey,
  instrument: defaultInstrument,
  theme: defaultTheme,
});
---

<div
  class:list={['phone-demo', bare ? 'bare' : 'card']}
  data-base={base}
  data-key={defaultKey}
  data-instrument={defaultInstrument}
  data-theme={defaultTheme}
>
  <PlaySticker />
  <SimControls defaultKey={defaultKey} defaultInstrument={defaultInstrument} />
  <div class="phone-frame">
    <iframe
      class="phone-iframe"
      src={initialSrc}
      title={title}
      loading={eager ? 'eager' : 'lazy'}
      allow="autoplay; encrypted-media"
      referrerpolicy="no-referrer-when-downgrade"
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>
  </div>
</div>

<style>
  .phone-demo {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 36px 24px;
  }
  .phone-demo.card {
    margin: 8px 0 6px;
    background: #fcfcfc;
    border: 1px solid var(--hair);
    border-radius: 10px;
  }
  .phone-frame {
    position: relative;
    width: 380px;
    aspect-ratio: 9 / 19.5;
    background: #1a1a1a;
    border-radius: 52px;
    box-shadow:
      0 14px 40px rgba(0, 0, 0, 0.16),
      0 0 0 1px rgba(255, 255, 255, 0.06) inset;
    pointer-events: none;
  }
  .phone-iframe {
    position: absolute;
    inset: 14px;
    width: calc(100% - 28px);
    height: calc(100% - 28px);
    border: 0;
    border-radius: 38px;
    background: #1a1a1a;
    pointer-events: auto;
  }
</style>
```

- [ ] **Step 2: Verify the 8 existing EmbeddedDemo usages still build**

Run: `pnpm build`
Expected: build succeeds. `ChordColors.astro` still imports the (now-unified) `EmbeddedDemo` for its eight sections and still imports `TryIt` for the hero (removed in Task 7); both resolve, so the build is green.

- [ ] **Step 3: Commit**

```bash
git add src/components/content/EmbeddedDemo.astro
git commit -m "feat: unify EmbeddedDemo (sticker + SimControls + protocol src; absorb TryIt variants)"
```

---

## Task 7: Update `ChordColors.astro`; delete `TryIt.astro`

**Files:**
- Modify: `src/components/work/ChordColors.astro` (lines 9-10 imports, line 27 hero usage)
- Delete: `src/components/content/TryIt.astro`

- [ ] **Step 1: Remove the TryIt import**

In `src/components/work/ChordColors.astro`, delete this line (line 9):

```astro
import TryIt from '../content/TryIt.astro';
```

(Leave the `EmbeddedDemo` import on the following line intact.)

- [ ] **Step 2: Switch the hero demo to EmbeddedDemo**

Replace line 27:

```astro
<TryIt base="/chords" defaultKey="C" title="Chord Colors interactive demo" />
```

with:

```astro
<EmbeddedDemo base="/chords" defaultKey="C" title="Chord Colors interactive demo" eager bare />
```

- [ ] **Step 3: Delete the now-unused TryIt component**

```bash
git rm src/components/content/TryIt.astro
```

- [ ] **Step 4: Verify the build**

Run: `pnpm build`
Expected: build succeeds; no unresolved `TryIt` import.

- [ ] **Step 5: Commit**

```bash
git add src/components/work/ChordColors.astro
git commit -m "feat: every Chord Colors embed uses the unified demo; drop TryIt"
```

---

## Task 8: Remove superseded files; full verification

**Files:**
- Delete: `src/scripts/key-picker.ts`
- Delete: `src/styles/key-picker.css`

- [ ] **Step 1: Confirm nothing still references the old modules**

Run: `grep -rn "key-picker.ts\|key-picker.css\|content/TryIt" src`
Expected: no matches (the only importers were the old `EmbeddedDemo` and `TryIt`, both now migrated/removed).

- [ ] **Step 2: Delete the old files**

```bash
git rm src/scripts/key-picker.ts src/styles/key-picker.css
```

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS. Existing `work` tests plus the new `sim-controls-core` tests.

- [ ] **Step 4: Typecheck and build**

Run: `pnpm check`
Expected: no NEW type errors introduced by these files. (If `astro check` reports pre-existing, unrelated errors, note them but do not fix here.)

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove superseded key-picker script + styles"
```

---

## Task 9: Manual + visual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Open: `http://localhost:4321/work/chord-colors/`

- [ ] **Step 2: Verify the controls and sticker**

Confirm on every embedded demo:
- The top-right cluster shows **Instrument | Key | Theme | Reset** in one row.
- The top-left corner shows the jagged "Play with me" sticker, two lines ("Play with" / "me"), rotated askew.
- Clicking the Instrument trigger opens a Piano/Guitar menu; clicking the Key trigger opens the 12-key color menu; selecting closes the menu and updates the trigger label/swatch. Outside-click and Escape close menus.
- Clicking the Theme toggle flips its icon between moon (light mode) and sun (dark mode).
- The browser console shows no errors (open DevTools console).

- [ ] **Step 3: Tune the sticker look (if needed)**

The sticker is a first concrete version. Adjust `width`, `transform: rotate()`, `top`/`left`, `font-size`, and the burst `border-radius` in `PlaySticker.astro` to taste, re-checking in the browser. Take a screenshot to share for sign-off.

- [ ] **Step 4: Note on live behavior**

Key/instrument `postMessage` changes and inbound two-way sync only take visible effect once the ExternalControl bridge is deployed to chordcolors.com. Pre-deploy, confirm only that the controls render and operate locally without console errors. Full end-to-end behavior (no-reload key/instrument change, reset to defaults, in-app changes updating the dropdowns) is verified after the bridge ships.

- [ ] **Step 5: Commit any sticker tweaks**

```bash
git add src/components/content/PlaySticker.astro
git commit -m "style: tune Play with me sticker"
```

(Skip if no tweaks were made.)

---

## Self-review notes

- **Spec coverage:** composition (Tasks 3-6), protocol first-paint + live `postMessage`
  (Tasks 1, 4, 6), two-way sync with origin check + source demux (Tasks 1, 4),
  pure-core/adapter split (Tasks 1, 4), full-reset-to-defaults (Task 4), instrument selector
  everywhere (Tasks 3-6), `EmbeddedDemo`+`TryIt` unification (Tasks 6-7), sticker on every
  embed (Tasks 3, 6), file deletions (Tasks 7-8), theme toggle (Tasks 1-6). All spec sections
  map to a task.
- **Enharmonics:** the `KEYS` `alts` only cover the common single-accidental enharmonics the
  app realistically emits; double-accidentals from `VALID_KEYS` are intentionally omitted
  (YAGNI). If the app ever emits one, `wireToKeyCode` returns undefined and that field is
  ignored (safe no-op), which is acceptable.
- **Type consistency:** `InstrumentValue`, `KeyDef`, `ParsedSnapshot`, `SrcParams`,
  `buildSrc`, `parseSnapshot`, `findKey`, `keyToWire`, `instrumentToWire`, `INSTRUMENT_LABELS`
  are defined in Task 1 and used with identical signatures in Tasks 3-6.
```
