/**
 * Phase 2 transition controller.
 *
 * Sets --rise-from-y on :root before each ClientRouter swap so @starting-style
 * picks up the correct direction (8px = forward/riseIn, -8px = back/fallIn).
 * The transition re-fires automatically on every SPA navigation because
 * ClientRouter re-inserts the main content, triggering @starting-style fresh.
 */

let pendingBack = false;
window.addEventListener('popstate', () => { pendingBack = true; });
document.addEventListener('click', (e) => {
  if ((e.target as Element)?.closest('[data-back-nav]')) pendingBack = true;
});

document.addEventListener('astro:before-swap', () => {
  document.documentElement.style.setProperty('--rise-from-y', pendingBack ? '-8px' : '8px');
  pendingBack = false;
});

/**
 * The cross-origin chordcolors.com iframes on /craft/chord-colors break the
 * browser's View Transition snapshot, so ClientRouter's startViewTransition
 * rejects with a benign InvalidStateError ("Transition was aborted because of
 * invalid state"). The navigation still completes (and on the Chord Colors
 * ripple path the opaque canvas hides the missing crossfade), so swallow only
 * that specific rejection to keep the console clean. Everything else propagates.
 */
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { name?: string; message?: string } | undefined;
  if (reason?.name === 'InvalidStateError' && /transition/i.test(reason.message ?? '')) {
    event.preventDefault();
  }
});
