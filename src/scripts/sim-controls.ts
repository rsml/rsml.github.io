// Adapter for the embedded Chord Colors demo controls.
//
// All DOM + postMessage I/O lives here; pure mapping/serialization is in
// sim-controls-core.ts. State per demo lives as data attributes on the
// .phone-demo wrapper (data-base, data-key, data-instrument, plus authored-only
// data-pinned-scale / data-saved-chords in bridge wire form). The controller:
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
    // Authored embed config (not user-toggled state) — survives reset.
    pinnedScale: demo.dataset.pinnedScale,
    savedChords: demo.dataset.savedChords,
  });
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
