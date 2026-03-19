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

const api = {
  async readConfig() {
    if (isElectron) return window.api.readConfig();
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`/api/config ${res.status}`);
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

  try {
    config = await api.readConfig();
  } catch (err) {
    console.error('[HomeBoard] Failed to read config:', err);
    config = {};
  }

  startClock();
  loadWeather();
  loadCalendars();
  loadFlickr();

  // Refresh intervals
  setInterval(loadWeather,    15 * 60 * 1000);
  setInterval(loadCalendars,  15 * 60 * 1000);
  setInterval(loadFlickr,     30 * 60 * 1000);

  // Photo rotation
  const rotationMs = (config.flickr?.rotationIntervalSeconds ?? 60) * 1000;
  setInterval(nextPhoto, rotationMs);

  // Devtools: Cmd+Option+I (macOS) — only meaningful in Electron
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === 'i') {
      api.openDevTools();
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
  try {
    const data = await api.fetchWeather();
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
    console.error('[Weather] Failed:', err.message);
    document.getElementById('weather-desc').textContent = 'Unavailable';
  }
}

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------
async function loadCalendars() {
  try {
    const { events, googleConnected } = await api.fetchCalendars();

    const warning = document.getElementById('google-warning');
    if (!googleConnected) {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }

    renderEvents(events);
  } catch (err) {
    console.error('[Calendar] Failed:', err.message);
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
  try {
    photos = await api.fetchFlickr();
    if (photos.length === 0) {
      showFallbackBackground();
      return;
    }
    photoIndex = 0;
    await showPhoto(photos[0], /* initial */ true);
  } catch (err) {
    console.error('[Flickr] Failed:', err.message);
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
