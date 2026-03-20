'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

const CONFIG_PATH   = path.join(os.homedir(), 'HomeBoard', 'config.json');
const LOG_PATH      = path.join(os.homedir(), 'HomeBoard', 'homeboard.log');
const DEFAULTS_PATH = path.join(__dirname, 'config', 'defaults.json');
const EXPRESS_PORT  = 3000;

// ---------------------------------------------------------------------------
// Logger — ~/HomeBoard/homeboard.log + stdout
// ---------------------------------------------------------------------------

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* ignore write failures */ }
}

// Catch anything that would silently kill the main process
process.on('uncaughtException', (err) => {
  log('FATAL uncaughtException:', err.stack || err.message);
});
process.on('unhandledRejection', (reason) => {
  log('FATAL unhandledRejection:', reason?.stack || reason?.message || String(reason));
});

// Stamp the log on every launch so runs are easy to separate
log('='.repeat(60));
log('HomeBoard starting');
log('Platform:', process.platform, process.arch);
log('Electron:', process.versions.electron, '  Node:', process.versions.node);
log('__dirname:', __dirname);
log('CONFIG_PATH:', CONFIG_PATH, '  exists:', fs.existsSync(CONFIG_PATH));
log('DEFAULTS_PATH:', DEFAULTS_PATH, '  exists:', fs.existsSync(DEFAULTS_PATH));

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log('Config not found — creating from defaults');
    const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    log('Config loaded OK — flickrId:', cfg.flickr?.userId,
        ' lat:', cfg.weather?.latitude, ' kioskMode:', cfg.display?.kioskMode);
    return cfg;
  } catch (err) {
    log('Config parse error:', err.message, '— falling back to defaults');
    return JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
  }
}

