import * as THREE from "./vendor/three.module.js";

const SETTINGS_KEY_BASE = "rm.vortex.settings.v1";

function settingsKey() {
  const path = window.location?.pathname || "/";
  return `${SETTINGS_KEY_BASE}:${path}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function damp(current, target, lambda, dt) {
  // Exponential smoothing, stable across frame rates.
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function prefersSaveData() {
  return navigator.connection?.saveData ?? false;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(settingsKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(settingsKey(), JSON.stringify(settings));
  } catch {
    // Ignore storage issues (private mode, quota).
  }
}

function loadPreset() {
  const el = document.getElementById("rmPreset");
  if (!(el instanceof HTMLScriptElement)) return null;
  const raw = el.textContent;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function createNoiseTexture(size = 64) {
  const data = new Uint8Array(size * size);
  for (let i = 0; i < data.length; i += 1) {
    // Slight bias toward midtones reads more like paper than pure random.
    data[i] = 180 + Math.floor((Math.random() - 0.5) * 90);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function srgbFromLinear(value) {
  if (value <= 0.0031308) return 12.92 * value;
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function oklabToLinearSrgb({ L, a, b }) {
  // https://bottosson.github.io/posts/oklab/
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function oklchToSrgb({ L, C, h }) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const lin = oklabToLinearSrgb({ L, a, b });
  return {
    r: srgbFromLinear(lin.r),
    g: srgbFromLinear(lin.g),
    b: srgbFromLinear(lin.b),
    inGamut: lin.r >= 0 && lin.r <= 1 && lin.g >= 0 && lin.g <= 1 && lin.b >= 0 && lin.b <= 1,
  };
}

function fitOklchToGamut({ L, C, h }, minC = 0.06) {
  let chroma = C;
  for (let i = 0; i < 24; i += 1) {
    const rgb = oklchToSrgb({ L, C: chroma, h });
    if (rgb.inGamut) return { ...rgb, L, C: chroma, h };
    chroma *= 0.92;
    if (chroma < minC) break;
  }
  const rgb = oklchToSrgb({ L, C: chroma, h });
  return { ...rgb, L, C: chroma, h };
}

function hueDistance(aDeg, bDeg) {
  const diff = Math.abs(aDeg - bDeg) % 360;
  return Math.min(diff, 360 - diff);
}

function orderSwatchesForSeparation(swatches) {
  if (swatches.length <= 2) return swatches.slice();
  const remaining = swatches.slice();
  const ordered = [];

  ordered.push(remaining.shift());
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const hueScore = hueDistance(last.h, candidate.h);
      const lightScore = Math.abs(last.L - candidate.L) * 120;
      const score = hueScore + lightScore;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }

  return ordered;
}

function generateOklchSwatches({
  count,
  hueOffset = 0,
  seed = 0,
  hueShift = 0,
  lightnessBase = 0.74,
  lightnessAmp = 0.06,
  chromaBase = 0.19,
  chromaAmp = 0.045,
  minChroma = 0.09,
}) {
  // Golden-angle hue sampling avoids clusters without needing randomness.
  const golden = 137.50776405003785;
  const swatches = [];
  const safeCount = Math.max(1, Math.round(count));
  for (let i = 0; i < safeCount; i += 1) {
    const h = (hueOffset + hueShift + i * golden) % 360;

    // L/C ranges chosen to stay vivid without hitting white/black/gray.
    const L = clamp(lightnessBase + lightnessAmp * Math.sin((i + seed) * 0.9), 0.35, 0.95);
    const C = Math.max(minChroma, chromaBase + chromaAmp * Math.cos((i + seed) * 1.13));

    const fitted = fitOklchToGamut({ L, C, h }, minChroma);
    swatches.push({
      L: fitted.L,
      C: fitted.C,
      h: fitted.h,
      r: clamp(fitted.r, 0, 1),
      g: clamp(fitted.g, 0, 1),
      b: clamp(fitted.b, 0, 1),
    });
  }
  return orderSwatchesForSeparation(swatches);
}

function swatchesToThreeColors(swatches) {
  return swatches.map((s) => new THREE.Color().setRGB(s.r, s.g, s.b, THREE.SRGBColorSpace));
}

const PALETTE_CONFIG = {
  intro: { hueOffset: 0, seed: 1 },
  vivy: { hueOffset: 22, seed: 2 },
  chord: { hueOffset: 74, seed: 3 },
  tutor: { hueOffset: 132, seed: 4 },
  text2order: { hueOffset: 188, seed: 5 },
  symphony: { hueOffset: 248, seed: 6 },
};

const DEFAULT_TUNING = {
  planeCount: 52,
  // Scroll-tied rotation (negative reverses direction).
  baseTurns: 0.82,
  axisX: 1.75,
  axisZ: 0.0,

  // Overall motion multiplier (0 == frozen, scroll rotation still works).
  motionSpeed: 0.65,

  // Multiplies scroll velocity before it drives lift/swirl. Can be negative to invert.
  scrollResponse: 0.35,
  scrollSmoothing: 14,
  scrollDeadzone: 40,

  // Geometry and layout.
  height: 12.4,
  radiusMin: 2.05,
  radiusMax: 5.15,
  sizeMean: 2.35,
  sizeVariance: 1.25,
  aspectVariance: 0.55,
  tiltAmount: 1.0,
  regularity: 0.18,

  // Motion shaping.
  drag: 3.2,
  angularDrag: 3.4,
  updraftAccel: 4.2,
  spinAccel: 2.6,
  baseSpin: 0.008,
  ySpring: 1.25,
  flutter: 0.18,
  motionVariance: 1.0,

  // Rendering.
  edgeSoftness: 0.18,
  alphaScale: 1.0,

  // Color (OKLCH).
  swatchCount: 30,
  hueShift: 0,
  LBase: 0.74,
  LAmp: 0.06,
  CBase: 0.2,
  CAmp: 0.05,
  minChroma: 0.09,
};

class VortexBackground {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.enabled = false;

    this.params = { ...DEFAULT_TUNING };
    this._defaults = { ...DEFAULT_TUNING };

    this._applyDerivedBounds();

    this.scroll = {
      progress: 0,
      velocity: 0,
      velocitySmoothed: 0,
    };

    this.reveal = {
      strength: 0,
      strengthSmoothed: 0,
    };

    this.palettes = {};
    this._regeneratePalettes();

    this.activePaletteName = "intro";
    this.targetPaletteName = "intro";
    this.paletteBlend = 1;
    this.time = 0;

    this._init();
  }

  _init() {
    const canvas = this.canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(new THREE.Color("#F4EFE6"), 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.sortObjects = true;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.set(0.35, 0.1, 7.35);

    const group = new THREE.Group();
    scene.add(group);

    const noiseTexture = createNoiseTexture(96);

    const sharedUniforms = {
      uTime: { value: 0 },
      uNoise: { value: noiseTexture },
      uEdgeSoftness: { value: this.params.edgeSoftness },
    };
    this.sharedUniforms = sharedUniforms;

    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      uniform float uTime;
      uniform float uSeed;
      uniform float uFlutter;

      float hash(float n) { return fract(sin(n) * 43758.5453123); }

      void main() {
        vUv = uv;

        vec3 pos = position;

	        // A small, continuous bend reads like tissue paper without looking rubbery.
	        float t = uTime * 0.55;
	        float fx = sin((uv.y * 6.28318) + (t + uSeed) * 1.7);
	        float fy = sin((uv.x * 6.28318) + (t + uSeed) * 1.2);
	        float flutter = (fx + fy) * 0.022 * uFlutter;
	        pos.z += flutter;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `;

	    const fragmentShader = `
		      varying vec2 vUv;
		      varying vec3 vWorldPos;
		      varying vec3 vWorldNormal;

		      uniform sampler2D uNoise;
		      uniform vec3 uColor;
		      uniform float uAlpha;
		      uniform float uSeed;
		      uniform float uEdgeSoftness;

	      float edgeMask(vec2 uv) {
	        // uEdgeSoftness: 0 => crisp, 1 => soft.
	        float inset = mix(0.010, 0.030, uEdgeSoftness);
	        float width = mix(0.007, 0.055, uEdgeSoftness);
	        float e0 = inset;
	        float e1 = inset + width;
	        float mx = smoothstep(e0, e1, uv.x) * smoothstep(e0, e1, 1.0 - uv.x);
	        float my = smoothstep(e0, e1, uv.y) * smoothstep(e0, e1, 1.0 - uv.y);
	        return mx * my;
	      }

	      void main() {
	        vec2 nuv = vUv * 2.6 + vec2(uSeed * 0.17, uSeed * 0.11);
	        float n = texture2D(uNoise, nuv).r;

		        // Subtle fiber: modulate opacity more than color.
		        float fiber = smoothstep(0.22, 0.88, n);
		        float edges = edgeMask(vUv);

		        float alpha = uAlpha * (0.92 + 0.08 * fiber) * edges;
		        vec3 color = uColor;

		        // Premultiply alpha to make blending feel like layered paper instead of glass.
		        gl_FragColor = vec4(color * alpha, alpha);
		      }
		    `;

    const planeGeometry = new THREE.PlaneGeometry(1, 1, 10, 10);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.group = group;
    this.planeGeometry = planeGeometry;
    this._vertexShader = vertexShader;
    this._fragmentShader = fragmentShader;

    this.planes = [];
    this._syncPlaneCount(this.params.planeCount, { resetMotion: true });
    this._applyPlaneLayout({ resetMotion: true, reassignColors: true });

    this._setPalette("intro", true);
    this.enabled = true;
    this.resize();
  }

  _applyDerivedBounds() {
    // Keep these only "safety bounded" (avoid runaway allocations); UI sliders define the normal range.
    this.params.planeCount = clamp(Math.round(this.params.planeCount), 0, 1400);
    this.params.swatchCount = clamp(Math.round(this.params.swatchCount), 1, 256);
    this.params.hueShift = ((this.params.hueShift % 360) + 360) % 360;

    this.params.motionSpeed = clamp(this.params.motionSpeed, 0, 10);
    this.params.scrollResponse = clamp(this.params.scrollResponse, -20, 20);
    this.params.scrollSmoothing = clamp(this.params.scrollSmoothing, 0, 200);
    this.params.scrollDeadzone = clamp(Math.round(this.params.scrollDeadzone), 0, 4000);

    this.params.height = clamp(this.params.height, 0, 240);
    const half = this.params.height / 2;
    this.params.minY = -half;
    this.params.maxY = half;

    this.params.radiusMin = clamp(this.params.radiusMin, 0, 240);
    this.params.radiusMax = clamp(this.params.radiusMax, 0, 240);
    if (this.params.radiusMax < this.params.radiusMin) this.params.radiusMax = this.params.radiusMin;

    this.params.sizeMean = clamp(this.params.sizeMean, 0, 120);
    this.params.sizeVariance = clamp(this.params.sizeVariance, 0, 120);
    this.params.aspectVariance = clamp(this.params.aspectVariance, 0, 4);
    this.params.tiltAmount = clamp(this.params.tiltAmount, 0, 10);
    this.params.regularity = clamp(this.params.regularity, 0, 1);

    this.params.drag = clamp(this.params.drag, 0, 80);
    this.params.angularDrag = clamp(this.params.angularDrag, 0, 80);
    this.params.updraftAccel = clamp(this.params.updraftAccel, 0, 120);
    this.params.spinAccel = clamp(this.params.spinAccel, 0, 120);
    this.params.baseSpin = clamp(this.params.baseSpin, -2, 2);
    this.params.ySpring = clamp(this.params.ySpring, 0, 120);
    this.params.flutter = clamp(this.params.flutter, 0, 10);
    this.params.motionVariance = clamp(this.params.motionVariance, 0, 1);

    this.params.edgeSoftness = clamp(this.params.edgeSoftness, 0, 1);
    this.params.alphaScale = clamp(this.params.alphaScale, 0, 12);

    this.params.LBase = clamp(this.params.LBase, 0, 1);
    this.params.LAmp = clamp(this.params.LAmp, 0, 1);
    this.params.CBase = clamp(this.params.CBase, 0, 1);
    this.params.CAmp = clamp(this.params.CAmp, 0, 1);
    this.params.minChroma = clamp(this.params.minChroma, 0, 1);
  }

  _regeneratePalettes() {
    const options = {
      count: this.params.swatchCount,
      hueShift: this.params.hueShift,
      lightnessBase: this.params.LBase,
      lightnessAmp: this.params.LAmp,
      chromaBase: this.params.CBase,
      chromaAmp: this.params.CAmp,
      minChroma: this.params.minChroma,
    };

    for (const [name, cfg] of Object.entries(PALETTE_CONFIG)) {
      const swatches = generateOklchSwatches({
        ...options,
        hueOffset: cfg.hueOffset,
        seed: cfg.seed,
      });
      this.palettes[name] = swatchesToThreeColors(swatches);
    }
  }

  _createPlane(index) {
    const seed = Math.random() * 1000;
    const palette = this.palettes.intro ?? [];
    const baseColor =
      palette.length > 0
        ? palette[index % palette.length].clone()
        : new THREE.Color().setRGB(0.9, 0.2, 0.2, THREE.SRGBColorSpace);

    const material = new THREE.ShaderMaterial({
      vertexShader: this._vertexShader,
      fragmentShader: this._fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        ...this.sharedUniforms,
        uSeed: { value: seed },
        uFlutter: { value: 1 },
        uColor: { value: baseColor },
        uAlpha: { value: 0.0 },
      },
    });
    material.premultipliedAlpha = true;

    const mesh = new THREE.Mesh(this.planeGeometry, material);
    mesh.scale.set(1, 1, 1);

    const signed = () => Math.random() * 2 - 1;
    mesh.userData = {
      index,
      seed,
      // Simulation state.
      homeY: 0,
      y: 0,
      vy: THREE.MathUtils.lerp(-0.2, 0.2, Math.random()),
      theta: 0,
      omega: THREE.MathUtils.lerp(-0.15, 0.15, Math.random()),
      // Random seeds (stable per plane; tuning just remaps them).
      thetaRand: Math.random(),
      radiusRand: Math.random(),
      yRand: Math.random(),
      sizeRand: Math.random(),
      aspectRand: Math.random(),
      tiltRandX: signed(),
      tiltRandZ: signed(),
      alphaRand: Math.random(),
      liftRand: Math.random(),
      spinRand: Math.random(),
      flutterRand: Math.random(),
      // Derived.
      thetaOffset: 0,
      radius: 0,
      tiltX: 0,
      tiltZ: 0,
      colorIndex: 0,
      baseAlpha: 0.34,
      lift: 1,
      spin: 1,
      flutter: 1,
    };

    this.group.add(mesh);
    this.planes.push(mesh);
    return mesh;
  }

  _syncPlaneCount(targetCount, { resetMotion = false } = {}) {
    if (!this.group) return;
    const count = clamp(Math.round(targetCount), 0, 1400);
    this.params.planeCount = count;

    while (this.planes.length > count) {
      const plane = this.planes.pop();
      if (!plane) break;
      this.group.remove(plane);
      plane.material?.dispose?.();
    }

    while (this.planes.length < count) {
      this._createPlane(this.planes.length);
    }

    for (let i = 0; i < this.planes.length; i += 1) {
      this.planes[i].userData.index = i;
    }

    if (resetMotion) {
      for (const plane of this.planes) {
        plane.userData.theta = 0;
        plane.userData.omega = 0;
        plane.userData.vy = 0;
      }
    }

    if (typeof this.userReduceMotion === "boolean") {
      this.setUserMotion({ reduceMotion: this.userReduceMotion });
    }
  }

  _assignColorIndices(paletteLen) {
    const len = Math.max(1, paletteLen | 0);
    const orderedByAngle = this.planes.slice().sort((a, b) => a.userData.thetaOffset - b.userData.thetaOffset);
    for (let i = 0; i < orderedByAngle.length; i += 1) {
      orderedByAngle[i].userData.colorIndex = i % len;
    }
  }

  _applyPlaneLayout({ resetMotion = false, reassignColors = true } = {}) {
    this._applyDerivedBounds();

    const count = this.planes.length;
    const regularity = this.params.regularity;
    const radiusMin = this.params.radiusMin;
    const radiusMax = this.params.radiusMax;
    const minY = this.params.minY;
    const maxY = this.params.maxY;
    const sizeMean = this.params.sizeMean;
    const sizeVariance = this.params.sizeVariance;
    const aspectVariance = this.params.aspectVariance;
    const tiltAmount = this.params.tiltAmount;
    const motionVariance = this.params.motionVariance;

    for (let i = 0; i < count; i += 1) {
      const plane = this.planes[i];
      const { userData } = plane;
      userData.index = i;

      const t = count > 1 ? i / (count - 1) : 0.5;

      const thetaRand = userData.thetaRand * Math.PI * 2;
      const thetaDet = (i / Math.max(count, 1)) * Math.PI * 2;
      userData.thetaOffset = THREE.MathUtils.lerp(thetaRand, thetaDet, regularity);

      const rTRand = Math.pow(userData.radiusRand, 0.7);
      const rTDet = Math.pow(t, 0.7);
      const rT = THREE.MathUtils.lerp(rTRand, rTDet, regularity);
      userData.radius = THREE.MathUtils.lerp(radiusMin, radiusMax, rT);

      const yTRand = userData.yRand;
      const yTDet = t;
      const yT = THREE.MathUtils.lerp(yTRand, yTDet, regularity);
      const nextHome = THREE.MathUtils.lerp(minY, maxY, yT);

      if (resetMotion) {
        userData.homeY = nextHome;
        userData.y = nextHome;
        userData.vy = 0;
      } else {
        const offset = userData.y - userData.homeY;
        userData.homeY = nextHome;
        userData.y = clamp(nextHome + offset, minY, maxY);
      }

      const rawSize = sizeMean + (userData.sizeRand - 0.5) * 2 * sizeVariance;
      const size = Math.max(0.12, rawSize);
      const aspectRaw = (userData.aspectRand - 0.5) * 2 * aspectVariance;
      const aspect = clamp(aspectRaw, -0.85, 0.85);
      const sx = Math.max(0.12, size * (1 + aspect));
      const sy = Math.max(0.12, size * (1 - aspect));
      plane.scale.set(sx, sy, 1);

      userData.tiltX = userData.tiltRandX * 0.55 * tiltAmount;
      userData.tiltZ = userData.tiltRandZ * 0.8 * tiltAmount;

      const baseAlphaRand = THREE.MathUtils.lerp(0.24, 0.44, userData.alphaRand);
      userData.baseAlpha = THREE.MathUtils.lerp(0.34, baseAlphaRand, motionVariance);

      const liftRand = THREE.MathUtils.lerp(0.65, 1.45, Math.pow(userData.liftRand, 0.6));
      const spinRand = THREE.MathUtils.lerp(0.7, 1.35, Math.pow(userData.spinRand, 0.7));
      const flutterRand = THREE.MathUtils.lerp(0.6, 1.4, Math.pow(userData.flutterRand, 0.6));
      userData.lift = THREE.MathUtils.lerp(1, liftRand, motionVariance);
      userData.spin = THREE.MathUtils.lerp(1, spinRand, motionVariance);
      userData.flutter = THREE.MathUtils.lerp(1, flutterRand, motionVariance);
    }

    if (reassignColors) {
      const paletteLen = this.palettes.intro?.length ?? this.params.swatchCount;
      this._assignColorIndices(paletteLen);
    }
  }

  getTuning() {
    const tuning = {};
    for (const key of Object.keys(DEFAULT_TUNING)) {
      if (key === "axisX" || key === "axisZ") continue;
      tuning[key] = this.params[key];
    }
    return tuning;
  }

  setTuning(partial) {
    if (!partial || typeof partial !== "object") return;

    let needsPalette = false;
    let needsLayout = false;
    let needsCount = false;
    let needsEdge = false;
    let needsColorReindex = false;

    for (const [key, raw] of Object.entries(partial)) {
      if (!(key in this.params)) continue;
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) continue;
      if (this.params[key] === value) continue;
      this.params[key] = value;

      if (key === "planeCount") needsCount = true;
      if (key === "planeCount") needsColorReindex = true;
      if (key === "regularity") needsColorReindex = true;
      if (key === "edgeSoftness") needsEdge = true;
      if (
        key === "swatchCount" ||
        key === "hueShift" ||
        key === "LBase" ||
        key === "LAmp" ||
        key === "CBase" ||
        key === "CAmp" ||
        key === "minChroma"
      ) {
        needsPalette = true;
      }
      if (key === "swatchCount") needsColorReindex = true;

      if (
        key === "planeCount" ||
        key === "height" ||
        key === "radiusMin" ||
        key === "radiusMax" ||
        key === "sizeMean" ||
        key === "sizeVariance" ||
        key === "aspectVariance" ||
        key === "tiltAmount" ||
        key === "regularity" ||
        key === "motionVariance"
      ) {
        needsLayout = true;
      }
    }

    this._applyDerivedBounds();

    if (needsCount && this.enabled) {
      this._syncPlaneCount(this.params.planeCount, { resetMotion: false });
      needsLayout = true;
    }

    if (needsPalette) {
      this._regeneratePalettes();
      needsLayout = true;
    }

    if (needsLayout && this.enabled) {
      this._applyPlaneLayout({ resetMotion: false, reassignColors: needsColorReindex });
    }

    if (needsEdge && this.sharedUniforms?.uEdgeSoftness) {
      this.sharedUniforms.uEdgeSoftness.value = this.params.edgeSoftness;
    }
  }

  resetTuning() {
    for (const [key, value] of Object.entries(this._defaults)) {
      this.params[key] = value;
    }

    this._applyDerivedBounds();
    this._regeneratePalettes();

    if (this.sharedUniforms?.uEdgeSoftness) {
      this.sharedUniforms.uEdgeSoftness.value = this.params.edgeSoftness;
    }

    if (this.enabled) {
      this._syncPlaneCount(this.params.planeCount, { resetMotion: true });
      this._applyPlaneLayout({ resetMotion: true, reassignColors: true });
    }
  }

  randomizeTuning() {
    const randMid = () => (Math.random() + Math.random() + Math.random()) / 3;
    const between = (min, max) => min + (max - min) * randMid();
    const intBetween = (min, max) => Math.round(between(min, max));
    const sometimesNegative = (value, chance = 0.18) => (Math.random() < chance ? -value : value);

    const radiusMin = between(1.1, 3.0);
    const radiusMax = Math.max(radiusMin, radiusMin + between(1.2, 7.8));

    this.setTuning({
      planeCount: intBetween(0, 220),
      height: between(0.0, 24.0),
      radiusMin,
      radiusMax,
      sizeMean: between(0.4, 5.2),
      sizeVariance: between(0.0, 3.2),
      aspectVariance: between(0.1, 0.85),
      tiltAmount: between(0.35, 1.25),
      regularity: between(0.07, 0.6),

      motionSpeed: between(0.2, 0.95),
      scrollResponse: sometimesNegative(between(0.1, 0.7), 0.22),
      baseTurns: sometimesNegative(between(0.35, 1.15), 0.15),
      spinAccel: between(0.8, 4.5),
      updraftAccel: between(0.8, 6.2),
      baseSpin: between(0.0, 0.018),
      drag: between(1.5, 6.0),
      angularDrag: between(1.5, 6.0),
      ySpring: between(0.35, 2.4),
      flutter: between(0.0, 0.35),
      motionVariance: between(0.35, 1.0),
      scrollSmoothing: between(10, 22),
      scrollDeadzone: intBetween(0, 80),
      alphaScale: between(0.55, 1.2),

      swatchCount: intBetween(20, 44),
      hueShift: intBetween(0, 360),
      LBase: between(0.68, 0.82),
      LAmp: between(0.02, 0.12),
      CBase: between(0.16, 0.27),
      CAmp: between(0.01, 0.12),
      minChroma: between(0.085, 0.115),

      edgeSoftness: between(0.0, 0.35),
    });
  }

  resize() {
    if (!this.enabled) return;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Keep the vortex mostly in the margins on wide screens, closer to center on mobile.
    const aspect = width / Math.max(height, 1);
    this.params.axisX = clamp(0.9 + (aspect - 0.8) * 1.15, 0.85, 2.35);

    const reduce = this.userReduceMotion ?? false;
    const saveData = prefersSaveData();
    const dprCap = reduce || saveData ? 1 : width < 540 ? 1.35 : 1.75;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setUserMotion({ reduceMotion }) {
    this.userReduceMotion = !!reduceMotion;
    const visibleCount = reduceMotion ? Math.max(18, Math.floor(this.planes.length * 0.6)) : this.planes.length;
    for (let i = 0; i < this.planes.length; i += 1) {
      const plane = this.planes[i];
      plane.visible = i < visibleCount;
      plane.material.uniforms.uFlutter.value = reduceMotion ? 0.15 : 1;
    }
    this.resize();
  }

  setScroll({ progress, velocity, dt }) {
    this.scroll.progress = clamp(progress, 0, 1);
    const deadzone = this.params.scrollDeadzone ?? 0;
    const smoothing = this.params.scrollSmoothing ?? 14;
    const v = Math.abs(velocity) < deadzone ? 0 : velocity;
    this.scroll.velocity = v;
    this.scroll.velocitySmoothed = damp(this.scroll.velocitySmoothed, v, smoothing, dt);
  }

  setRevealStrength(strength) {
    this.reveal.strength = clamp(strength, 0, 1);
  }

  setPalette(name) {
    this._setPalette(name, false);
  }

  _setPalette(name, immediate) {
    if (!this.palettes[name]) return;
    this.targetPaletteName = name;

    if (immediate) {
      this.activePaletteName = name;
      this.paletteBlend = 1;
      return;
    }

    this.paletteBlend = 0;
  }

  update(dt, _timeSec, { paused, reduceMotion }) {
    if (!this.enabled) return;

    this.group.position.set(this.params.axisX, 0, this.params.axisZ);

    // "Reveal bays" (the whitespace gaps) get more intensity.
    this.reveal.strengthSmoothed = damp(this.reveal.strengthSmoothed, this.reveal.strength, 5, dt);
    const reveal = smoothstep(0.08, 0.72, this.reveal.strengthSmoothed);

    const scrollResponse = this.params.scrollResponse ?? 1;
    const vNorm = clamp((this.scroll.velocitySmoothed / 3000) * scrollResponse, -1, 1);
    const energy = clamp(Math.abs(vNorm), 0, 1);

    // Slow idle motion, ~1/3 speed during active scrolling.
    const speed = this.params.motionSpeed ?? 1;
    const activity = reduceMotion ? energy * 0.35 : energy;
    const timeScale = (reduceMotion ? 0.08 : 0.03 + 0.30 * activity) * speed;
    const simScale = paused ? 0 : (reduceMotion ? 0.08 : 0.05 + 0.30 * activity) * speed;

    // Freeze time-based motion when paused, but keep scroll->rotation and palette changes.
    if (!paused) this.time += dt * timeScale;
    const time = this.time;
    const simDt = dt * simScale;

    const baseTurns = this.params.baseTurns + reveal * 0.12;
    const baseAngle = this.scroll.progress * baseTurns * Math.PI * 2;

    // Even with motion toggled off, keep deterministic scroll->rotation so it never feels broken.
    const spinDir = paused || reduceMotion ? 0 : vNorm;

    // Scroll direction should feel like it carries paper with it:
    // scrolling up (negative v) moves planes up; scrolling down moves them down.
    const updraftAccel = -this.params.updraftAccel * spinDir * (0.35 + 0.65 * reveal);
    const spinAccel = this.params.spinAccel * spinDir * (0.45 + 0.55 * reveal);

    // Palette crossfade, section-driven (not scroll-driven) for stability.
    if (this.activePaletteName !== this.targetPaletteName) {
      this.paletteBlend = clamp(this.paletteBlend + dt * 0.7, 0, 1);
      if (this.paletteBlend >= 1) {
        this.activePaletteName = this.targetPaletteName;
      }
    } else {
      this.paletteBlend = 1;
    }

    const paletteA = this.palettes[this.activePaletteName];
    const paletteB = this.palettes[this.targetPaletteName];

    this.camera.position.x = damp(
      this.camera.position.x,
      0.2 + Math.sin(time * 0.08) * 0.045 + reveal * 0.08,
      3,
      dt,
    );
    this.camera.position.y = damp(this.camera.position.y, 0.06 + reveal * 0.09, 3, dt);
    this.camera.lookAt(this.params.axisX, 0.15, 0);

    const alphaScale = this.params.alphaScale ?? 1;
    const yRange = Math.max(1e-4, this.params.maxY - this.params.minY);
    for (const plane of this.planes) {
      if (!plane.visible) continue;
      const { userData } = plane;

      // Vertical motion: scroll provides impulse, then the plane settles back to its home.
      userData.vy += updraftAccel * userData.lift * simDt;
      userData.vy += (userData.homeY - userData.y) * this.params.ySpring * simDt;
      userData.vy *= Math.exp(-this.params.drag * simDt);
      userData.y += userData.vy * simDt;

      if (userData.y < this.params.minY) {
        userData.y = this.params.minY;
        userData.vy *= -0.35;
      } else if (userData.y > this.params.maxY) {
        userData.y = this.params.maxY;
        userData.vy *= -0.35;
      }

      // Swirl, with a small baseline spin even when idle.
      userData.omega += spinAccel * userData.spin * simDt;
      userData.omega += this.params.baseSpin * (0.65 + reveal * 0.35) * simDt;
      userData.omega *= Math.exp(-this.params.angularDrag * simDt);
      userData.theta += userData.omega * simDt;

      const angle = baseAngle + userData.thetaOffset + userData.theta;
      const x = Math.cos(angle) * userData.radius;
      const z = Math.sin(angle) * userData.radius;

      plane.position.set(x, userData.y, z);

      const flutterActivity = reduceMotion || paused ? 0 : 0.03 + 0.97 * activity;
      const flutter =
        reduceMotion || paused
          ? 0
          : (Math.sin(time * 1.6 + userData.seed) * 0.22 +
              Math.cos(time * 1.1 + userData.seed * 0.7) * 0.18) *
            this.params.flutter *
            userData.flutter *
            flutterActivity;

      plane.rotation.set(
        userData.tiltX + flutter * 0.25,
        angle + Math.PI * 0.5 + flutter * 0.08,
        userData.tiltZ + flutter * 0.35,
      );

      const yNorm = (userData.y - this.params.minY) / yRange;
      const fadeY = smoothstep(0.06, 0.22, yNorm) * smoothstep(0.06, 0.22, 1 - yNorm);
      const radiusSafe = Math.max(1e-4, userData.radius);
      const fadeZ = smoothstep(0.35, 1, (z + radiusSafe) / (2 * radiusSafe));
      const alpha =
        userData.baseAlpha * fadeY * (0.75 + 0.25 * fadeZ) * (0.9 + 0.9 * reveal) * alphaScale;

      const idx = userData.colorIndex;
      const colorA = paletteA[idx % paletteA.length];
      const colorB = paletteB[idx % paletteB.length];

      plane.material.uniforms.uColor.value.copy(colorA).lerp(colorB, this.paletteBlend);
      plane.material.uniforms.uAlpha.value = alpha;
    }

    // Shared time uniform update.
    this.sharedUniforms.uTime.value = time;
  }

  render() {
    if (!this.enabled) return;
    this.renderer.render(this.scene, this.camera);
  }
}

