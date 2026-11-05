// Animated silk background: soft horizontal folds drifting sideways, with film grain.
// Renders at reduced resolution (the folds are blurry anyway) and pauses when the window is hidden.
// The palette can be changed at runtime with setSilkPalette(); colours fade over TRANSITION_MS.

// bg: base, c1: shadowed folds, c2/c2b: mid-tones (blended across the fabric), c3: highlights.
export const PALETTES = {
  argent: { label: 'Argent', bg: [0.055, 0.055, 0.063], c1: [0.20, 0.20, 0.22], c2: [0.55, 0.55, 0.58], c2b: [0.55, 0.55, 0.58], c3: [0.90, 0.90, 0.92] },
  rose: { label: 'Rose', bg: [0.065, 0.035, 0.05], c1: [0.30, 0.10, 0.20], c2: [0.88, 0.42, 0.64], c2b: [0.95, 0.55, 0.60], c3: [1.00, 0.86, 0.92] },
  bleu: { label: 'Bleu', bg: [0.03, 0.04, 0.075], c1: [0.08, 0.14, 0.34], c2: [0.30, 0.52, 0.96], c2b: [0.35, 0.72, 0.98], c3: [0.84, 0.91, 1.00] },
  roseBleu: { label: 'Rose et bleu', bg: [0.04, 0.035, 0.07], c1: [0.16, 0.10, 0.32], c2: [0.96, 0.42, 0.70], c2b: [0.30, 0.55, 1.00], c3: [0.96, 0.91, 1.00] },
  violet: { label: 'Violet', bg: [0.05, 0.035, 0.075], c1: [0.22, 0.10, 0.36], c2: [0.62, 0.40, 0.96], c2b: [0.78, 0.45, 0.92], c3: [0.93, 0.87, 1.00] },
  orange: { label: 'Orange', bg: [0.07, 0.035, 0.02], c1: [0.34, 0.12, 0.04], c2: [0.98, 0.50, 0.14], c2b: [1.00, 0.68, 0.25], c3: [1.00, 0.90, 0.75] },
  soie: { label: 'Soie', bg: [0.06, 0.05, 0.04], c1: [0.30, 0.25, 0.19], c2: [0.82, 0.72, 0.58], c2b: [0.90, 0.80, 0.66], c3: [1.00, 0.97, 0.90] },
  menthe: { label: 'Menthe', bg: [0.03, 0.06, 0.055], c1: [0.07, 0.24, 0.21], c2: [0.30, 0.80, 0.66], c2b: [0.40, 0.78, 0.86], c3: [0.86, 1.00, 0.95] },
};
export const DEFAULT_PALETTE = 'argent';

const KEYS = ['bg', 'c1', 'c2', 'c2b', 'c3'];
const SPEED = 0.05;
const SCALE = 0.5;
const TRANSITION_MS = 700;

const vertex = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const fragment = `
precision highp float;
uniform vec2 res;
uniform float time;
uniform vec3 bg, c1, c2, c2b, c3;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / res.y;
  // Stretch horizontally so the folds read as long sideways sweeps of fabric.
  vec2 p = vec2(uv.x * 0.55, uv.y * 2.4);
  float t = time;
  vec2 warp = vec2(fbm(p + vec2(t * 0.8, 0.0)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.5, 0.0)));
  float f = fbm(p + 2.2 * warp + vec2(t, 0.0));

  // The two mid-tones drift across the fabric with the warp, so two-colour palettes flow into each other.
  vec3 mid = mix(c2, c2b, smoothstep(0.3, 0.7, warp.y));
  vec3 col = bg;
  col = mix(col, c1, smoothstep(0.40, 0.56, f));
  col = mix(col, mid, smoothstep(0.54, 0.70, f));
  col = mix(col, c3, smoothstep(0.66, 0.86, f));

  // Darken toward the top and bottom edges, like light falling across draped fabric.
  float y = gl_FragCoord.y / res.y;
  col *= mix(0.55, 1.0, smoothstep(0.0, 0.35, y) * smoothstep(1.0, 0.65, y));

  // Film grain.
  col += (hash(gl_FragCoord.xy + fract(t * 40.0) * 100.0) - 0.5) * 0.07;
  gl_FragColor = vec4(col, 1.0);
}
`;

const copy = (palette) => Object.fromEntries(KEYS.map((key) => [key, [...palette[key]]]));
let current = copy(PALETTES[DEFAULT_PALETTE]);
let fade = null;
let redraw = () => {};

export function setSilkPalette(name, { instant = false } = {}) {
  const target = PALETTES[name] || PALETTES[DEFAULT_PALETTE];
  document.documentElement.style.setProperty('--silk-bg', `rgb(${target.bg.map((v) => Math.round(v * 255)).join(' ')})`);
  if (instant) {
    current = copy(target);
    fade = null;
  } else {
    fade = { from: copy(current), to: target, start: performance.now() };
  }
  redraw();
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function start(canvas) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) return;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const colorLocs = Object.fromEntries(KEYS.map((key) => [key, gl.getUniformLocation(program, key)]));
  const resLoc = gl.getUniformLocation(program, 'res');
  const timeLoc = gl.getUniformLocation(program, 'time');

  function resize() {
    canvas.width = Math.max(1, Math.round(innerWidth * SCALE));
    canvas.height = Math.max(1, Math.round(innerHeight * SCALE));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resLoc, canvas.width, canvas.height);
  }

  function applyColors(now) {
    if (fade) {
      const k = Math.min(1, (now - fade.start) / TRANSITION_MS);
      const ease = k * k * (3 - 2 * k);
      for (const key of KEYS) current[key] = fade.from[key].map((v, i) => v + (fade.to[key][i] - v) * ease);
      if (k >= 1) fade = null;
    }
    for (const key of KEYS) gl.uniform3fv(colorLocs[key], current[key]);
  }

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const origin = performance.now();
  let frame = 0;
  let frozenAt = origin;
  function draw(now) {
    frame = 0;
    applyColors(now);
    // With reduced motion the folds hold still; only palette fades animate.
    if (!still.matches) frozenAt = now;
    gl.uniform1f(timeLoc, 12.0 + ((frozenAt - origin) / 1000) * SPEED);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!document.hidden && (!still.matches || fade)) frame = requestAnimationFrame(draw);
  }
  redraw = () => { if (!frame) frame = requestAnimationFrame(draw); };

  addEventListener('resize', () => { resize(); redraw(); });
  document.addEventListener('visibilitychange', redraw);
  still.addEventListener('change', redraw);
  resize();
  draw(origin);
}

const canvas = document.getElementById('silk');
if (canvas) {
  try { start(canvas); } catch (err) { console.warn('Silk background disabled:', err); }
}
