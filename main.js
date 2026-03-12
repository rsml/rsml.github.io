import * as THREE from "./vendor/three.module.js";

const SETTINGS_KEY = "rm.vortex.settings.v1";

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
    const raw = localStorage.getItem(SETTINGS_KEY);
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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage issues (private mode, quota).
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

        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - clamp(dot(normalize(vWorldNormal), viewDir), 0.0, 1.0), 2.2);

	        float alpha = uAlpha * (0.92 + 0.08 * fiber) * edges;
	        vec3 color = uColor;
	        color += (fiber - 0.5) * 0.035;
	        color += fresnel * 0.07;

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
    this.params.planeCount = clamp(Math.round(this.params.planeCount), 8, 220);
    this.params.swatchCount = clamp(Math.round(this.params.swatchCount), 6, 120);
    this.params.hueShift = ((this.params.hueShift % 360) + 360) % 360;

    this.params.motionSpeed = clamp(this.params.motionSpeed, 0, 2.5);
    this.params.scrollResponse = clamp(this.params.scrollResponse, -3, 3);
    this.params.scrollSmoothing = clamp(this.params.scrollSmoothing, 1, 40);
    this.params.scrollDeadzone = clamp(Math.round(this.params.scrollDeadzone), 0, 500);

    this.params.height = clamp(this.params.height, 6, 30);
    const half = this.params.height / 2;
    this.params.minY = -half;
    this.params.maxY = half;

    this.params.radiusMin = clamp(this.params.radiusMin, 0.3, 30);
    this.params.radiusMax = clamp(this.params.radiusMax, this.params.radiusMin + 0.2, 30);

    this.params.sizeMean = clamp(this.params.sizeMean, 0.2, 12);
    this.params.sizeVariance = clamp(this.params.sizeVariance, 0, 12);
    this.params.aspectVariance = clamp(this.params.aspectVariance, 0, 1);
    this.params.tiltAmount = clamp(this.params.tiltAmount, 0, 2);
    this.params.regularity = clamp(this.params.regularity, 0, 1);

    this.params.drag = clamp(this.params.drag, 0.05, 12);
    this.params.angularDrag = clamp(this.params.angularDrag, 0.05, 12);
    this.params.updraftAccel = clamp(this.params.updraftAccel, 0, 18);
    this.params.spinAccel = clamp(this.params.spinAccel, 0, 18);
    this.params.baseSpin = clamp(this.params.baseSpin, 0, 0.2);
    this.params.ySpring = clamp(this.params.ySpring, 0, 8);
    this.params.flutter = clamp(this.params.flutter, 0, 1.6);
    this.params.motionVariance = clamp(this.params.motionVariance, 0, 1);

    this.params.edgeSoftness = clamp(this.params.edgeSoftness, 0, 1);
    this.params.alphaScale = clamp(this.params.alphaScale, 0, 3);

    this.params.LBase = clamp(this.params.LBase, 0.35, 0.95);
    this.params.LAmp = clamp(this.params.LAmp, 0, 0.3);
    this.params.CBase = clamp(this.params.CBase, 0, 0.45);
    this.params.CAmp = clamp(this.params.CAmp, 0, 0.3);
    this.params.minChroma = clamp(this.params.minChroma, 0.01, 0.25);
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
    const count = clamp(Math.round(targetCount), 8, 220);
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
    const yRange = this.params.maxY - this.params.minY;
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
      const fadeZ = smoothstep(0.35, 1, (z + userData.radius) / (2 * userData.radius));
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

function pickBestIntersecting(entries) {
  let best = null;
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
  }
  return best;
}

function main() {
  const canvas = document.getElementById("bg");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  let vortex;
  try {
    vortex = new VortexBackground({ canvas });
  } catch (error) {
    console.warn("WebGL background disabled:", error);
    document.body.classList.add("no-webgl");
    const warning = document.getElementById("webglWarning");
    if (warning) warning.hidden = false;
    return;
  }

  document.body.classList.remove("no-webgl");

  const stored = loadSettings();
  const storedTuning = stored.tuning && typeof stored.tuning === "object" ? stored.tuning : null;
  if (storedTuning) vortex.setTuning(storedTuning);

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
  const topbar = document.querySelector(".topbar");

  function syncTopbarOffset() {
    if (!(topbar instanceof HTMLElement)) return;
    const height = Math.max(0, Math.round(topbar.getBoundingClientRect().height));
    document.documentElement.style.setProperty("--topbar-offset", `${height + 18}px`);
  }

  function persistSettings() {
    saveSettings({
      paused: settings.paused,
      reduceMotion: settings.reduceMotion,
      controlsOpen: settings.controlsOpen,
      tuning: vortex.getTuning(),
    });
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
    vortex.setUserMotion({ reduceMotion: settings.reduceMotion });
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
  if (controlsPanel instanceof HTMLElement) {
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
    const tuning = vortex.getTuning();
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
    const key = input.dataset.tune;
    if (!key) return;
    const value = parseControlValue(input);
    if (!Number.isFinite(value)) return;
    vortex.setTuning({ [key]: value });

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

  if (resetButton instanceof HTMLButtonElement) {
    resetButton.addEventListener("click", () => {
      vortex.resetTuning();
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

  const chapterLinks = new Map();
  for (const link of document.querySelectorAll("[data-chapter-link]")) {
    if (!(link instanceof HTMLAnchorElement)) continue;
    const key = link.dataset.chapterLink;
    if (key) chapterLinks.set(key, link);
  }

  let activeChapter = "top";
  function setActiveChapter(key) {
    if (!key || key === activeChapter) return;
    chapterLinks.get(activeChapter)?.classList.remove("is-active");
    chapterLinks.get(key)?.classList.add("is-active");
    activeChapter = key;
  }

  const chapterSections = Array.from(document.querySelectorAll("[data-chapter]"));
  const chapterObserver = new IntersectionObserver(
    (entries) => {
      const best = pickBestIntersecting(entries);
      const key = best?.target?.dataset?.chapter;
      if (!key) return;
      setActiveChapter(key);

      const palette = best.target.dataset.vortexPalette;
      if (palette) vortex.setPalette(palette);
    },
    { root: null, threshold: [0.55], rootMargin: "-42% 0px -42% 0px" },
  );
  for (const section of chapterSections) chapterObserver.observe(section);

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
      vortex.resize();
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
    vortex.setRevealStrength(gapMaxRatio);

    vortex.setScroll({
      progress,
      velocity: settings.paused ? 0 : v,
      dt,
    });

    vortex.update(dt, now / 1000, settings);
    vortex.render();
  }

  requestAnimationFrame(frame);
}

main();