function numberOr(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function threeColorFromOklchEntry(entry, fallback) {
  if (!entry || typeof entry !== "object") return fallback.clone();
  const L = numberOr(entry.L, NaN);
  const C = numberOr(entry.C, NaN);
  const h = numberOr(entry.h, NaN);
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(h)) return fallback.clone();
  const fitted = fitOklchToGamut({ L, C, h }, 0.02);
  return new THREE.Color().setRGB(
    clamp(fitted.r, 0, 1),
    clamp(fitted.g, 0, 1),
    clamp(fitted.b, 0, 1),
    THREE.SRGBColorSpace,
  );
}

function buildAlbersPalette(entries) {
  const fallback = [
    { L: 0.74, C: 0.2, h: 28 },
    { L: 0.74, C: 0.2, h: 235 },
    { L: 0.94, C: 0.03, h: 92 },
    { L: 0.9, C: 0.06, h: 150 },
  ].map((e) => threeColorFromOklchEntry(e, new THREE.Color().setRGB(0.9, 0.2, 0.2, THREE.SRGBColorSpace)));

  const list = Array.isArray(entries) ? entries : [];
  const colors = list.map((e, i) => threeColorFromOklchEntry(e, fallback[i % fallback.length]));
  while (colors.length < 4) colors.push(fallback[colors.length % fallback.length].clone());
  return colors.slice(0, 4);
}

