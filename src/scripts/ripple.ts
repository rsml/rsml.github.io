/**
 * WebGL ripple module (Phase 3).
 *
 * Ported from the Chord Colors prototype (`prototypes/chord-hover.html`): the
 * vertex/fragment shaders, the GL boot (`setupGL`/`compile`/`sizeCanvas`), and
 * the colored cosine-band animation that the prototype's `navigateTo` ran in its
 * `frame()` rAF loop.
 *
 * Design: this module knows nothing about navigation. It owns one job — draw an
 * expanding colored cosine "wavefront" onto the persisted full-viewport canvas
 * (`[data-ripple-canvas]`) from a click point and resolve a Promise when the
 * sweep finishes. The navigation controller (`ripple-nav.ts`) sequences it with
 * Astro's ClientRouter.
 *
 * Why an internal clock instead of the prototype's clip-path: the prototype read
 * its radius back from a Web Animations clip-path on a real DOM element it was
 * revealing. Here the destination is a *different document* swapped in by
 * ClientRouter, so there is no single element to clip. We own the timeline: a
 * cubic-bezier(easeIn,1,easeOut,1) curve (the exact shape the prototype fed to
 * WAAPI) maps elapsed time -> eased progress -> wave radius, and the same alpha
 * fade-out over the last 15% is applied. Visual result matches the prototype.
 *
 * The GL context lives on a `transition:persist` canvas, so it survives every
 * ClientRouter swap and is booted lazily exactly once.
 */

import type { RippleConfig } from '../data/work';

// ── Shaders (verbatim from the prototype: `const vsSrc =` / `const fsSrc =`) ──

const vsSrc = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fsSrc = `
  precision mediump float;
  varying vec2 v_uv;
  uniform vec2  u_center;     // click point in UV [0..1]
  uniform float u_radius;     // current wave radius in aspect-corrected UV
  uniform float u_band;       // half-width of the cos envelope
  uniform float u_aspect;     // canvas width / height
  uniform float u_alpha;
  uniform int   u_mode;
  uniform float u_period;
  uniform float u_sat;
  uniform float u_light;
  uniform vec3  u_color1;
  uniform vec3  u_color2;
  uniform int   u_scanlines;
  uniform int   u_stripes;

  vec3 hsl2rgb(vec3 hsl) {
    vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
  }

  void main() {
    // Aspect-correct so circles stay circular
    vec2 p = (v_uv - u_center) * vec2(u_aspect, 1.0);
    float d = length(p);
    float dWave = d - u_radius;

    // Cos+1 envelope: 1 at the peak, 0 at +/-band
    float n = clamp(dWave / u_band, -1.0, 1.0);
    float env = 0.5 * (cos(n * 3.14159265) + 1.0);

    // Outside the envelope: fully transparent
    if (abs(dWave) > u_band) {
      gl_FragColor = vec4(0.0); return;
    }

    vec3 color;

    if (u_mode == 0) {
      // V1 chord colors, hue from distance
      float hue = mod(d / u_period, 1.0);
      color = hsl2rgb(vec3(hue, u_sat, u_light));
    } else if (u_mode == 1) {
      // V2 tutor, two-tone gradient based on band position (-1..1 -> 0..1)
      float t = clamp((dWave / u_band + 1.0) * 0.5, 0.0, 1.0);
      color = mix(u_color1, u_color2, t);
    } else if (u_mode == 2) {
      // V3 forge, terminal green with horizontal scanlines
      float scan = step(0.5, fract(v_uv.y * 80.0));
      color = mix(u_color2, u_color1, scan);
    } else if (u_mode == 3) {
      // V4 symphony pro, gold base with five thin staff lines
      float stripes = float(u_stripes);
      float local = fract((dWave / u_band + 1.0) * stripes * 0.5);
      float line = smoothstep(0.46, 0.5, local) * (1.0 - smoothstep(0.5, 0.54, local));
      color = mix(u_color1, u_color2, line * 0.7);
    } else if (u_mode == 4) {
      // V5 openpath, split top/bottom direction for "doors opening"
      float side = sign(p.y);
      color = mix(u_color1, u_color2, 0.5 + 0.5 * side);
    } else if (u_mode == 5) {
      // V6 sms, dotted ring (angular dots)
      float angle = atan(p.y, p.x);
      float dots = step(0.7, sin(angle * 24.0));
      color = mix(u_color1, u_color2, dots);
    } else {
      // V7 vivy, soft rose with gentle radial fade inside
      float t = clamp((dWave / u_band + 1.0) * 0.5, 0.0, 1.0);
      color = mix(u_color1, u_color2, t);
    }

    gl_FragColor = vec4(color * env * u_alpha, env * u_alpha);
  }
`;

