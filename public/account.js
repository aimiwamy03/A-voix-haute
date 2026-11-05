// Avatar menu plus the Spotify-like Compte page. Settings stay in settings.js.
import { openSettings } from './settings.js';
import { getPrefs } from './prefs.js';

const $ = (id) => document.getElementById(id);
const PREP_LABELS = {
  [5 * 60]: '5 min',
  [10 * 60]: '10 min',
  [30 * 60]: '30 min · examen',
};

export function initials(name = '', email = '') {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word) => [...word][0] || '';
  if (words.length >= 2) return (first(words[0]) + first(words.at(-1))).toUpperCase();
  if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase();
  return first(email).toUpperCase() || '?';
}

const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  gear: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 1 1 2.83 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  list: icon('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  pen: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  lock: icon('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  mail: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  person: icon('<circle cx="12" cy="8" r="4"/><path d="M4 20c1.6-4 14.4-4 16 0"/>'),
  out: icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
};

let bound = false;
let actions = {};
let currentUser = { name: '', email: '', hasPassword: true };

export function bindAccount(next) {
  actions = { ...actions, ...next };
}

export function showAccount(user) {
  currentUser = user;
  const letters = initials(user.name, user.email);
  for (const el of document.querySelectorAll('.avatar')) el.textContent = letters;
  $('account-name').textContent = user.name || user.email || '';
  $('account-button').setAttribute('aria-label', `Compte : ${user.name || user.email || ''}`);
  $('account-button').title = user.name || user.email || '';
  if (!bound) bindMenu();
  bound = true;
  if ($('screen-compte') && !$('screen-compte').hidden) paintCompte({ user });
}

export function paintCompte({ user = currentUser, historyCount = 0 } = {}) {
  const root = $('compte-root');
  if (!root) return;
  const prefs = getPrefs();
  const prep = PREP_LABELS[prefs.prepSeconds] || '5 min';
  const exam = prefs.prepSeconds === 30 * 60;
  const orals = historyCount === 1 ? '1 oral enregistré' : `${historyCount} oraux enregistrés`;
  const login = user.google ? 'Google' : 'E-mail et mot de passe';
  root.replaceChildren();

  const kicker = document.createElement('p');
  kicker.className = 'kicker';
  kicker.textContent = 'Compte';
  const title = document.createElement('h1');
  title.textContent = user.name || user.email || 'Compte';
  root.append(kicker, title);
  if (user.email) {
    const mail = document.createElement('p');
    mail.className = 'compte-email';
    mail.textContent = user.email;
    root.append(mail);
  }

  const search = document.createElement('label');
  search.className = 'compte-search';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Rechercher dans le compte';
  input.setAttribute('aria-label', 'Rechercher dans le compte');
  const go = document.createElement('span');
  go.className = 'compte-search-go';
  go.setAttribute('aria-hidden', 'true');
  go.textContent = '→';
  search.append(input, go);
  root.append(search);

  const hero = document.createElement('div');
  hero.className = 'compte-hero';
  const plan = document.createElement('article');
  plan.className = 'compte-plan';
  plan.innerHTML = `
    <p class="kicker">Votre pratique</p>
    <p class="compte-plan-title">${exam ? 'Examen' : 'Entraînement'}</p>
    <p class="compte-plan-meta">Préparation ${prep} · ${orals} sur cet appareil.</p>
  `;
  hero.append(plan);
  hero.append(tile('Modifier le profil', ICONS.pen, () => openNameDialog(user.name || '')));
  hero.append(tile('Réglages', ICONS.gear, () => openSettings()));
  root.append(hero);

  root.append(group('Pratique', [
    row('Réglages', ICONS.gear, () => openSettings()),
    row('Historique', ICONS.list, () => actions.onHistory?.()),
  ]));

  const accountRows = [
    row('Modifier le profil', ICONS.pen, () => openNameDialog(user.name || '')),
    info('E-mail', ICONS.mail, user.email || '—'),
  ];
  if (user.hasPassword !== false) {
    accountRows.push(row('Changer le mot de passe', ICONS.lock, () => openPasswordDialog()));
  }
  root.append(group('Compte', accountRows));
  root.append(group('Connexion', [
    info('Méthode de connexion', ICONS.person, login),
    row('Déconnexion', ICONS.out, () => actions.onLogout?.()),
  ]));

  input.addEventListener('input', () => filterCompte(root, input.value));
}