class AlbersShaderBackground {
  constructor({ canvas, pattern = "field", config = {} }) {
    this.canvas = canvas;
    this.pattern = pattern;
    this.enabled = false;

    this.params = {
      edgeSoftness: clamp(numberOr(config.edgeSoftness, 0.04), 0, 1),
      scale: clamp(numberOr(config.scale, 10), 1, 80),
    };

    this.palette = buildAlbersPalette(config.palette);

    this.scroll = {
      progress: 0,
      velocity: 0,
      velocitySmoothed: 0,
    };

    this.userReduceMotion = false;
    this.time = 0;

    this._init();
  }

  _buildFragmentShader(pattern) {
    const shared = `
      precision highp float;

      varying vec2 vUv;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uScroll;
      uniform float uEdgeSoftness;
      uniform float uScale;
      uniform vec3 uPal0;
      uniform vec3 uPal1;
      uniform vec3 uPal2;
      uniform vec3 uPal3;

      float hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float edgeWidthPx() {
        float px = 1.0 / max(1.0, min(uResolution.x, uResolution.y));
        return px * mix(0.75, 14.0, clamp(uEdgeSoftness, 0.0, 1.0));
      }

      float squareMask(vec2 p, float halfSize, float w) {
        float d = max(abs(p.x), abs(p.y)) - halfSize;
        return smoothstep(w, -w, d);
      }
    `;

    if (pattern === "grid") {
      return `
        ${shared}
        void main() {
          float w = edgeWidthPx();
          float aspect = uResolution.x / max(1.0, uResolution.y);
          vec2 p = (vUv - 0.5);
          p.x *= aspect;
          p += vec2(uScroll * 0.18, -uScroll * 0.14);

          float cells = max(2.0, uScale);
          vec2 g = p * cells + vec2(cells * 0.5);
          vec2 id = floor(g);
          vec2 f = fract(g);

          float inset = 0.08;
          float inside = step(inset, f.x) * step(inset, f.y) * step(f.x, 1.0 - inset) * step(f.y, 1.0 - inset);

          float h = hash21(id);
          float pick = floor(h * 3.0);
          vec3 cell = pick < 1.0 ? uPal0 : (pick < 2.0 ? uPal1 : uPal2);

          vec3 col = uPal3;
          col = mix(col, cell, inside);

          // Crisp border around each cell.
          float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          float border = 1.0 - smoothstep(inset - w * 1.25, inset + w * 1.25, edge);
          col = mix(col, uPal3, border * 0.85);

          gl_FragColor = vec4(col, 1.0);
        }
      `;
    }

    if (pattern === "stripes") {
      return `
        ${shared}
        void main() {
          float aspect = uResolution.x / max(1.0, uResolution.y);
          vec2 p = (vUv - 0.5);
          p.x *= aspect;
          p.x += (uScroll - 0.5) * 0.22;

          float bands = max(2.0, uScale);
          float t = (p.x + 1.0) * 0.5 * bands;
          float stripe = mod(floor(t), 2.0);
          vec3 col = stripe < 1.0 ? uPal0 : uPal1;

          gl_FragColor = vec4(col, 1.0);
        }
      `;
    }

    // Default: "field"
    return `
      ${shared}
      void main() {
        float aspect = uResolution.x / max(1.0, uResolution.y);
        vec2 p = (vUv - 0.5) * 2.0;
        p.x *= aspect;
        p += vec2(0.0, (uScroll - 0.5) * 0.22);

        // uScale acts like a zoom for the field study (10 == default scale).
        float zoom = clamp(uScale / 10.0, 0.5, 3.0);
        p *= zoom;

        float w = edgeWidthPx();
        float s0 = 0.92;
        float s1 = 0.64;
        float s2 = 0.38;

        float m0 = squareMask(p, s0, w);
        float m1 = squareMask(p, s1, w);
        float m2 = squareMask(p, s2, w);

        vec3 col = uPal3;
        col = mix(col, uPal0, m0);
        col = mix(col, uPal1, m1);
        col = mix(col, uPal2, m2);

        gl_FragColor = vec4(col, 1.0);
      }
    `;
  }

