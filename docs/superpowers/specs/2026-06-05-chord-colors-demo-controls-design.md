# Chord Colors demo controls: composite control + ExternalControl bridge

Date: 2026-06-05
Status: Approved design, pending implementation plan
Repo: rsml/rsml.github.io (custom domain `rossmiller.dev`)

## Summary

Rework the embedded Chord Colors demos on the case-study page (`/work/chord-colors/`)
so each demo is driven by a single composite control cluster. The cluster contains its
child controls, **Instrument | Key | Theme | Reset** (left to right, pinned top-right of the
phone), and owns the behavior for all of them. Demos talk to the embedded app through the
app's **ExternalControl bridge**: query params for first paint, `postMessage` for live
changes, and a two-way sync that updates the controls when the app reports its own state
back.

This replaces today's reload-on-every-key-change picker with instant `postMessage` updates,
adds an instrument selector and a dark/light theme toggle, unifies the two near-duplicate
demo wrappers (`EmbeddedDemo`, `TryIt`) into one component, and bakes the "Play with me"
sticker into that component so it appears on every embed.

The host integrator's contract for the bridge lives in the app repo at
`src/features/ExternalControl/README.md`. This spec is the host (portfolio) side.

One part is intentionally deferred (see Risks): the bridge is not yet deployed to
chordcolors.com, so live `postMessage` behavior activates once the app ships it.

## Goals

1. One composite component (`SimControls`) that contains the child controls and owns their
   behavior. Faithful to "one component that contains other components."
2. Drive the embedded app via the ExternalControl protocol: query params on first paint,
   `postMessage` for live changes (no reload).
3. Two-way sync: when the app posts a state snapshot, the controls update to match.
4. Add an instrument selector (Guitar / Piano) to every embedded demo.
5. Add a dark/light theme toggle to the cluster.
6. Unify `EmbeddedDemo` and `TryIt` into a single demo component.
7. Make the "Play with me" sticker part of the demo component and show it on every embed,
   restyled as a jagged-edged sticker (not a button), two lines, askew in a corner.

## Scope

In scope:
- New composite control (`SimControls`) and its child controls (`InstrumentPicker`,
  `KeyPicker`, `ThemePicker`), plus the existing `ResetButton`.
- A decorative `PlaySticker` rendered on every embed.
- A pure core module for value mapping/serialization (no DOM) and a thin DOM/messaging
  adapter script.
- Unifying `EmbeddedDemo` + `TryIt`; updating `ChordColors.astro` usages.
- Every embed on the Chord Colors case study gets the full Instrument | Key | Theme | Reset
  cluster and the sticker.

Out of scope:
- The other case studies and marketing pages (untouched).
- The `sound`, `borrow`, `pinnedScale`, `savedChords`, `header`, `drawer` controls in the
  bridge. We only drive `key`, `instrument`, and `theme` (and `skipOnboarding` on first
  paint). YAGNI.
- The `default` (follow-OS) theme value. The portfolio toggle is binary light/dark; the
  embed is always pinned to one of those, so it never sits in `default`.
- Theming the portfolio page itself. The toggle drives the embedded app's theme only;
  syncing the host page's own light/dark is out of scope unless requested.
- Deploying the bridge to chordcolors.com (separate app-repo work, see Risks).

## Current state

- `EmbeddedDemo.astro` and `TryIt.astro` are ~90% duplicates. Each renders a
  `.phone-demo[data-base][data-key]` wrapper holding a loose `.key-picker` dropdown, a
  `ResetButton` (`.sim-reset`), and the iframe inside a phone frame. They differ only in:
  a bordered card vs plain padding, `loading` lazy vs eager, and `TryIt`'s "Play with me"
  sticker (a rotated pill badge, today only on the one "Try it out" demo).
- `key-picker.ts` drives key changes by **reloading** the iframe to
  `chordcolors.com/<base>/<keyCode>?embed=iphone` (path code like `Cs`), cache-busted with
  `_r=<timestamp>`. Reset reloads to the stored canonical src. There is **no instrument
  control**, **no theme control**, and **no listening to the iframe** (one-way only).
- Shared CSS in `key-picker.css`. Both wrappers `import '../../scripts/key-picker.ts'`.
- Init runs on `astro:page-load` (re-fires after every client navigation under ClientRouter)
  and is idempotent; event handling is delegated on `document` and attached once.
- `ChordColors.astro` renders one `TryIt` (base `/chords`) plus eight `EmbeddedDemo`
  sections; every usage is `defaultKey="C"`.

## Protocol contract (from the app repo)

Verified against `src/features/ExternalControl/{schema,serializeControls,parseControls,outbound,useExternalControlBridge}.ts`:

- **Message shape**, both directions, namespaced, no handshake:
  `{ chordcolors: { key, instrument, theme, ... } }`. Host -> app via
  `iframe.contentWindow.postMessage(msg, "*")`. App -> host via `window.parent.postMessage`
  with target `"*"`, emitted on boot and on every change, de-duplicated against the last
  snapshot sent (no echo loops). The app also suppresses emission while applying an inbound
  message, so host-driven changes do not bounce back.
