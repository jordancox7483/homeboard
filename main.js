'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const express = require('express');

const CONFIG_PATH = path.join(os.homedir(), 'HomeBoard', 'config.json');
const DEFAULTS_PATH = path.join(__dirname, 'config', 'defaults.json');
const EXPRESS_PORT = 3000;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('[Config] Failed to parse config.json:', err.message);
    return JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
  }
}

// Safe subset of config exposed to the browser (no OAuth secrets)
function publicConfig() {
  const c = loadConfig();
  return {
    flickr:  { rotationIntervalSeconds: c.flickr?.rotationIntervalSeconds ?? 60 },
    weather: { units: c.weather?.units ?? 'fahrenheit' },
    display: {
      calendarDaysAhead: c.display?.calendarDaysAhead ?? 30,
      maxEvents:         c.display?.maxEvents ?? 10,
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP fetch helper (handles redirects, timeout)
// ---------------------------------------------------------------------------

function fetchUrl(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const makeRequest = (targetUrl, redirectCount = 0) => {
      if (redirectCount > 5) return reject(new Error('Too many redirects'));
      const client = targetUrl.startsWith('https') ? https : http;
      const req = client.get(
        targetUrl,
        { headers: { 'User-Agent': 'HomeBoard/1.0', ...extraHeaders }, timeout: 20000 },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const next = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, targetUrl).href;
            res.resume();
            return makeRequest(next, redirectCount + 1);
          }
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Request timed out: ${targetUrl}`)); });
    };
    makeRequest(url);
  });
}

// ---------------------------------------------------------------------------
// Shared data functions — used by both IPC handlers and Express routes
// ---------------------------------------------------------------------------

async function getWeatherData() {
  const config = loadConfig();
  const { latitude, longitude, units } = config.weather;
  const tempUnit = units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&temperature_unit=${tempUnit}&wind_speed_unit=mph&timezone=auto`;
  return JSON.parse(await fetchUrl(url));
}

async function getFlickrData() {
  const config = loadConfig();
  const userId = config.flickr.userId;
  const url =
    `https://www.flickr.com/services/feeds/photos_public.gne` +
    `?id=${encodeURIComponent(userId)}&format=json&nojsoncallback=1`;
  const data = JSON.parse(await fetchUrl(url));
  return data.items.map((item) => {
    const largeUrl = item.media.m.replace('_m.jpg', '_b.jpg');
    const authorMatch = item.author.match(/\("(.+)"\)/);
    const authorName = authorMatch ? authorMatch[1] : item.author;
    return { title: item.title, url: largeUrl, mediumUrl: item.media.m, link: item.link, author: authorName };
  });
}

async function getCalendarsData() {
  const { fetchICS, fetchGoogleCalendar } = require('./services/calendar');
  const config = loadConfig();
  const now = new Date();
  const daysAhead = config.display?.calendarDaysAhead ?? 30;
  const maxDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const events = [];

  for (const feed of config.calendars?.publicICS ?? []) {
    try {
      events.push(...await fetchICS(feed.url, feed.name, feed.color, now, maxDate));
    } catch (err) {
      console.error(`[Calendar] ${feed.name} failed:`, err.message);
    }
  }

  let googleConnected = false;
  if (config.google?.refreshToken) {
    try {
      events.push(...await fetchGoogleCalendar(config, now, maxDate));
      googleConnected = true;
    } catch (err) {
      console.error('[Calendar] Google Calendar failed:', err.message);
    }
  }

  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return {
    events: events.slice(0, config.display?.maxEvents ?? 10),
    googleConnected,
  };
}

// ---------------------------------------------------------------------------
// Express web server — serves the dashboard to any device on the network
// ---------------------------------------------------------------------------

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function startExpressServer() {
  const server = express();

  // Static: renderer files (index.html, app.js, styles.css)
  server.use(express.static(path.join(__dirname, 'renderer')));

  // Static: @fontsource packages — the HTML references ../node_modules/@fontsource/...
  // which resolves to /node_modules/@fontsource/... in a browser context
  server.use(
    '/node_modules/@fontsource',
    express.static(path.join(__dirname, 'node_modules/@fontsource'))
  );

  // REST API — all external calls happen here on the Node.js side
  server.get('/api/config', (_req, res) => {
    res.json(publicConfig());
  });

  server.get('/api/weather', async (_req, res) => {
    try {
      res.json(await getWeatherData());
    } catch (err) {
      console.error('[Express /api/weather]', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  server.get('/api/flickr', async (_req, res) => {
    try {
      res.json(await getFlickrData());
    } catch (err) {
      console.error('[Express /api/flickr]', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  server.get('/api/calendars', async (_req, res) => {
    try {
      res.json(await getCalendarsData());
    } catch (err) {
      console.error('[Express /api/calendars]', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  server.listen(EXPRESS_PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('\nHomeBoard web server running:');
    console.log(`  Local:   http://localhost:${EXPRESS_PORT}`);
    console.log(`  Network: http://${ip}:${EXPRESS_PORT}  <-- open this on your iPad\n`);
  });
}

// ---------------------------------------------------------------------------
// Electron window
// ---------------------------------------------------------------------------

let mainWindow = null;

function createWindow() {
  const config = loadConfig();
  const kioskMode = config.display?.kioskMode ?? true;

  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: kioskMode,
    kiosk: kioskMode,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // allows loading local font files from node_modules via relative paths
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
    }
  });
}

app.whenReady().then(() => {
  startExpressServer();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ---------------------------------------------------------------------------
// IPC handlers — Electron renderer uses these; they call the same shared fns
// ---------------------------------------------------------------------------

ipcMain.handle('read-config',     () => loadConfig());
ipcMain.handle('fetch-weather',   () => getWeatherData());
ipcMain.handle('fetch-flickr',    () => getFlickrData());
ipcMain.handle('fetch-calendars', () => getCalendarsData());
ipcMain.handle('open-devtools',   () => mainWindow?.webContents.openDevTools());
