'use strict';

// ---------------------------------------------------------------------------
// WMO weather code descriptions + icons
// ---------------------------------------------------------------------------
const WMO = {
  0:  { desc: 'Clear sky',           icon: '☀' },
  1:  { desc: 'Mainly clear',        icon: '🌤' },
  2:  { desc: 'Partly cloudy',       icon: '⛅' },
  3:  { desc: 'Overcast',            icon: '☁' },
  45: { desc: 'Fog',                 icon: '🌫' },
  48: { desc: 'Icy fog',             icon: '🌫' },
  51: { desc: 'Light drizzle',       icon: '🌦' },
  53: { desc: 'Drizzle',             icon: '🌦' },
  55: { desc: 'Heavy drizzle',       icon: '🌦' },
  61: { desc: 'Light rain',          icon: '🌧' },
  63: { desc: 'Rain',                icon: '🌧' },
  65: { desc: 'Heavy rain',          icon: '🌧' },
  71: { desc: 'Light snow',          icon: '🌨' },
  73: { desc: 'Snow',                icon: '❄' },
  75: { desc: 'Heavy snow',          icon: '❄' },
  77: { desc: 'Snow grains',         icon: '🌨' },
  80: { desc: 'Light showers',       icon: '🌦' },
  81: { desc: 'Showers',             icon: '🌧' },
  82: { desc: 'Heavy showers',       icon: '⛈' },
  85: { desc: 'Snow showers',        icon: '🌨' },
  86: { desc: 'Heavy snow showers',  icon: '❄' },
  95: { desc: 'Thunderstorm',        icon: '⛈' },
  96: { desc: 'Thunderstorm w/ hail',icon: '⛈' },
  99: { desc: 'Severe thunderstorm', icon: '⛈' },
};

const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---------------------------------------------------------------------------
// API shim — routes to Electron IPC (window.api) or Express REST (/api/*)
// ---------------------------------------------------------------------------
const isElectron = typeof window !== 'undefined' && !!window.api;
console.log('[HomeBoard] renderer init — isElectron:', isElectron, '  window.api:', typeof window.api);

// Named 'hb' to avoid colliding with window.api injected by the preload
const hb = {
  async readConfig() {
    if (isElectron) return window.api.readConfig();
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`/api/config ${res.status}`);
    return res.json();
  },
  async saveCalendarConfig(calendarPanel) {
    if (isElectron) return window.api.saveCalendarConfig(calendarPanel);
    const res = await fetch('/api/calendar-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(calendarPanel),
    });
    if (!res.ok) throw new Error(`/api/calendar-config ${res.status}`);
    return res.json();
  },
  async fetchWeather() {
    if (isElectron) return window.api.fetchWeather();
    const res = await fetch('/api/weather');
    if (!res.ok) throw new Error(`/api/weather ${res.status}`);
    return res.json();
  },
  async fetchFlickr() {
    if (isElectron) return window.api.fetchFlickr();
    const res = await fetch('/api/flickr');
    if (!res.ok) throw new Error(`/api/flickr ${res.status}`);
    return res.json();
  },
  async fetchCalendars() {
    if (isElectron) return window.api.fetchCalendars();
    const res = await fetch('/api/calendars');
    if (!res.ok) throw new Error(`/api/calendars ${res.status}`);
    return res.json();
  },
  openDevTools() {
    if (isElectron) window.api.openDevTools();
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let config = {};
let photos = [];
let photoIndex = 0;
let photoA = null;
let photoB = null;
let activePhoto = 'a'; // which element is currently visible

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function init() {
  photoA = document.getElementById('photo-a');
  photoB = document.getElementById('photo-b');

  // Clock starts immediately — never blocked by network or IPC
  startClock();
  console.log('[HomeBoard] clock started');

  try {
    console.log('[HomeBoard] calling hb.readConfig...');
    config = await hb.readConfig();
    console.log('[HomeBoard] config loaded — flickrId:', config.flickr?.userId,
                ' kioskMode:', config.display?.kioskMode);
  } catch (err) {
    console.error('[HomeBoard] Failed to read config:', err.message);
    config = {};
  }

  // Apply calendar panel layout from config
  applyCalendarPanel(config.calendarPanel);
  initSettingsPanel(config.calendarPanel);

  console.log('[HomeBoard] starting data fetches');
  loadWeather();
  loadCalendars();
  loadFlickr();

  // Refresh intervals
  setInterval(loadWeather,    15 * 60 * 1000);
  setInterval(loadCalendars,  15 * 60 * 1000);
  setInterval(loadFlickr,     30 * 60 * 1000);

  // Photo rotation (uses config; defaults to 60s if config failed)
  const rotationMs = (config.flickr?.rotationIntervalSeconds ?? 60) * 1000;
  setInterval(nextPhoto, rotationMs);

  // Devtools: Cmd+Option+I (macOS) — only meaningful in Electron
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === 'i') {
      hb.openDevTools();
    }
  });
})();

