// Réglages: practice defaults plus the silk background. Choices live in localStorage.
import { PALETTES, setSilkPalette } from './silk.js';
import { getPrefs, onPrefs, setPref } from './prefs.js';
import { PREP_SECONDS } from '/shared/prefs.js';

const PREP_LABELS = {
  [5 * 60]: '5 min',
  [10 * 60]: '10 min',
  [30 * 60]: '30 min · examen',
};

const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;
const preview = (p) => `radial-gradient(120% 90% at 20% 30%, ${rgb(p.c3)} 0%, ${rgb(p.c2)} 28%, transparent 60%),
  radial-gradient(120% 90% at 85% 75%, ${rgb(p.c2b)} 0%, ${rgb(p.c1)} 35%, transparent 70%), ${rgb(p.bg)}`;

function section(title) {
  const block = document.createElement('section');
  block.className = 'settings-section';
  const kicker = document.createElement('p');
  kicker.className = 'kicker';
  kicker.textContent = title;
  block.append(kicker);
  return block;
}

function segmented(name, values, labels, selected, onPick) {
  const group = document.createElement('div');
  group.className = 'segmented settings-segments';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', name);
  for (const value of values) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `segment${value === selected ? ' is-selected' : ''}`;
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(value === selected));
    option.dataset.seconds = String(value);
    option.textContent = labels[value];
    option.onclick = () => onPick(value);
    group.append(option);
  }
  return group;
}

function toggleRow({ id, label, hint, checked, onToggle }) {
  const row = document.createElement('button');
  row.type = 'button';
  row.id = id;
  row.className = 'pref-row';
  row.setAttribute('role', 'switch');
  row.setAttribute('aria-checked', String(checked));

  const copy = document.createElement('span');
  copy.className = 'pref-copy';
  const title = document.createElement('span');
  title.className = 'pref-label';
  title.textContent = label;
  const note = document.createElement('span');
  note.className = 'pref-hint';
  note.textContent = hint;
  copy.append(title, note);

  const knob = document.createElement('span');
  knob.className = 'switch';
  knob.setAttribute('aria-hidden', 'true');
  row.append(copy, knob);
  row.onclick = () => onToggle(row.getAttribute('aria-checked') !== 'true');
  return row;
}

function paintSwatches(grid, choice) {
  for (const option of grid.children) {
    option.setAttribute('aria-checked', String(option.dataset.palette === choice));
  }
}

function paintPrep(group, seconds) {
  for (const option of group.children) {
    const selected = Number(option.dataset.seconds) === seconds;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-checked', String(selected));
  }
}

function paintSwitch(row, checked) {
  row.setAttribute('aria-checked', String(checked));
}

function buildDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'settings';
  dialog.setAttribute('aria-labelledby', 'settings-title');

  const title = document.createElement('h2');
  title.id = 'settings-title';
  title.textContent = 'Réglages';
  const lead = document.createElement('p');
  lead.className = 'settings-lead';
  lead.textContent = 'Ces choix restent sur cet appareil.';

  const practice = section('Pratique');
  const prepLabel = document.createElement('p');
  prepLabel.className = 'settings-field-label';
  prepLabel.id = 'settings-prep-label';
  prepLabel.textContent = 'Durée de préparation';
  const prepHint = document.createElement('p');
  prepHint.className = 'pref-hint';
  prepHint.textContent = 'Le minuteur de la page Sujet démarre sur ce temps.';
  const prepGroup = segmented('settings-prep-label', PREP_SECONDS, PREP_LABELS, getPrefs().prepSeconds, (seconds) => {
    setPref('prepSeconds', seconds);
  });
  practice.append(prepLabel, prepHint, prepGroup);

  const toggles = document.createElement('div');
  toggles.className = 'pref-list';
  const autoArm = toggleRow({
    id: 'settings-auto-arm',
    label: 'Enregistrement automatique du débat',
    hint: 'Le micro s\'arme juste après chaque question.',
    checked: getPrefs().autoArmDebate,
    onToggle: (on) => setPref('autoArmDebate', on),
  });
  const notes = toggleRow({
    id: 'settings-notes',
    label: 'Notes pendant l\'oral',
    hint: 'Elles restent visibles à l\'écran, comme le jour de l\'examen.',
    checked: getPrefs().showNotesWhileSpeaking,
    onToggle: (on) => setPref('showNotesWhileSpeaking', on),
  });
  const uncertain = toggleRow({
    id: 'settings-uncertain',
    label: 'Mots incertains',
    hint: 'Le retour souligne ce que la reconnaissance a mal entendu.',
    checked: getPrefs().markUncertainWords,
    onToggle: (on) => setPref('markUncertainWords', on),
  });
  toggles.append(autoArm, notes, uncertain);
  practice.append(toggles);

  const look = section('Apparence');
  const bgLabel = document.createElement('p');
  bgLabel.className = 'settings-field-label';
  bgLabel.id = 'settings-bg-label';
  bgLabel.textContent = 'Arrière-plan';
  const grid = document.createElement('div');
  grid.className = 'swatches';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-labelledby', 'settings-bg-label');
  for (const [name, palette] of Object.entries(PALETTES)) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'swatch';
    option.dataset.palette = name;
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(name === getPrefs().palette));
    const chip = document.createElement('span');
    chip.className = 'swatch-chip';
    chip.style.background = preview(palette);
    const text = document.createElement('span');
    text.textContent = palette.label;
    option.append(chip, text);
    option.onclick = () => setPref('palette', name);
    grid.append(option);
  }
  look.append(bgLabel, grid);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn block';
  done.textContent = 'Terminé';
  done.onclick = () => dialog.close();

  dialog.append(title, lead, practice, look, done);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });

  let palette = getPrefs().palette;
  onPrefs((prefs) => {
    paintPrep(prepGroup, prefs.prepSeconds);
    paintSwitch(autoArm, prefs.autoArmDebate);
    paintSwitch(notes, prefs.showNotesWhileSpeaking);
    paintSwitch(uncertain, prefs.markUncertainWords);
    paintSwatches(grid, prefs.palette);
    if (prefs.palette !== palette) {
      palette = prefs.palette;
      setSilkPalette(palette);
    }
  });

  return dialog;
}

let openDialog = () => {};

export function openSettings() {
  openDialog();
}

function init() {
  setSilkPalette(getPrefs().palette, { instant: true });
  const dialog = buildDialog();
  document.body.append(dialog);
  openDialog = () => {
    dialog.showModal();
    dialog.querySelector('[aria-checked="true"]')?.focus();
  };
}

init();
