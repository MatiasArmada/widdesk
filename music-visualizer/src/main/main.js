'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  screen,
  session,
  shell,
  desktopCapturer,
} = require('electron');
const { MediaBridge } = require('./media-bridge.js');
const { SkinRegistry, SCHEME: SKIN_SCHEME } = require('./skin-registry.js');

const WIDTH = 360;
const HEIGHT = 200;
const EDGE_MARGIN = 24;
const SAVE_DEBOUNCE_MS = 500;
const DEBUG = process.env.WIDGET_DEBUG === '1';

/** @type {BrowserWindow | null} */
let win = null;
let bridge = null;
let lastMediaState = null;
let lastMediaArt = null;
let saveTimer = null;
/** @type {SkinRegistry | null} */
let skins = null;
let selectedSkin = null;

// skin://<key>/<path> serves skin assets. "standard" gives real hosts and relative
// url() resolution inside skin.css; "corsEnabled" lets @font-face fetch fonts.
// Registered before app ready, as Electron requires.
protocol.registerSchemesAsPrivileged([
  { scheme: SKIN_SCHEME, privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } },
]);

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(init);
}

// ---------------------------------------------------------------------------
// Persisted window state: { x, y, pinned, skin }
// ---------------------------------------------------------------------------
function statePath() {
  return path.join(app.getPath('userData'), 'widget-state.json');
}

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return {
      x: Number.isFinite(raw.x) ? Math.round(raw.x) : null,
      y: Number.isFinite(raw.y) ? Math.round(raw.y) : null,
      pinned: raw.pinned !== false,
      skin: typeof raw.skin === 'string' ? raw.skin : null,
    };
  } catch {
    return { x: null, y: null, pinned: true, skin: null };
  }
}

function writeStateNow() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const data = { x, y, pinned: win.isAlwaysOnTop(), skin: selectedSkin };
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(data));
  } catch (err) {
    console.warn(`[widget] could not save state: ${err.message}`);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeStateNow, SAVE_DEBOUNCE_MS);
}

/** True when the window's center lies inside some display's work area. */
function isOnVisibleDisplay(x, y) {
  const cx = x + WIDTH / 2;
  const cy = y + HEIGHT / 2;
  return screen.getAllDisplays().some(({ workArea: a }) =>
    cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height
  );
}

function defaultPosition() {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - WIDTH - EDGE_MARGIN, y: a.y + a.height - HEIGHT - EDGE_MARGIN };
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  const saved = readState();
  const pos =
    saved.x !== null && saved.y !== null && isOnVisibleDisplay(saved.x, saved.y)
      ? { x: saved.x, y: saved.y }
      : defaultPosition();

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: saved.pinned,
    title: 'Music Visualizer',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  if (saved.pinned) win.setAlwaysOnTop(true, 'floating');

  // Lock navigation down: this window only ever shows the bundled page.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.once('ready-to-show', () => win.show());
  win.on('move', scheduleSave);
  win.on('closed', () => {
    win = null;
  });

  win.webContents.on('did-finish-load', () => {
    send('window:pinned', win.isAlwaysOnTop());
    if (lastMediaState) send('media:state', lastMediaState);
    if (lastMediaArt) send('media:art', lastMediaArt);
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function isFromOurWindow(event) {
  return win && !win.isDestroyed() && event.sender === win.webContents;
}

// ---------------------------------------------------------------------------
// System audio capture (WASAPI loopback via getDisplayMedia)
// ---------------------------------------------------------------------------
function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          if (!sources.length) {
            callback({});
            return;
          }
          callback({ video: sources[0], audio: 'loopback' });
        })
        .catch((err) => {
          console.warn(`[widget] desktopCapturer failed: ${err.message}`);
          callback({});
        });
    },
    { useSystemPicker: false }
  );
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function setupIpc() {
  ipcMain.on('media:command', (event, msg) => {
    if (!isFromOurWindow(event) || !bridge || typeof msg !== 'object' || msg === null) return;
    bridge.send(msg.name, msg.arg);
  });

  ipcMain.on('window:close', (event) => {
    if (isFromOurWindow(event)) win.close();
  });

  ipcMain.on('window:minimize', (event) => {
    if (isFromOurWindow(event)) win.minimize();
  });

  ipcMain.handle('window:togglePin', (event) => {
    if (!isFromOurWindow(event)) return false;
    const next = !win.isAlwaysOnTop();
    win.setAlwaysOnTop(next, 'floating');
    scheduleSave();
    send('window:pinned', next);
    return next;
  });

  ipcMain.handle('window:getPinned', (event) => (isFromOurWindow(event) ? win.isAlwaysOnTop() : false));

  ipcMain.handle('skins:list', (event) => (isFromOurWindow(event) ? skins.list() : []));

  ipcMain.handle('skins:get', (event) => (isFromOurWindow(event) ? skins.describe(selectedSkin) : null));

  ipcMain.handle('skins:set', (event, key) => {
    if (!isFromOurWindow(event) || typeof key !== 'string' || !skins.get(key)) return null;
    selectedSkin = key;
    scheduleSave();
    return skins.describe(key);
  });

  ipcMain.handle('skins:reload', (event) => {
    if (!isFromOurWindow(event)) return { skins: [], active: null };
    skins.reload();
    selectedSkin = skins.resolveSelection(selectedSkin);
    return { skins: skins.list(), active: skins.describe(selectedSkin) };
  });

  ipcMain.on('skins:openFolder', (event) => {
    if (!isFromOurWindow(event)) return;
    const dir = userSkinsDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[skins] could not create ${dir}: ${err.message}`);
      return;
    }
    shell.openPath(dir).then((error) => {
      if (error) console.warn(`[skins] could not open ${dir}: ${error}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------
function userSkinsDir() {
  return path.join(app.getPath('userData'), 'skins');
}

/** Bundled skins ship with the app; user skins live in userData. Both are listed (see SKINS.md). */
function setupSkins(savedKey) {
  skins = new SkinRegistry({
    roots: [
      { source: 'bundled', dir: path.join(__dirname, '..', '..', 'skins') },
      { source: 'user', dir: userSkinsDir() },
    ],
  });
  skins.reload();
  selectedSkin = skins.resolveSelection(savedKey);
  if (savedKey && savedKey !== selectedSkin) {
    console.warn(`[skins] saved skin "${savedKey}" is unavailable; using "${selectedSkin}"`);
  }
  protocol.handle(SKIN_SCHEME, (request) => skins.handleRequest(request));
}

// ---------------------------------------------------------------------------
// Media bridge
// ---------------------------------------------------------------------------
function startBridge() {
  bridge = new MediaBridge();
  bridge.on('message', (msg) => {
    if (DEBUG) console.log(`[media-bridge] ${msg.type} ${JSON.stringify(msg.payload).slice(0, 200)}`);
    switch (msg.type) {
      case 'state':
        lastMediaState = msg.payload;
        send('media:state', msg.payload);
        break;
      case 'art':
        lastMediaArt = msg.payload;
        send('media:art', msg.payload);
        break;
      case 'error':
        send('media:error', msg.payload);
        break;
      default:
        break;
    }
  });
  bridge.on('exit', () => {
    lastMediaState = null;
    lastMediaArt = null;
  });
  bridge.start();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function init() {
  setupSkins(readState().skin);
  setupDisplayMedia();
  setupIpc();
  createWindow();
  startBridge();
}

app.on('before-quit', () => {
  clearTimeout(saveTimer);
  writeStateNow();
  if (bridge) bridge.stop();
});

app.on('window-all-closed', () => {
  app.quit();
});
