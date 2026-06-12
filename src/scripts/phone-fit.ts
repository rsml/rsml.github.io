// Fits each embedded Chord Colors app iframe to its (responsive) phone frame.
//
// The app reflows to its container width but clips below ~iPhone width, so we
// render it at a fixed 390px logical viewport and scale that down to the frame's
// current inner width. A ResizeObserver re-fits on any layout change (e.g. the
// frame shrinking on mobile), so the same code handles desktop and mobile.
//
// Layout-only glue, kept separate from the controls adapter (sim-controls.ts).
// Runs on astro:page-load so it re-applies after client navigations.

const LOGICAL_WIDTH = 390; // app's design width; below this it clips
const BEZEL = 14; // matches .phone-iframe inset in EmbeddedDemo.astro

function fitFrame(frame: Element): void {
  const el = frame as HTMLElement;
  const iframe = el.querySelector('iframe') as HTMLIFrameElement | null;
  if (!iframe) return;
  const innerWidth = el.clientWidth - BEZEL * 2;
  const innerHeight = el.clientHeight - BEZEL * 2;
  if (innerWidth <= 0 || innerHeight <= 0) return;
  const scale = innerWidth / LOGICAL_WIDTH;
  iframe.style.width = `${LOGICAL_WIDTH}px`;
  iframe.style.height = `${innerHeight / scale}px`;
  // CSS zoom, NOT transform: scale(). Browsers (WebKit especially) deliver
  // pointer/touch coordinates into transform-scaled iframes unscaled, so taps
  // inside the app land offset toward the top-left — e.g. tapping the wheel's
  // D registered as F#m. zoom participates in layout and input mapping.
  // zoom also multiplies the iframe's own top/left, so divide the bezel out.
  iframe.style.top = iframe.style.left = `${BEZEL / scale}px`;
  iframe.style.setProperty('zoom', String(scale));
}

let observer: ResizeObserver | null = null;

function fitAll(): void {
  const frames = document.querySelectorAll('.phone-frame');
  if (typeof ResizeObserver === 'undefined') {
    frames.forEach(fitFrame);
    return;
  }
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) fitFrame(entry.target);
    });
  }
  // observe() fires immediately with the current size, so this also does the
  // initial fit. Re-observing an already-observed element is a no-op.
  frames.forEach((frame) => observer!.observe(frame));
}

document.addEventListener('astro:page-load', fitAll);