- **Keys** are musical names on the wire (canonical out, case-insensitive in). The 12
  pitch classes we expose map to wire names `C, C#, D, D#, E, F, F#, G, G#, A, A#, B`. The
  app may emit either enharmonic spelling for the black keys (e.g. `C#` or `Db`), so inbound
  matching must accept both.
- **Instrument** wire tokens are `guitar` / `keyboard`; `piano` is an inbound alias for
  `keyboard`. Snapshots emit `instrument` only when one is selected (it can be absent).
  The app's cached default instrument is `KEYBOARD` (`utils/cachedSounds.ts`).
- **Theme** wire field `theme` with canonical values `light` / `dark` / `default` (the app
  accepts `system` / `auto` as inbound aliases for `default`). The app emits `theme` in its
  outbound snapshot (`serializeControls.ts`), so two-way sync works. The portfolio toggle is
  binary: it sends and parses only `light` / `dark`, and defaults to `light` (matching the
  light case-study page). It never sends `default`, so the embed stays light/dark.
- **Query params** decode to the same shape and are applied once on boot:
  `…{base}?embed=iphone&skipOnboarding=1&key=C&instrument=keyboard&theme=light`.
- Invalid/unknown values are dropped silently; a bad payload never crashes the app.

## Design

### Component composition

```
EmbeddedDemo.astro            unified demo wrapper; owns the iframe + phone frame
  ├─ PlaySticker.astro        decorative "Play with me" seal; on every embed
  └─ SimControls.astro        THE composite: owns key/instrument/theme change + reset
       ├─ InstrumentPicker.astro   dropdown
       ├─ KeyPicker.astro          dropdown
       ├─ ThemePicker.astro        light/dark icon toggle
       └─ ResetButton.astro        already exists, markup only
```

`SimControls` renders a single top-right flex row `.sim-controls` containing its children in
order (Instrument | Key | Theme | Reset), replacing today's two independently-positioned
absolutes. Each dropdown's menu is absolutely positioned relative to its own trigger; the
theme toggle and reset are compact icon buttons.

State lives as data attributes on the demo wrapper:
`.phone-demo[data-base][data-key][data-instrument][data-theme]`. The controller reads/writes
these and finds the iframe via `closest('.phone-demo')`. Controls render their initial state
from props (`defaultKey`, `defaultInstrument`, `defaultTheme`); dropdown menus are built in
JS, idempotently, on `astro:page-load` (same robust pattern as today). The theme toggle's
sun/moon icon is selected by CSS from `.phone-demo[data-theme]`, so flipping the attribute
flips the icon with no extra JS.

### Unifying the wrappers

`EmbeddedDemo.astro` absorbs `TryIt` via props:
- `base: string` (required)
- `defaultKey?: string = 'C'`
- `defaultInstrument?: 'guitar' | 'keyboard' = 'keyboard'`
- `defaultTheme?: 'light' | 'dark' = 'light'`
- `title?: string`
- `eager?: boolean = false`    (eager vs lazy iframe load)
- `bare?: boolean = false`     (plain padding vs bordered card)

The "Play with me" sticker is always rendered (it is part of the component, on every embed),
so there is no `sticker` prop. The "Try it out" usage becomes
`<EmbeddedDemo base="/chords" title="…" eager bare />`. `TryIt.astro` is deleted; its import
and usage in `ChordColors.astro` are replaced.

### Play with me sticker

`PlaySticker.astro` is a small decorative child of `EmbeddedDemo`, rendered on every embed
(not opt-in). It reads as a hand-stuck sticker, not a button:
- A jagged-edged seal shape (three overlapped squares whose union is a 12-point starburst),
  so the edge stays crisp at any size.
- Two lines of text: "Play with" on the first line, "me" on the second.
- Rotated a few degrees (askew) and tucked into the top-left corner of the phone frame,
  overlapping it slightly (the controls sit top-right, so the corners do not collide).
- `pointer-events: none` so it never blocks the iframe; styles scoped to the component.

The exact jagged-edge treatment, rotation, and color are tuned visually during
implementation with a screenshot check, since "jagged" has a few reasonable readings.

### Theme toggle

`ThemePicker.astro` is a compact icon toggle (sun / moon, `.theme-toggle`) placed between
Key and Reset. Clicking it flips `data-theme` on the demo between `light` and `dark`,
repaints (the CSS swaps the icon and updates `aria-pressed`), and posts
`{ chordcolors: { theme } }` to the iframe. Inbound snapshots carrying `theme` flip it back
in sync.

### Ports/adapters split