// ── GL state (booted lazily, once, on the persisted canvas) ──

type Uniforms = Record<string, WebGLUniformLocation | null>;

let gl: WebGLRenderingContext | null = null;
let prog: WebGLProgram | null = null;
let u: Uniforms = {};
let booted = false;
const dpr = Math.min(window.devicePixelRatio || 1, 2);

/** The persisted full-viewport canvas the ripple draws onto. */
function getCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('[data-ripple-canvas]');
}

function compile(type: number, src: string): WebGLShader | null {
  if (!gl) return null;
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('[ripple] shader compile:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

/**
 * Boot WebGL on the persisted canvas. Returns false if WebGL is unavailable or
 * a shader fails to compile/link, so callers fall back to a plain navigation.
 * Idempotent: only the first successful call does work.
 */
function setupGL(canvas: HTMLCanvasElement): boolean {
  if (booted && gl) return true;
  gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  if (!gl) {
    console.error('[ripple] WebGL unavailable');
    return false;
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return false;

  prog = gl.createProgram();
  if (!prog) return false;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[ripple] link:', gl.getProgramInfoLog(prog));
    return false;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const a = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

  for (const n of [
    'u_center', 'u_radius', 'u_band', 'u_aspect', 'u_alpha', 'u_mode',
    'u_period', 'u_sat', 'u_light', 'u_color1', 'u_color2', 'u_scanlines', 'u_stripes',
  ]) {
    u[n] = gl.getUniformLocation(prog, n);
  }

  booted = true;
  return true;
}

/** Match the backing store to the viewport (CSS px * dpr). */
function sizeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
}

function clearGL(): void {
  if (!gl) return;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

// ── Cubic-bezier easing sampler ──
// The prototype eased the clip radius with cubic-bezier(easeIn/100, 1, easeOut/100, 1)
// (a WAAPI easing string). We own the clock here, so we reproduce that exact curve
// by sampling the bezier. P0=(0,0), P3=(1,1); P1=(x1,y1), P2=(x2,y2).

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  // Solve for the parameter t where the bezier's x equals the target progress,
  // then return the bezier's y at that t. Newton's method with a bisection
  // fallback — standard CSS timing-function evaluation.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (xTarget: number): number => {
    if (xTarget <= 0) return 0;
    if (xTarget >= 1) return 1;
    let t = xTarget;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(t) - xTarget;
      if (Math.abs(x) < 1e-4) return sampleY(t);
      const dx = sampleDX(t);
      if (Math.abs(dx) < 1e-6) break;
      t -= x / dx;
    }
    // Bisection fallback
    let lo = 0;
    let hi = 1;
    t = xTarget;
    while (lo < hi) {
      const x = sampleX(t);
      if (Math.abs(x - xTarget) < 1e-4) break;
      if (x < xTarget) lo = t;
      else hi = t;
      t = (lo + hi) * 0.5;
    }
    return sampleY(t);
  };
}

/**
 * Cheap readiness probe: is the persisted canvas present and can WebGL boot on
 * it? Lets the navigation controller decide BEFORE it commits (preventDefault +
 * navigate) whether to take over with a ripple or bow out to a plain navigation.
 * Idempotent — reuses the booted context. Never throws.
 */
export function canRipple(): boolean {
  try {
    const canvas = getCanvas();
    return !!canvas && setupGL(canvas);
  } catch {
    return false;
  }
}

// ── The reveal animation ──

