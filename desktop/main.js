'use strict';
// Rig Radar desktop shell: spawns the existing server.js unmodified (same
// one your phone talks to), points a chrome-less window at it, and adds a
// tray icon + Windows-autostart toggle. All the actual app logic still
// lives in ../server.js and public/index.html — this is just a native
// window and process-lifecycle wrapper around them.

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

// When packaged, server.js and its data/lib/public ship as extraResources
// next to the app rather than inside the asar (they're plain Node + a large
// generated map dataset, not Electron UI code) — see package.json's `build`
// block. In dev, everything is still just the parent project folder.
const PROJECT_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');
const SERVER_ENTRY = path.join(PROJECT_ROOT, 'server.js');
const PORT = 3000;
const SERVER_URL = `http://localhost:${PORT}`;

let serverProcess = null;
let mainWindow = null;
let tray = null;
let quitting = false;

function startServer() {
  // electron.exe run with ELECTRON_RUN_AS_NODE behaves as a plain Node
  // binary, so server.js runs exactly as it would under `node server.js` —
  // no separate Node install required on the machine running the app.
  serverProcess = spawn(process.execPath, [SERVER_ENTRY, '--port', String(PORT)], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (!quitting) console.error(`[desktop] server.js exited unexpectedly (code ${code})`);
  });
}

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = http.get(`${SERVER_URL}/api/status`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) { reject(new Error('server did not come up in time')); return; }
        setTimeout(attempt, 250);
      });
    })();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0a0e14',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(SERVER_URL);
  // Closing the window just hides it — the tray icon is the real "quit".
  // Matches how TruckSim-style companion apps stay running unattended.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('Rig Radar');
  refreshTrayMenu();
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide(); else mainWindow.show();
  });
}

function refreshTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: 'Show Rig Radar', click: () => mainWindow.show() },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    { label: 'Quit Rig Radar', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer(15000);
  } catch (err) {
    console.error('[desktop]', err.message);
  }
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Do nothing: the app lives on in the tray until "Quit" is chosen.
});

app.on('before-quit', () => {
  quitting = true;
  if (serverProcess) serverProcess.kill();
});