- **Pure core** `src/scripts/sim-controls-core.ts` (no DOM, no I/O), unit-tested:
  - `buildSrc({ base, key, instrument, theme }): string` builds the first-paint / reset URL.
  - `keyToWire(code)` / `wireToKeyCode(wireName)` with enharmonic alternates.
  - `instrumentToWire(value)` / `wireToInstrument(token)`.
  - `themeToWire(value)` / `wireToTheme(token)` / `nextTheme(value)`.
  - `parseSnapshot(data): { key?, instrument?, theme? }` extracts only the fields we care
    about from a `{ chordcolors: … }` payload, normalising to our internal codes.
  - The `KEYS` table (code, label, hex, wire, enharmonic alts) lives here.
- **Adapter** `src/scripts/sim-controls.ts` does all DOM + messaging, importing the core.

### Control flow

- **First paint**: `EmbeddedDemo` bakes the query-param src using `buildSrc`:
  `https://chordcolors.com{base}?embed=iphone&skipOnboarding=1&key={key}&instrument={instrument}&theme={theme}`.
- **Live change** (user picks a key/instrument, or toggles theme): update `data-*` + repaint
  the control optimistically, then
  `iframe.contentWindow.postMessage({ chordcolors: { … } }, "*")`. No reload.
- **Reset** (full reset to defaults): reload the iframe to `buildSrc` with `key='C'`,
  `instrument='keyboard'`, `theme='light'` cache-busted with `_r`, and snap all controls
  back to their defaults. Discards reader selections and all in-app state.
- **Two-way sync**: a single global `message` listener (attached once), which:
  1. ignores events where `e.origin !== 'https://chordcolors.com'`;
  2. ignores non-`{ chordcolors: … }` payloads;
  3. finds the `.phone-demo` whose `iframe.contentWindow === e.source` (demultiplexing the
     several same-origin embeds on the page);
  4. runs `parseSnapshot` and updates that demo's controls to match. It only updates UI; it
     never re-sends, so there is no echo loop.

### Files

| Action | File |
|---|---|
| new | `src/components/content/SimControls.astro` |
| new | `src/components/content/InstrumentPicker.astro` |
| new | `src/components/content/KeyPicker.astro` |
| new | `src/components/content/ThemePicker.astro` |
| new | `src/components/content/PlaySticker.astro` (scoped sticker styles) |
| new | `src/scripts/sim-controls-core.ts` (pure) |
| new | `src/scripts/sim-controls.ts` (adapter) |
| new | `src/scripts/sim-controls-core.test.ts` |
| modify | `src/components/content/EmbeddedDemo.astro` (unify + render `PlaySticker` + `SimControls`) |
| modify | `src/components/work/ChordColors.astro` (drop `TryIt`; first demo uses props) |
| rename | `src/styles/key-picker.css` -> `src/styles/sim-controls.css` (+ instrument/theme/row styles) |
| keep | `src/components/content/ResetButton.astro` (unchanged) |
| delete | `src/components/content/TryIt.astro` |
| delete | `src/scripts/key-picker.ts` |

## Testing

- Unit tests (vitest, alongside the existing `src/data/work.test.ts`) cover the pure core:
  `buildSrc` for C vs non-C and both instruments and both themes; key wire round-trips
  including enharmonic inbound (`Db` -> the C# option); instrument token mapping including
  the `piano` alias; theme round-trips and `nextTheme`; `parseSnapshot` for payloads with
  each field present alone, all together, and none, plus non-`chordcolors` payloads.
- Manual verification: `pnpm dev`, open `/work/chord-colors/`, confirm every embed shows the
  jagged "Play with me" sticker and the Instrument | Key | Theme | Reset cluster, dropdowns
  open/close, the theme toggle flips its icon, and (once the bridge is live) changes drive
  the app without reload, reset returns to defaults, and in-app changes update the controls.
  Pre-bridge, confirm the controls render and degrade without errors. Screenshot check the
  sticker look.

## Risks and notes

- **Bridge not yet deployed.** chordcolors.com does not yet honor the protocol, so live
  key/instrument/theme switching and two-way sync stay inert until the app ships
  ExternalControl. The portfolio is also not yet deployed, so sequencing the bridge deploy
  before/with the portfolio avoids any public gap. All current demos default to key C, so
  first paint looks identical pre- and post-bridge. (A boot-snapshot feature-detection
  fallback to today's path-based reload was considered and deliberately left out for
  simplicity; revisit only if a public gap becomes likely.)
- **Origin check on inbound.** The host verifies `e.origin === 'https://chordcolors.com'`
  before trusting a snapshot, so other frames cannot spoof control of the cluster.
- **Instrument label.** UI shows "Piano" for the `keyboard` instrument (friendlier than
  "keyboard"); the wire token sent remains `keyboard`. Default selection is Piano, matching
  the app's cached default.
- **Theme default.** The toggle defaults to `light` to match the light case-study page; the
  app emits `theme` so the toggle self-corrects from the boot snapshot once the bridge is
  live.
- **View Transitions.** Init stays on `astro:page-load` and idempotent; the global message
  listener and delegated click handlers attach once per page lifecycle.