let playing = false;

/**
 * Draw an expanding colored cosine band on the persisted canvas from (x, y) and
 * resolve when the sweep completes. Does NOT navigate — the caller does that.
 *
 * @param x  click point, CSS px (clientX)
 * @param y  click point, CSS px (clientY)
 * @param cfg ripple config from `getProject(slug).ripple`
 * @throws if WebGL can't boot (caller should fall back to a plain navigation)
 */
export function playRipple(x: number, y: number, cfg: RippleConfig): Promise<void> {
  const canvas = getCanvas();
  if (!canvas) throw new Error('[ripple] persisted canvas not found');
  if (!setupGL(canvas)) throw new Error('[ripple] WebGL init failed');

  // Guard against overlapping ripples (double-click): the second one is ignored.
  if (playing) return Promise.resolve();
  playing = true;

  sizeCanvas(canvas);
  canvas.classList.add('visible');

  const W = window.innerWidth;
  const H = window.innerHeight;

  // Max radius: distance to the farthest corner, plus the band half-width so the
  // band's inner edge clears the corner, plus a small safety pad. (Prototype's
  // `cornerMax + bandWidthPx + 8`.)
  const cornerMax = Math.max(
    Math.hypot(x, y),
    Math.hypot(W - x, y),
    Math.hypot(x, H - y),
    Math.hypot(W - x, H - y),
  );
  const bandWidthPx = cfg.band * H;
  const maxRpx = cornerMax + bandWidthPx + 8;

  // Shader inputs straight from the config (no live controls panel here).
  const aspect = canvas.width / canvas.height;
  const cxFrac = x / W;
  const cyFrac = y / H;
  // Radius is normalized by viewport HEIGHT to match the shader's aspect-corrected
  // length(p) (x scaled by aspect leaves the unit axis on y).
  const maxRuv = maxRpx / H;

  const ease = cubicBezier(cfg.easeIn / 100, 1, cfg.easeOut / 100, 1);
  const duration = Math.max(1, cfg.durationMs);

  return new Promise<void>((resolve) => {
    const start = performance.now();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearGL();
      canvas.classList.remove('visible');
      playing = false;
      resolve();
    };

    // Safety net: never leave the canvas stuck visible / promise unresolved even
    // if rAF is starved (e.g. tab backgrounded mid-ripple).
    const safety = window.setTimeout(finish, duration + 500);

    const frame = () => {
      if (settled) return;
      const elapsed = performance.now() - start;
      const raw = Math.min(elapsed / duration, 1);
      const eased = ease(raw);
      const rUv = eased * maxRuv;
      // Peak of the cosine wave is fully opaque so it covers the swap seam; fade
      // alpha to 0 over the last 15% so the wave gracefully exits. (Prototype.)
      const alpha = Math.min(1, (1 - raw) / 0.15);

      if (gl) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        clearGL();
        gl.uniform2f(u.u_center, cxFrac, 1 - cyFrac);
        gl.uniform1f(u.u_radius, rUv);
        gl.uniform1f(u.u_band, cfg.band);
        gl.uniform1f(u.u_aspect, aspect);
        gl.uniform1f(u.u_alpha, alpha);
        gl.uniform1i(u.u_mode, cfg.mode | 0);
        gl.uniform1f(u.u_period, cfg.period);
        gl.uniform1f(u.u_sat, cfg.sat);
        gl.uniform1f(u.u_light, cfg.light);
        gl.uniform3fv(u.u_color1, cfg.color1 ?? [0.7, 0.7, 0.7]);
        gl.uniform3fv(u.u_color2, cfg.color2 ?? [0.3, 0.3, 0.3]);
        gl.uniform1i(u.u_scanlines, 0);
        gl.uniform1i(u.u_stripes, 5);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      if (raw >= 1) {
        window.clearTimeout(safety);
        finish();
        return;
      }
      requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
  });
}

// Keep the backing store correct if the viewport changes between ripples.
window.addEventListener('resize', () => {
  const canvas = getCanvas();
  if (canvas && booted) sizeCanvas(canvas);
});