  _init() {
    const canvas = this.canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(new THREE.Color("#F4EFE6"), 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.sortObjects = false;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uEdgeSoftness: { value: this.params.edgeSoftness },
      uScale: { value: this.params.scale },
      uPal0: { value: this.palette[0].clone() },
      uPal1: { value: this.palette[1].clone() },
      uPal2: { value: this.palette[2].clone() },
      uPal3: { value: this.palette[3].clone() },
    };
    this.uniforms = uniforms;

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `;

    const fragmentShader = this._buildFragmentShader(this.pattern);

    const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      depthWrite: false,
      depthTest: false,
      transparent: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.mesh = mesh;
    this.enabled = true;
    this.resize();
  }

  resize() {
    if (!this.enabled) return;
    const width = window.innerWidth;
    const height = window.innerHeight;

    const reduce = this.userReduceMotion ?? false;
    const saveData = prefersSaveData();
    const dprCap = reduce || saveData ? 1 : width < 540 ? 1.35 : 1.75;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.uniforms.uResolution.value.set(width * dpr, height * dpr);
  }

  setUserMotion({ reduceMotion }) {
    this.userReduceMotion = !!reduceMotion;
    this.resize();
  }

  setRevealStrength(_strength) {
    // No-op (kept for interface compatibility).
  }

  setScroll({ progress, velocity, dt }) {
    this.scroll.progress = clamp(progress, 0, 1);
    const v = velocity;
    this.scroll.velocity = v;
    this.scroll.velocitySmoothed = damp(this.scroll.velocitySmoothed, v, 14, dt);
  }

  update(dt, _timeSec, { paused, reduceMotion }) {
    if (!this.enabled) return;
    if (!paused && !reduceMotion) this.time += dt * 0.08;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uScroll.value = this.scroll.progress;
  }

  render() {
    if (!this.enabled) return;
    this.renderer.render(this.scene, this.camera);
  }
}

function main() {
  const canvas = document.getElementById("bg");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const preset = loadPreset();
  const bgKind = canvas.dataset.bg === "albers" ? "albers" : "vortex";
  const pattern = canvas.dataset.pattern || "field";

  let background;
  try {
    background =
      bgKind === "albers"
        ? new AlbersShaderBackground({ canvas, pattern, config: preset?.albers ?? {} })
        : new VortexBackground({ canvas });
  } catch (error) {
    console.warn("WebGL background disabled:", error);
    document.body.classList.add("no-webgl");
    const warning = document.getElementById("webglWarning");
    if (warning) warning.hidden = false;
    return;
  }

  document.body.classList.remove("no-webgl");

  const hasTuning = typeof background.getTuning === "function" && typeof background.setTuning === "function";
  const canReset = typeof background.resetTuning === "function";
  const canRandomize = typeof background.randomizeTuning === "function";

  const presetTuning = preset?.tuning && typeof preset.tuning === "object" ? preset.tuning : null;
  if (hasTuning && presetTuning) background.setTuning(presetTuning);

  const stored = loadSettings();
  const storedTuning = stored.tuning && typeof stored.tuning === "object" ? stored.tuning : null;
  if (hasTuning && storedTuning) background.setTuning(storedTuning);

  const reduceMotionDefault = prefersReducedMotion() || prefersSaveData();
  const settings = {
    paused: stored.paused === true,
    reduceMotion: typeof stored.reduceMotion === "boolean" ? stored.reduceMotion : reduceMotionDefault,
    reduceMotionUserSet: typeof stored.reduceMotion === "boolean",
    controlsOpen: stored.controlsOpen === true,
  };

  const motionButton = document.getElementById("toggleMotion");
  const reduceButton = document.getElementById("toggleReduceMotion");
  const controlsButton = document.getElementById("toggleControls");
  const controlsPanel = document.getElementById("controlsPanel");
  const resetButton = document.getElementById("resetTuning");
  const randomizeButton = document.getElementById("randomizeTuning");
  const topbar = document.querySelector(".topbar");

  function syncTopbarOffset() {
    if (!(topbar instanceof HTMLElement)) return;
    const height = Math.max(0, Math.round(topbar.getBoundingClientRect().height));
    document.documentElement.style.setProperty("--topbar-offset", `${height + 18}px`);
  }

  function persistSettings() {
    const next = {
      paused: settings.paused,
      reduceMotion: settings.reduceMotion,
      controlsOpen: settings.controlsOpen,
    };
    if (hasTuning) next.tuning = background.getTuning();
    saveSettings(next);
  }

  function syncControls() {
    if (motionButton instanceof HTMLButtonElement) {
      motionButton.setAttribute("aria-pressed", settings.paused ? "true" : "false");
      motionButton.textContent = settings.paused ? "Resume motion" : "Pause motion";
    }
    if (reduceButton instanceof HTMLButtonElement) {
      reduceButton.setAttribute("aria-pressed", settings.reduceMotion ? "true" : "false");
      reduceButton.textContent = settings.reduceMotion ? "Full motion" : "Reduce motion";
    }
    background.setUserMotion?.({ reduceMotion: settings.reduceMotion });
  }

  syncControls();

  function syncControlsPanel() {
    const open = settings.controlsOpen;
    if (controlsButton instanceof HTMLButtonElement) {
      controlsButton.setAttribute("aria-expanded", open ? "true" : "false");
      controlsButton.textContent = open ? "Hide controls" : "Show controls";
    }

    if (topbar instanceof HTMLElement) {
      topbar.classList.toggle("is-expanded", open);
    }

    if (controlsPanel instanceof HTMLElement) {
      controlsPanel.inert = !open;
      controlsPanel.setAttribute("aria-hidden", open ? "false" : "true");
    }

    syncTopbarOffset();
  }

  syncControlsPanel();

  if (motionButton instanceof HTMLButtonElement) {
    motionButton.addEventListener("click", () => {
      settings.paused = !settings.paused;
      persistSettings();
      syncControls();
    });
  }

  if (reduceButton instanceof HTMLButtonElement) {
    reduceButton.addEventListener("click", () => {
      settings.reduceMotion = !settings.reduceMotion;
      settings.reduceMotionUserSet = true;
      persistSettings();
      syncControls();
    });
  }

  const reduceMq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  reduceMq?.addEventListener?.("change", (event) => {
    if (settings.reduceMotionUserSet) return;
    settings.reduceMotion = !!event.matches;
    persistSettings();
    syncControls();
  });

  if (controlsButton instanceof HTMLButtonElement) {
    controlsButton.addEventListener("click", () => {
      settings.controlsOpen = !settings.controlsOpen;
      persistSettings();
      syncControlsPanel();
    });
  }

  function stepDecimals(step) {
    if (!step || step === "any") return 2;
    const dot = step.indexOf(".");
    if (dot === -1) return 0;
    return step.length - dot - 1;
  }

  function formatControlValue(input, value) {
    if (input.dataset.type === "int") return `${Math.round(value)}`;
    const decimals = stepDecimals(input.step);
    return `${Number(value).toFixed(decimals)}`;
  }

  function parseControlValue(input) {
    const raw = input.value;
    if (input.dataset.type === "int") return Number.parseInt(raw, 10);
    return Number.parseFloat(raw);
  }

  const tuningInputs = [];
  if (hasTuning && controlsPanel instanceof HTMLElement) {
    for (const el of controlsPanel.querySelectorAll("[data-tune]")) {
      if (el instanceof HTMLInputElement) tuningInputs.push(el);
    }

    for (const details of controlsPanel.querySelectorAll("details")) {
      details.addEventListener("toggle", () => {
        syncTopbarOffset();
      });
    }
  }

  function syncTuningControls() {
    if (!hasTuning) return;
    const tuning = background.getTuning();
    for (const input of tuningInputs) {
      const key = input.dataset.tune;
      if (!key) continue;
      const value = tuning[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        input.value = formatControlValue(input, value);
      }

      const out = controlsPanel?.querySelector?.(`output[for="${input.id}"]`);
      if (out instanceof HTMLOutputElement) {
        const parsed = parseControlValue(input);
        out.textContent = formatControlValue(input, Number.isFinite(parsed) ? parsed : value);
      }
    }
  }

  function updateOneOutput(input) {
    const out = controlsPanel?.querySelector?.(`output[for="${input.id}"]`);
    if (!(out instanceof HTMLOutputElement)) return;
    const value = parseControlValue(input);
    out.textContent = formatControlValue(input, Number.isFinite(value) ? value : 0);
  }

  function applyTuningFromInput(input, commit) {
    if (!hasTuning) return;
    const key = input.dataset.tune;
    if (!key) return;
    const value = parseControlValue(input);
    if (!Number.isFinite(value)) return;
    background.setTuning({ [key]: value });

    if (commit) {
      syncTuningControls();
      persistSettings();
    }
  }

  for (const input of tuningInputs) {
    updateOneOutput(input);
    const live = input.dataset.live !== "false";

    input.addEventListener("input", () => {
      updateOneOutput(input);
      if (live) applyTuningFromInput(input, false);
    });

    input.addEventListener("change", () => {
      updateOneOutput(input);
      applyTuningFromInput(input, true);
    });
  }

  if (hasTuning && canReset && resetButton instanceof HTMLButtonElement) {
    resetButton.addEventListener("click", () => {
      background.resetTuning();
      syncTuningControls();
      persistSettings();
    });
  }

  if (hasTuning && canRandomize && randomizeButton instanceof HTMLButtonElement) {
    randomizeButton.addEventListener("click", () => {
      background.randomizeTuning();
      syncTuningControls();
      persistSettings();
    });
  }

  syncTuningControls();

  const hint = document.getElementById("scrollHint");
  function setHintHidden(hidden) {
    if (!hint) return;
    hint.classList.toggle("is-hidden", hidden);
  }

  const gapSections = Array.from(document.querySelectorAll(".gap"));
  const gapRatios = new Map(gapSections.map((gap) => [gap, 0]));
  let gapMaxRatio = 0;
  const gapObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        gapRatios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
      }
      let max = 0;
      for (const ratio of gapRatios.values()) max = Math.max(max, ratio);
      gapMaxRatio = max;
    },
    { root: null, threshold: [0, 0.2, 0.4, 0.65, 0.85, 1], rootMargin: "-22% 0px -22% 0px" },
  );
  for (const gap of gapSections) gapObserver.observe(gap);

  let lastTime = performance.now();
  let lastScrollY = window.scrollY || 0;
  let visible = !document.hidden;

  document.addEventListener("visibilitychange", () => {
    visible = !document.hidden;
    lastTime = performance.now();
  });

  window.addEventListener(
    "resize",
    () => {
      background.resize?.();
      syncTopbarOffset();
    },
    { passive: true },
  );

  function frame(now) {
    requestAnimationFrame(frame);

    if (!visible) return;

    const dt = clamp((now - lastTime) / 1000, 0.001, 0.05);
    lastTime = now;

    const scrollY = window.scrollY || 0;
    const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const progress = scrollY / maxScroll;

    const v = (scrollY - lastScrollY) / dt;
    lastScrollY = scrollY;

    setHintHidden(scrollY > 30);

    // Use gap ratio as the "reveal bay" strength (dramatic in whitespace, calm behind panels).
    background.setRevealStrength?.(gapMaxRatio);

    background.setScroll?.({
      progress,
      velocity: settings.paused ? 0 : v,
      dt,
    });

    background.update?.(dt, now / 1000, settings);
    background.render?.();
  }

  requestAnimationFrame(frame);
}

main();