function publicConfig() {
  const c = loadConfig();
  // Strip only OAuth credentials — everything else is safe to expose on the LAN
  return {
    flickr:           { rotationIntervalSeconds: c.flickr?.rotationIntervalSeconds ?? 60 },
    weather:          { units: c.weather?.units ?? 'fahrenheit',
                        locationName: c.weather?.locationName ?? '',
                        forecastDays: c.weather?.forecastDays ?? 3 },
    display:          { calendarDaysAhead: c.display?.calendarDaysAhead ?? 30,
                        maxEvents: c.display?.maxEvents ?? 10 },
    calendarPanel:    c.calendarPanel    ?? {},
    widgetVisibility: c.widgetVisibility ?? {},
    countdowns:       c.countdowns       ?? [],
    widgets:          c.widgets          ?? {},
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
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${targetUrl}`)); });
    };
    makeRequest(url);
  });
}

// ---------------------------------------------------------------------------
// Shared data functions
// ---------------------------------------------------------------------------

async function getWeatherData() {
  log('IPC/API: getWeatherData called');
  const config = loadConfig();
  const { latitude, longitude, units } = config.weather;
  const forecastDays = config.weather?.forecastDays ?? 3;
  const tempUnit = units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  let url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&temperature_unit=${tempUnit}&wind_speed_unit=mph&timezone=auto`;
  if (forecastDays > 0) {
    url += `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
           `&forecast_days=${forecastDays + 1}`;
  }
  const text = await fetchUrl(url);
  log('IPC/API: getWeatherData OK, response length:', text.length);
  return JSON.parse(text);
}

async function geocodeLocation(query) {
  log('IPC/API: geocodeLocation:', query);
  const url = `https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const text = await fetchUrl(url);
  const data = JSON.parse(text);
  const results = (data.results ?? []).map(r => ({
    name:      r.name,
    state:     r.admin1 ?? '',
    country:   r.country ?? '',
    latitude:  r.latitude,
    longitude: r.longitude,
  }));
  log('IPC/API: geocodeLocation returned', results.length, 'results');
  return results;
}

async function getFlickrData() {
  log('IPC/API: getFlickrData called');
  const config = loadConfig();
  const userId = config.flickr.userId;
  const url =
    `https://www.flickr.com/services/feeds/photos_public.gne` +
    `?id=${encodeURIComponent(userId)}&format=json&nojsoncallback=1`;
  const text = await fetchUrl(url);
  const data = JSON.parse(text);
  log('IPC/API: getFlickrData OK, photos:', data.items?.length ?? 0);
  return data.items.map((item) => {
    const largeUrl = item.media.m.replace('_m.jpg', '_b.jpg');
    const authorMatch = item.author.match(/\("(.+)"\)/);
    const authorName = authorMatch ? authorMatch[1] : item.author;
    return { title: item.title, url: largeUrl, mediumUrl: item.media.m, link: item.link, author: authorName };
  });
}

async function getCalendarsData() {
  log('IPC/API: getCalendarsData called');
  let calendarModule;
  try {
    calendarModule = require('./services/calendar');
    log('IPC/API: calendar service loaded OK');
  } catch (err) {
    log('IPC/API: FAILED to load calendar service:', err.message);
    throw err;
  }
  const { fetchICS, fetchGoogleCalendar } = calendarModule;
  const config = loadConfig();
  const now = new Date();
  const daysAhead = config.display?.calendarDaysAhead ?? 30;
  const maxDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const events = [];

  for (const feed of config.calendars?.publicICS ?? []) {
    try {
      log('IPC/API: fetching ICS:', feed.name, feed.url);
      const feedEvents = await fetchICS(feed.url, feed.name, feed.color, now, maxDate);
      log('IPC/API: ICS', feed.name, 'returned', feedEvents.length, 'events');
      events.push(...feedEvents);
    } catch (err) {
      log(`IPC/API: ICS ${feed.name} FAILED:`, err.message);
    }
  }

  let googleConnected = false;
  if (config.google?.refreshToken) {
    try {
      log('IPC/API: fetching Google Calendar');
      const gcalEvents = await fetchGoogleCalendar(config, now, maxDate);
      log('IPC/API: Google Calendar returned', gcalEvents.length, 'events');
      events.push(...gcalEvents);
      googleConnected = true;
    } catch (err) {
      log('IPC/API: Google Calendar FAILED:', err.message);
    }
  } else {
    log('IPC/API: Google Calendar skipped (no refresh token)');
  }

  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  const result = { events: events.slice(0, config.display?.maxEvents ?? 10), googleConnected };
  log('IPC/API: getCalendarsData done, total events:', result.events.length);
  return result;
}

// ---------------------------------------------------------------------------
// Express web server
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
  log('Express: loading express module');
  const expressApp = require('express')();
  log('Express: express module loaded OK');

  expressApp.use(require('express').static(path.join(__dirname, 'renderer')));
  expressApp.use(
    '/node_modules/@fontsource',
    require('express').static(path.join(__dirname, 'node_modules/@fontsource'))
  );

  expressApp.get('/api/config', (_req, res) => {
    log('Express: GET /api/config');
    res.json(publicConfig());
  });
  expressApp.get('/api/weather', async (_req, res) => {
    try { res.json(await getWeatherData()); }
    catch (err) { log('Express /api/weather error:', err.message); res.status(502).json({ error: err.message }); }
  });
  expressApp.get('/api/flickr', async (_req, res) => {
    try { res.json(await getFlickrData()); }
    catch (err) { log('Express /api/flickr error:', err.message); res.status(502).json({ error: err.message }); }
  });
  expressApp.get('/api/calendars', async (_req, res) => {
    try { res.json(await getCalendarsData()); }
    catch (err) { log('Express /api/calendars error:', err.message); res.status(502).json({ error: err.message }); }
  });

  expressApp.post('/api/calendar-config', require('express').json(), (req, res) => {
    log('Express: POST /api/calendar-config', JSON.stringify(req.body));
    try {
      const cfg = loadConfig();
      cfg.calendarPanel = { ...(cfg.calendarPanel ?? {}), ...req.body };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      res.json({ ok: true });
    } catch (err) {
      log('Express /api/calendar-config error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  expressApp.get('/api/geocode', async (req, res) => {
    try {
      const q = req.query.q ?? '';
      res.json(await geocodeLocation(q));
    } catch (err) { log('Express /api/geocode error:', err.message); res.status(502).json({ error: err.message }); }
  });

  expressApp.post('/api/weather-config', require('express').json(), (req, res) => {
    log('Express: POST /api/weather-config', JSON.stringify(req.body));
    try {
      const cfg = loadConfig();
      cfg.weather = { ...(cfg.weather ?? {}), ...req.body };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      res.json({ ok: true });
    } catch (err) {
      log('Express /api/weather-config error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  expressApp.post('/api/widget-visibility', require('express').json(), (req, res) => {
    log('Express: POST /api/widget-visibility', JSON.stringify(req.body));
    try {
      const cfg = loadConfig();
      cfg.widgetVisibility = { ...(cfg.widgetVisibility ?? {}), ...req.body };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  expressApp.post('/api/countdowns', require('express').json(), (req, res) => {
    log('Express: POST /api/countdowns');
    try {
      const cfg = loadConfig();
      cfg.countdowns = req.body;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  expressApp.post('/api/widget-config', require('express').json(), (req, res) => {
    log('Express: POST /api/widget-config', JSON.stringify(req.body));
    try {
      const cfg = loadConfig();
      cfg.widgets = { ...(cfg.widgets ?? {}), ...req.body };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      res.json({ ok: true });
    } catch (err) {
      log('Express /api/widget-config error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  const httpServer = require('http').createServer(expressApp);
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`Express: port ${EXPRESS_PORT} already in use — web server disabled this session`);
    } else {
      log('Express: server error:', err.message);
    }
  });
  httpServer.listen(EXPRESS_PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    log(`Express: listening on port ${EXPRESS_PORT}`);
    log(`Express: network URL: http://${ip}:${EXPRESS_PORT}`);
  });
}

// ---------------------------------------------------------------------------
// Electron window
// ---------------------------------------------------------------------------

let mainWindow = null;

function createWindow() {
  log('createWindow: loading config');
  const config = loadConfig();
  const kioskMode = config.display?.kioskMode ?? true;
  log('createWindow: kioskMode =', kioskMode);

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
      webSecurity: false,
    },
  });

  const indexPath = path.join(__dirname, 'renderer', 'index.html');
  log('createWindow: loading', indexPath, ' exists:', fs.existsSync(indexPath));
  mainWindow.loadFile(indexPath);

  // Forward every renderer console.log/warn/error line to the log file
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const lvl = ['verbose', 'info', 'warn', 'error'][level] ?? 'info';
    log(`RENDERER [${lvl}] ${message}  (${path.basename(sourceId || '')}:${line})`);
  });

  // Always open DevTools so errors are visible — press F12 or Ctrl+Alt+I to toggle
  mainWindow.webContents.once('did-finish-load', () => {
    log('createWindow: renderer did-finish-load');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log('RENDERER CRASHED:', JSON.stringify(details));
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('did-fail-load:', code, desc, url);
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      log('ESC pressed — exiting kiosk/fullscreen');
      mainWindow.setKiosk(false);
      mainWindow.setFullScreen(false);
    }
  });

  log('createWindow: done');
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
log('Single-instance lock acquired:', gotLock);

if (!gotLock) {
  log('Another instance is running — quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('Second instance detected — focusing existing window');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    log('app.whenReady fired');
    try {
      startExpressServer();
    } catch (err) {
      log('Express startup threw synchronously:', err.stack || err.message);
    }
    createWindow();
  });

  app.on('window-all-closed', () => {
    log('window-all-closed');
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('read-config', () => {
  log('IPC: read-config called');
  const cfg = loadConfig();
  log('IPC: read-config returning OK');
  return cfg;
});
ipcMain.handle('save-calendar-config', (_e, calendarPanel) => {
  log('IPC: save-calendar-config', JSON.stringify(calendarPanel));
  const cfg = loadConfig();
  cfg.calendarPanel = { ...(cfg.calendarPanel ?? {}), ...calendarPanel };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  log('IPC: save-calendar-config written OK');
  return true;
});

ipcMain.handle('geocode', (_e, query) => geocodeLocation(query));

ipcMain.handle('save-widget-visibility', (_e, v) => {
  log('IPC: save-widget-visibility', JSON.stringify(v));
  const cfg = loadConfig();
  cfg.widgetVisibility = { ...(cfg.widgetVisibility ?? {}), ...v };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return true;
});

ipcMain.handle('save-countdowns', (_e, countdowns) => {
  log('IPC: save-countdowns count:', countdowns.length);
  const cfg = loadConfig();
  cfg.countdowns = countdowns;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return true;
});

ipcMain.handle('save-weather-config', (_e, weather) => {
  log('IPC: save-weather-config', JSON.stringify(weather));
  const cfg = loadConfig();
  cfg.weather = { ...(cfg.weather ?? {}), ...weather };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  log('IPC: save-weather-config written OK');
  return true;
});

ipcMain.handle('save-widget-config', (_e, widgets) => {
  log('IPC: save-widget-config', JSON.stringify(widgets));
  const cfg = loadConfig();
  cfg.widgets = { ...(cfg.widgets ?? {}), ...widgets };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  log('IPC: save-widget-config written OK');
  return true;
});

ipcMain.handle('fetch-weather',   () => getWeatherData());
ipcMain.handle('fetch-flickr',    () => getFlickrData());
ipcMain.handle('fetch-calendars', () => getCalendarsData());
ipcMain.handle('open-devtools',   () => mainWindow?.webContents.openDevTools());