// ---------------------------------------------------------------------------
// Clock (every second)
// ---------------------------------------------------------------------------
function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;

  document.getElementById('clock').textContent =
    `${hours}:${String(minutes).padStart(2, '0')}`;
  document.getElementById('ampm').textContent = ampm;
  document.getElementById('date-line').textContent =
    `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------
async function loadWeather() {
  console.log('[Weather] fetching...');
  try {
    const data = await hb.fetchWeather();
    console.log('[Weather] received, code:', data?.current?.weather_code);
    const cur = data.current;
    const code = cur.weather_code;
    const wmo = WMO[code] || { desc: 'Unknown', icon: '?' };
    const units = config.weather?.units === 'fahrenheit' ? '°F' : '°C';

    document.getElementById('weather-icon').textContent = wmo.icon;
    document.getElementById('weather-temp').textContent =
      `${Math.round(cur.temperature_2m)}°`;
    document.getElementById('weather-desc').textContent = wmo.desc;
    document.getElementById('weather-detail').innerHTML =
      `Feels ${Math.round(cur.apparent_temperature)}°<br>` +
      `Wind ${Math.round(cur.wind_speed_10m)} mph<br>` +
      `Humidity ${cur.relative_humidity_2m}%`;
  } catch (err) {
    console.error('[Weather] FAILED:', err.message);
    document.getElementById('weather-desc').textContent = 'Unavailable';
  }
}

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------
async function loadCalendars() {
  console.log('[Calendar] fetching...');
  try {
    const { events, googleConnected } = await hb.fetchCalendars();
    console.log('[Calendar] received', events?.length, 'events, googleConnected:', googleConnected);

    const warning = document.getElementById('google-warning');
    if (!googleConnected) {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }

    renderEvents(events);
  } catch (err) {
    console.error('[Calendar] FAILED:', err.message);
  }
}

function renderEvents(events) {
  const list = document.getElementById('event-list');
  list.innerHTML = '';

  if (!events || events.length === 0) {
    list.innerHTML = '<div style="font-family:var(--font-mono);font-size:13px;color:rgba(255,255,255,0.4);padding:8px 0">No upcoming events</div>';
    return;
  }

  for (const ev of events) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.style.setProperty('--event-color', ev.color || '#C9A96E');

    const start = new Date(ev.start);
    const dateStr = `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}`;
    const timeStr = ev.allDay
      ? 'All Day'
      : start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    card.innerHTML = `
      <div class="event-badge">${escHtml(ev.calendar)}</div>
      <div class="event-title">${escHtml(ev.title)}</div>
      <div class="event-date">${dateStr}</div>
      <div class="event-time">${timeStr}</div>
    `;
    list.appendChild(card);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Flickr photos
// ---------------------------------------------------------------------------
async function loadFlickr() {
  console.log('[Flickr] fetching...');
  try {
    photos = await hb.fetchFlickr();
    console.log('[Flickr] received', photos?.length, 'photos');
    if (photos.length === 0) {
      showFallbackBackground();
      return;
    }
    photoIndex = 0;
    await showPhoto(photos[0], /* initial */ true);
  } catch (err) {
    console.error('[Flickr] FAILED:', err.message);
    showFallbackBackground();
  }
}

function showFallbackBackground() {
  document.getElementById('background').style.background =
    'linear-gradient(135deg, #0d0d14 0%, #1a1a2e 50%, #16213e 100%)';
}

async function showPhoto(photo, initial = false) {
  const current = activePhoto === 'a' ? photoA : photoB;
  const next    = activePhoto === 'a' ? photoB : photoA;

  if (initial) {
    // Just set the active image directly
    current.src = photo.url;
    current.classList.add('active');
    setPhotoCredit(photo.author, photo.title);
    return;
  }

  // Preload next image
  next.src = photo.url;
  await new Promise((resolve) => {
    if (next.complete) { resolve(); return; }
    next.addEventListener('load',  resolve, { once: true });
    next.addEventListener('error', resolve, { once: true });
  });

  // Crossfade
  next.classList.add('active');
  current.classList.remove('active');
  activePhoto = activePhoto === 'a' ? 'b' : 'a';

  setPhotoCredit(photo.author, photo.title);
}

async function nextPhoto() {
  if (photos.length === 0) return;
  photoIndex = (photoIndex + 1) % photos.length;
  await showPhoto(photos[photoIndex]);
}

function setPhotoCredit(author, title) {
  const credit = document.getElementById('photo-credit');
  const parts = [];
  if (title)  parts.push(title);
  if (author) parts.push(`by ${author}`);
  credit.textContent = parts.join(' — ');
}

// ---------------------------------------------------------------------------
// Calendar panel layout — apply config to DOM
// ---------------------------------------------------------------------------

function applyCalendarPanel(cp = {}) {
  const panel     = document.getElementById('bottom-panel');
  const eventList = document.getElementById('event-list');
  if (!panel || !eventList) return;

  const layout      = cp.layout      ?? 'horizontal';
  const side        = cp.side        ?? 'right';
  const opacity     = cp.opacity     ?? 0.6;
  const panelWidth  = cp.panelWidth  ?? 320;
  const cardMinWidth= cp.cardMinWidth?? 180;
  const fontSize    = cp.fontSize    ?? 13;
  const gap         = cp.gap         ?? 16;

  // Layout class
  panel.classList.toggle('layout-vertical', layout === 'vertical');
  panel.classList.toggle('side-left',  layout === 'vertical' && side === 'left');
  panel.classList.toggle('side-right', layout === 'vertical' && side === 'right');

  // Dynamic values via CSS custom properties on the panel
  panel.style.setProperty('--cp-opacity',      opacity);
  panel.style.setProperty('--cp-panel-width',  panelWidth  + 'px');
  panel.style.setProperty('--cp-card-min-width',cardMinWidth + 'px');
  panel.style.setProperty('--cp-font-size',    fontSize    + 'px');
  panel.style.setProperty('--cp-gap',          gap         + 'px');

  // Reposition photo credit so it doesn't overlap a vertical panel
  const credit = document.getElementById('photo-credit');
  if (credit) {
    if (layout === 'vertical' && side === 'right') {
      credit.style.right  = (panelWidth + 24) + 'px';
    } else if (layout === 'vertical' && side === 'left') {
      credit.style.right  = '20px';
    } else {
      credit.style.right  = '20px';
    }
  }
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function initSettingsPanel(initialCp = {}) {
  const panel   = document.getElementById('settings-panel');
  const trigger = document.getElementById('settings-btn');
  if (!panel || !trigger) return;

  // Populate controls from current config
  function populate(cp) {
    const layout     = cp.layout      ?? 'horizontal';
    const side       = cp.side        ?? 'right';
    const opacity    = Math.round((cp.opacity    ?? 0.6)  * 100);
    const panelWidth = cp.panelWidth  ?? 320;
    const cardMin    = cp.cardMinWidth?? 180;
    const fontSize   = cp.fontSize    ?? 13;
    const gap        = cp.gap         ?? 16;

    panel.querySelector('[data-layout="horizontal"]').classList.toggle('active', layout === 'horizontal');
    panel.querySelector('[data-layout="vertical"]').classList.toggle('active',   layout === 'vertical');
    panel.querySelector('[data-side="left"]').classList.toggle('active',  side === 'left');
    panel.querySelector('[data-side="right"]').classList.toggle('active', side === 'right');

    const sideRow = panel.querySelector('.side-row');
    sideRow.style.display = layout === 'vertical' ? '' : 'none';

    setSlider('opacity-slider',    opacity,    'opacity-val',    '%');
    setSlider('width-slider',      panelWidth, 'width-val',      'px');
    setSlider('cardmin-slider',    cardMin,    'cardmin-val',    'px');
    setSlider('fontsize-slider',   fontSize,   'fontsize-val',   'px');
    setSlider('gap-slider',        gap,        'gap-val',        'px');
  }

  function setSlider(id, value, labelId, unit) {
    const el = document.getElementById(id);
    const lb = document.getElementById(labelId);
    if (el) el.value = value;
    if (lb) lb.textContent = value + unit;
  }

  function currentValues() {
    const layout = panel.querySelector('[data-layout].active')?.dataset.layout ?? 'horizontal';
    const side   = panel.querySelector('[data-side].active')?.dataset.side     ?? 'right';
    return {
      layout,
      side,
      opacity:      parseInt(document.getElementById('opacity-slider').value)  / 100,
      panelWidth:   parseInt(document.getElementById('width-slider').value),
      cardMinWidth: parseInt(document.getElementById('cardmin-slider').value),
      fontSize:     parseInt(document.getElementById('fontsize-slider').value),
      gap:          parseInt(document.getElementById('gap-slider').value),
    };
  }

  // Open / close
  trigger.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) populate(config.calendarPanel ?? {});
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
    }
  });

  panel.querySelector('#settings-close').addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  // Layout toggle buttons
  panel.querySelectorAll('[data-layout]').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('[data-layout]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sideRow = panel.querySelector('.side-row');
      sideRow.style.display = btn.dataset.layout === 'vertical' ? '' : 'none';
      applyCalendarPanel(currentValues());
    });
  });

  // Side toggle buttons
  panel.querySelectorAll('[data-side]').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('[data-side]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyCalendarPanel(currentValues());
    });
  });

  // Sliders — live preview
  ['opacity-slider','width-slider','cardmin-slider','fontsize-slider','gap-slider'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const labelId = id.replace('-slider', '-val');
    const unit    = id === 'opacity-slider' ? '%' : 'px';
    el.addEventListener('input', () => {
      document.getElementById(labelId).textContent = el.value + unit;
      applyCalendarPanel(currentValues());
    });
  });

  // Save
  panel.querySelector('#settings-save').addEventListener('click', async () => {
    const vals = currentValues();
    config.calendarPanel = vals;
    try {
      await hb.saveCalendarConfig(vals);
      panel.classList.add('hidden');
      console.log('[Settings] saved:', JSON.stringify(vals));
    } catch (err) {
      console.error('[Settings] save failed:', err.message);
    }
  });

  populate(initialCp);
}
