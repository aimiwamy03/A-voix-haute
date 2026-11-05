// Learner preferences live in localStorage so they follow the browser, not the account.
import { PALETTES, DEFAULT_PALETTE } from './silk.js';
import {
  DEFAULT_PREFS,
  LEGACY_PALETTE_KEY,
  PREFS_STORAGE_KEY,
  normalizePrefs,
} from '/shared/prefs.js';

const allowedPalettes = Object.keys(PALETTES);
const listeners = new Set();

function readStored() {
  try {
    const saved = localStorage.getItem(PREFS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // Ignore unreadable storage; fall through to the legacy palette key.
  }
  try {
    const legacy = localStorage.getItem(LEGACY_PALETTE_KEY);
    if (legacy) return { palette: legacy };
  } catch {
    // Storage can be missing in private windows.
  }
  return null;
}

function sanitize(raw) {
  const prefs = normalizePrefs(raw, allowedPalettes);
  if (!(prefs.palette in PALETTES)) prefs.palette = DEFAULT_PALETTE;
  return prefs;
}

function same(a, b) {
  return a.palette === b.palette
    && a.prepSeconds === b.prepSeconds
    && a.autoArmDebate === b.autoArmDebate
    && a.showNotesWhileSpeaking === b.showNotesWhileSpeaking
    && a.markUncertainWords === b.markUncertainWords;
}

function persist(prefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // The choice lasts for this session only.
  }
}

let prefs = sanitize({ ...DEFAULT_PREFS, ...readStored() });

export function getPrefs() {
  return { ...prefs };
}

export function setPref(key, value) {
  const next = sanitize({ ...prefs, [key]: value });
  if (same(prefs, next)) return prefs;
  prefs = next;
  persist(prefs);
  for (const fn of listeners) fn(getPrefs());
  return getPrefs();
}

export function onPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