function filterCompte(root, query) {
  const needle = query.trim().toLowerCase();
  for (const block of root.querySelectorAll('.compte-group')) {
    let visible = 0;
    for (const item of block.querySelectorAll('.compte-row')) {
      const text = item.textContent.toLowerCase();
      const show = !needle || text.includes(needle);
      item.hidden = !show;
      if (show) visible += 1;
    }
    block.hidden = Boolean(needle) && visible === 0;
  }
}

function tile(label, svg, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'compte-tile';
  button.innerHTML = `${svg}<span>${label}</span>`;
  button.onclick = onClick;
  return button;
}

function group(title, rows) {
  const section = document.createElement('section');
  section.className = 'compte-group';
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.append(heading, ...rows);
  return section;
}

function row(label, svg, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'compte-row';
  button.innerHTML = `${svg}<span class="compte-row-label">${label}</span><span class="compte-chevron" aria-hidden="true">›</span>`;
  button.onclick = onClick;
  return button;
}

function info(label, svg, value) {
  const line = document.createElement('div');
  line.className = 'compte-row is-static';
  const name = document.createElement('span');
  name.className = 'compte-row-label';
  name.textContent = label;
  const detail = document.createElement('span');
  detail.className = 'compte-row-value';
  detail.textContent = value;
  line.append(rangeSvg(svg), name, detail);
  return line;
}

function rangeSvg(svg) {
  const wrap = document.createElement('span');
  wrap.innerHTML = svg;
  return wrap.firstElementChild;
}

function field(id, label, type, value = '') {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  wrap.innerHTML = `<span class="kicker">${label}</span>`;
  const input = document.createElement('input');
  input.id = id;
  input.type = type;
  input.value = value;
  if (type === 'password') input.minLength = 8;
  input.maxLength = type === 'password' ? 128 : 60;
  wrap.append(input);
  return { wrap, input };
}

function openFormDialog({ title, fields, submit, onSubmit }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'settings';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const error = document.createElement('p');
  error.className = 'status is-error';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn block';
  save.textContent = submit;
  save.onclick = async () => {
    error.textContent = '';
    save.disabled = true;
    try {
      await onSubmit();
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      save.disabled = false;
    }
  };
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'text-btn';
  cancel.textContent = 'Annuler';
  cancel.onclick = () => dialog.close();
  dialog.append(heading, ...fields.map((item) => item.wrap), error, save, cancel);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  fields[0]?.input.focus();
}

function openNameDialog(name) {
  const nameField = field('compte-name', 'Nom', 'text', name);
  nameField.input.required = true;
  openFormDialog({
    title: 'Modifier le profil',
    fields: [nameField],
    submit: 'Enregistrer',
    onSubmit: async () => {
      await actions.onSaveName?.(nameField.input.value);
    },
  });
}

function openPasswordDialog() {
  const current = field('compte-current', 'Mot de passe actuel', 'password');
  const next = field('compte-next', 'Nouveau mot de passe', 'password');
  current.input.autocomplete = 'current-password';
  next.input.autocomplete = 'new-password';
  next.input.minLength = 8;
  openFormDialog({
    title: 'Changer le mot de passe',
    fields: [current, next],
    submit: 'Enregistrer',
    onSubmit: async () => {
      await actions.onSavePassword?.(current.input.value, next.input.value);
    },
  });
}

function bindMenu() {
  const button = $('account-button');
  const menu = $('account-menu');
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', () => {
    close();
    actions.onCompte?.();
  });
  $('open-compte').addEventListener('click', () => {
    close();
    actions.onCompte?.();
  });
  $('open-settings').addEventListener('click', () => {
    close();
    openSettings();
  });
}
