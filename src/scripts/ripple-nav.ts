/**
 * Ripple navigation controller (Phase 3, Task 3.2).
 *
 * Integration approach: B (manual overlay). On a Chord Colors card click we play
 * the WebGL ripple on the persisted full-viewport canvas (the visible hero
 * moment) while ClientRouter swaps the destination page in *underneath* it. The
 * band is opaque and sits at z-index 60 above all content, covering the whole
 * viewport for the duration, so ClientRouter's brief default crossfade is hidden
 * behind it. The band sweeps outward from the click point; behind it the
 * destination page is already in place, so it reads as a wavefront revealing
 * `/work/chord-colors/`. The canvas survives the swap because it is
 * `transition:persist`.
 *
 * Why B over A (a View-Transitions `clip-path` reveal of `::view-transition-new`):
 * B keeps the canvas as the single source of visual truth and never depends on
 * syncing our rAF clock to the browser's view-transition pseudo-element timeline,
 * which is fragile across browsers. B is the "canvas does the visible work" path.
 *
 * We do NOT try to suppress ClientRouter's crossfade (e.g. by overriding the swap
 * in `astro:before-swap`): doing so interferes with the native View Transition
 * the router has already started and throws "Transition was aborted because of
 * invalid state". The opaque band makes suppression unnecessary anyway.
 *
 * Behavior matrix (see Phase 3 spec):
 *  1. Chord Colors click (in-app)      -> ripple from click point, then URL is /work/chord-colors/
 *  2. Any other project click          -> untouched (Phase 2 fade/intro); we don't bind those
 *  3. Deep-link / refresh / direct load -> no ripple (no pointer origin; we only act on the click)
 *  4. Browser Back                      -> no reverse ripple (popstate never enters this path)
 *  5. prefers-reduced-motion: reduce    -> ripple STILL plays (shown to everyone, by request)
 *  6. Any error in the ripple path      -> fall back to a normal navigation (never hangs)
 *
 * Re-wiring: clicks are bound on every `astro:page-load` so cards rendered after a
 * client swap (e.g. Back to home) are covered. We guard against double-binding.
 */

import { navigate } from 'astro:transitions/client';
import { playRipple, canRipple } from './ripple';
// Type-only: the ripple config reaches the client on the anchor's `data-ripple`
// attribute (parsed below), so this browser script never imports the build-time
// YAML loader: work.ts uses node:fs and must stay out of the client bundle.
import type { RippleConfig } from '../data/work';

// True only while a ripple navigation is mid-flight (re-entrancy guard).
let rippleActive = false;

/**
 * Run the ripple as the transition into `href`, then complete the client nav.
 *
 * Sequencing: kick the navigation immediately (ONCE) so ClientRouter swaps the
 * destination DOM in *under* the opaque band. We deliberately do NOT suppress
 * ClientRouter's own crossfade — the full-viewport opaque band sits at z-index 60
 * above all page content and covers the entire viewport for the duration, so the
 * brief default crossfade underneath is never visible. (An earlier attempt to
 * force an animation-free swap via `event.swap` in `astro:before-swap` triggered
 * the browser's "Transition was aborted because of invalid state" because it
 * interfered with the native View Transition ClientRouter had already started.
 * Letting the default swap run is simpler and error-free.)
 *
 * The navigation is already committed before the band runs, so a draw-time
 * failure must NOT trigger a second navigate() — doing so aborts the in-flight
 * transition. We swallow band errors here; the page still swaps. Readiness was
 * pre-checked via canRipple() at the call site, so reaching this point with a
 * broken GL context is unexpected.
 */
async function rippleNavigate(
  href: string,
  x: number,
  y: number,
  cfg: RippleConfig,
): Promise<void> {
  rippleActive = true;
  navigate(href);
  try {
    await playRipple(x, y, cfg);
  } catch (err) {
    console.error('[ripple] band draw failed (navigation already in flight):', err);
  } finally {
    rippleActive = false;
  }
}

function onCardClick(link: HTMLAnchorElement, e: MouseEvent): void {
  // A ripple is already mid-flight (e.g. a second click before it finished):
  // ignore this click entirely so we don't start a competing navigation.
  if (rippleActive) {
    e.preventDefault();
    return;
  }

  // Respect modifier / non-primary clicks: cmd/ctrl/shift/alt-click and
  // middle-click should open a new tab as usual, never ripple.
  if (e.defaultPrevented) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  // The card carries its ripple config as JSON on `data-ripple` (server-rendered
  // from work.yaml); parse it here. No attribute → no ripple → plain navigation.
  let cfg: RippleConfig | undefined;
  try {
    cfg = link.dataset.ripple ? (JSON.parse(link.dataset.ripple) as RippleConfig) : undefined;
  } catch {
    cfg = undefined;
  }

  // Bow out (let the default <a> / ClientRouter navigation happen) when:
  //  - no ripple config for this card, or
  //  - the WebGL ripple can't run on this device/browser.
  // The ripple plays regardless of prefers-reduced-motion: it's the signature
  // effect, intentionally shown to everyone (matches the original prototype).
  // Bowing out BEFORE preventDefault means a single clean navigation with no
  // chance of an aborted-transition error from a second navigate() call.
  if (!cfg || !canRipple()) return;

  // Take over: play the ripple as the navigation.
  e.preventDefault();
  const href = link.href;
  const x = e.clientX;
  const y = e.clientY;

  // Last-resort guard: if even kicking off the ripple navigation throws
  // synchronously, fall back to a hard navigation so the site never gets stuck.
  try {
    void rippleNavigate(href, x, y, cfg);
  } catch (err) {
    console.error('[ripple] failed to start, falling back to plain navigation:', err);
    rippleActive = false;
    window.location.assign(href);
  }
}

function wire(): void {
  document
    .querySelectorAll<HTMLAnchorElement>('a.deep-dive[data-transition="ripple"]')
    .forEach((link) => {
      // Guard against binding the same anchor twice across repeated page-loads.
      if (link.dataset.rippleBound === '1') return;
      link.dataset.rippleBound = '1';
      link.addEventListener('click', (e) => onCardClick(link, e as MouseEvent));
    });
}

// Re-wire after every swap (and on first load). New anchors get bound; already
// bound ones are skipped via the data flag above.
document.addEventListener('astro:page-load', wire);
