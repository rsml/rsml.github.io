/**
 * Phase 2 transition controller.
 *
 * Drives the [data-rise] staggered reveal from the astro:page-load lifecycle
 * event so the animation replays on every ClientRouter swap, not just on hard
 * load. Pure CSS @keyframes alone won't re-trigger on swap because the elements
 * persist in the DOM and the animation already ran. The class toggle forces a
 * new animation lifecycle each time.
 *
 * Outgoing page: ClientRouter's default fade handles the leave. We apply a
 * short custom fadeOut via the page-swap lifecycle so the exit feels clean
 * without a white flash.
 */

// Set when the user navigates back, cleared each time triggerRise runs.
// Two sources: browser back button (popstate) and the in-page back link.
let pendingBack = false;
window.addEventListener('popstate', () => { pendingBack = true; });
document.addEventListener('click', (e) => {
  if ((e.target as Element)?.closest('[data-back-nav]')) pendingBack = true;
});

function triggerRise() {
  const goingBack = pendingBack;
  pendingBack = false;
  // On back navigation, elements fall from above instead of rising from below.
  document.documentElement.style.setProperty('--rise-default', goingBack ? 'fallIn' : 'riseIn');

  document.querySelectorAll<HTMLElement>('[data-rise]').forEach((el) => {
    // Remove and re-add the class in the same microtask tick so the browser
    // sees a genuine class change and restarts the animation.
    el.classList.remove('rise-ready');
    // Force a reflow so the browser registers the removal before adding back.
    void el.offsetWidth;
    el.classList.add('rise-ready');
  });
}

// Fires on every page load: initial hard load AND after each ClientRouter swap.
document.addEventListener('astro:page-load', triggerRise);

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
