// Thinking orbs (vendor/thinking-orbs.js) as a plain canvas: the vanilla twin of the library's React component.
// The app is always dark, so the ink is fixed to light dots.
import { MODE_FRAMES, paintFrame, resolvePreset } from './vendor/thinking-orbs.js';

const still = matchMedia('(prefers-reduced-motion: reduce)');

/** size picks a tuned preset (20, 32 or 64); px draws that preset larger, as the engine allows. */
export function createOrb({ state = 'breathing', size = 64, px = size, label = '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'orb';
  canvas.setAttribute('role', 'img');
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px}px`;
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(px * dpr);
  canvas.height = Math.round(px * dpr);
  const ctx = canvas.getContext('2d');

  let preset;
  const draw = (seconds) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, px, px);
    paintFrame(ctx, MODE_FRAMES[preset.mode](px, seconds * preset.speed, preset.opts), true);
  };

  let raf = 0;
  let visible = false;
  const loop = () => {
    raf = 0;
    draw(performance.now() / 1000);
    if (visible && !still.matches && document.visibilityState !== 'hidden') raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  // A hidden or offscreen orb stops drawing. One that was on the page and left it lets go of its listeners.
  let placed = false;
  const io = new IntersectionObserver(([entry]) => {
    if (canvas.isConnected) placed = true;
    else if (placed) {
      io.disconnect();
      document.removeEventListener('visibilitychange', kick);
      still.removeEventListener('change', kick);
    }
    visible = entry.isIntersecting && canvas.isConnected;
    if (visible) kick();
  });
  io.observe(canvas);
  document.addEventListener('visibilitychange', kick);
  still.addEventListener('change', kick);

  canvas.setOrbState = (next, nextLabel = label) => {
    preset = resolvePreset(next, size);
    canvas.setAttribute('aria-label', nextLabel);
    // Reduced motion keeps one representative frame, as the library does.
    draw(still.matches ? 0.6 : performance.now() / 1000);
  };
  canvas.setOrbState(state, label);
  return canvas;
}

/** A small orb followed by a line of text, for inline "busy" messages. */
export function busyLine(text, state = 'solving') {
  const line = document.createElement('p');
  line.className = 'busy-line';
  line.setAttribute('role', 'status');
  const words = document.createElement('span');
  words.textContent = text;
  line.append(createOrb({ state, size: 20, label: '' }), words);
  line.firstChild.setAttribute('aria-hidden', 'true');
  return line;
}
