export const PREFS_STORAGE_KEY = 'avh.settings';
export const LEGACY_PALETTE_KEY = 'avh.silkPalette';
export const PREP_SECONDS = [5 * 60, 10 * 60, 30 * 60];

export const DEFAULT_PREFS = {
  palette: 'argent',
  prepSeconds: 5 * 60,
  autoArmDebate: true,
  showNotesWhileSpeaking: true,
  markUncertainWords: true,
};

export function normalizePrefs(raw, allowedPalettes) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const paletteOk = typeof src.palette === 'string' && src.palette
    && (!allowedPalettes || allowedPalettes.includes(src.palette));
  return {
    palette: paletteOk ? src.palette : DEFAULT_PREFS.palette,
    prepSeconds: PREP_SECONDS.includes(src.prepSeconds) ? src.prepSeconds : DEFAULT_PREFS.prepSeconds,
    autoArmDebate: src.autoArmDebate !== false,
    showNotesWhileSpeaking: src.showNotesWhileSpeaking !== false,
    markUncertainWords: src.markUncertainWords !== false,
  };
}
