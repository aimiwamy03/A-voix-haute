const { app, BrowserWindow, Menu, dialog, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let server;
const PREFERRED_PORT = 47821;

app.setName('À voix haute');

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 880,
    minHeight: 640,
    title: 'À voix haute',
    backgroundColor: '#0E0E10',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('context-menu', (_event, params) => showContextMenu(win, params));
  // Google rejects sign-in inside the app window, so the account chooser opens in the browser.
  const openGoogle = (url) => {
    try {
      const parsed = new URL(url);
      const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
      const googlePage = parsed.pathname === '/google.html' || parsed.pathname.startsWith('/google.html');
      if (parsed.host !== 'accounts.google.com' && !(local && googlePage)) return false;
    } catch {
      return false;
    }
    shell.openExternal(url);
    return true;
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openGoogle(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!openGoogle(url)) return;
    event.preventDefault();
  });
  return win.loadURL(`http://127.0.0.1:${port}`);
}

// Electron has no right-click menu by default; build one so text can be copied, looked up and translated.
function showContextMenu(win, params) {
  const selection = params.selectionText.trim();
  const template = [];
  if (params.isEditable) {
    template.push({ role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste });
  } else if (selection) {
    template.push({ role: 'copy' });
  }
  if (selection) {
    const label = selection.length > 30 ? `${selection.slice(0, 30)}…` : selection;
    template.push(
      { type: 'separator' },
      {
        label: `Traduire « ${label} »`,
        click: () => shell.openExternal(`https://translate.google.com/?sl=fr&tl=en&op=translate&text=${encodeURIComponent(selection)}`),
      },
    );
    if (process.platform === 'darwin') {
      template.push({ label: `Rechercher « ${label} »`, click: () => win.webContents.showDefinitionForSelection() });
    }
  }
  template.push({ type: 'separator' }, { role: 'selectAll' });
  Menu.buildFromTemplate(template).popup({ window: win });
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    try {
      await systemPreferences.askForMediaAccess('microphone');
    } catch {
      // The recording screen explains a denied microphone.
    }
  }
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'audioCapture');
  });
  try {
    // The packaged app folder is read-only, so saved sessions live in the user's Application Support folder.
    const userData = app.getPath('userData');
    process.env.SESSIONS_DIR ||= path.join(userData, 'sessions');
    process.env.USERS_FILE ||= path.join(userData, 'users.json');
    process.env.AUTH_SECRET_FILE ||= path.join(userData, 'auth-secret');
    const serverUrl = pathToFileURL(path.join(__dirname, '../server/main.js')).href;
    const { startServer } = await import(serverUrl);
    // A fixed port keeps the page's origin stable, so settings saved in localStorage survive a relaunch.
    // If something else holds it, any free port still works; only the saved settings reset.
    server = await startServer(PREFERRED_PORT).catch(() => startServer(0));
    await createWindow(server.address().port);
  } catch (err) {
    dialog.showErrorBox('À voix haute', err?.message || 'Impossible d\'ouvrir l\'application.');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  server?.close();
});
