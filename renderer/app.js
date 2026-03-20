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
  async saveWeatherConfig(weather) {
    if (isElectron) return window.api.saveWeatherConfig(weather);
    const res = await fetch('/api/weather-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(weather),
    });
    if (!res.ok) throw new Error(`/api/weather-config ${res.status}`);
    return res.json();
  },
  async geocode(query) {
    if (isElectron) return window.api.geocode(query);
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`/api/geocode ${res.status}`);
    return res.json();
  },
  async saveWidgetConfig(widgets) {
    if (isElectron) return window.api.saveWidgetConfig(widgets);
    const res = await fetch('/api/widget-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(widgets),
    });
    if (!res.ok) throw new Error(`/api/widget-config ${res.status}`);
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
  initWidgetPositions(config.widgets);
  initSettingsPanel(config.calendarPanel);
  initWeatherSettings(config.weather);

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

    document.getElementById('weather-icon').textContent = wmo.icon;
    document.getElementById('weather-temp').textContent =
      `${Math.round(cur.temperature_2m)}°`;
    document.getElementById('weather-desc').textContent = wmo.desc;
    document.getElementById('weather-detail').innerHTML =
      `Feels ${Math.round(cur.apparent_temperature)}°<br>` +
      `Wind ${Math.round(cur.wind_speed_10m)} mph<br>` +
      `Humidity ${cur.relative_humidity_2m}%`;

    renderForecast(data.daily);
  } catch (err) {
    console.error('[Weather] FAILED:', err.message);
    document.getElementById('weather-desc').textContent = 'Unavailable';
  }
}

function renderForecast(daily) {
  const strip = document.getElementById('forecast-strip');
  if (!strip) return;

  if (!daily || !daily.time || daily.time.length === 0) {
    strip.classList.add('hidden');
    strip.innerHTML = '';
    return;
  }

  strip.innerHTML = '';
  strip.classList.remove('hidden');

  // daily.time[0] is today — skip it (current conditions already shown)
  const start = 1;
  for (let i = start; i < daily.time.length; i++) {
    const date    = new Date(daily.time[i] + 'T12:00:00');
    const dayName = DAYS[date.getDay()].slice(0, 3).toUpperCase();
    const wmo     = WMO[daily.weather_code[i]] || { icon: '?' };
    const hi      = Math.round(daily.temperature_2m_max[i]);
    const lo      = Math.round(daily.temperature_2m_min[i]);

    const card = document.createElement('div');
    card.className = 'forecast-day';
    card.innerHTML =
      `<div class="forecast-day-name">${dayName}</div>` +
      `<div class="forecast-day-icon">${wmo.icon}</div>` +
      `<div class="forecast-day-hi">${hi}°</div>` +
      `<div class="forecast-day-lo">${lo}°</div>`;
    strip.appendChild(card);
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

function dayKey(date) {
  // Returns "YYYY-MM-DD" string for grouping
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function dayLabel(date) {
  const today = new Date();
  const todayKey    = dayKey(today);
  const tomorrowKey = dayKey(new Date(today.getTime() + 86400000));
  const key = dayKey(date);
  if (key === todayKey)    return 'Today';
  if (key === tomorrowKey) return 'Tomorrow';
  const dayAbbr  = DAYS[date.getDay()].slice(0,3).toUpperCase();
  const monAbbr  = MONTHS_SHORT[date.getMonth()].toUpperCase();
  return `${dayAbbr} · ${monAbbr} ${date.getDate()}`;
}

function renderEvents(events) {
  const list = document.getElementById('event-list');
  list.innerHTML = '';

  if (!events || events.length === 0) {
    list.innerHTML = '<div style="font-family:var(--font-mono);font-size:13px;color:rgba(255,255,255,0.4);padding:8px 0">No upcoming events</div>';
    return;
  }

  let lastKey = null;

  for (const ev of events) {
    const start  = new Date(ev.start);
    const curKey = dayKey(start);

    // Insert day header when the date changes
    if (curKey !== lastKey) {
      lastKey = curKey;
      const header = document.createElement('div');
      header.className = 'day-header';
      header.textContent = dayLabel(start);
      list.appendChild(header);
    }

    const card = document.createElement('div');
    card.className = 'event-card';
    card.style.setProperty('--event-color', ev.color || '#C9A96E');

    const timeStr = ev.allDay
      ? 'All Day'
      : start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    card.innerHTML = `
      <div class="event-badge">${escHtml(ev.calendar)}</div>
      <div class="event-title">${escHtml(ev.title)}</div>
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
  const cardHeight  = cp.cardHeight  ?? 0;   // 0 = auto

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
  panel.style.setProperty('--cp-card-height',  cardHeight > 0 ? cardHeight + 'px' : 'auto');

  // Reposition photo credit so it doesn't overlap a vertical panel
  const credit = document.getElementById('photo-credit');
  if (credit) {
    if (layout === 'vertical' && side === 'right') {
      credit.style.right  = (panelWidth + 24) + 'px';
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
    const cardHeight = cp.cardHeight  ?? 0;

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
    // card height: 0 means auto
    const chEl = document.getElementById('cardheight-slider');
    const chLb = document.getElementById('cardheight-val');
    if (chEl) chEl.value = cardHeight;
    if (chLb) chLb.textContent = cardHeight > 0 ? cardHeight + 'px' : 'Auto';
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
      cardHeight:   parseInt(document.getElementById('cardheight-slider').value),
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

  // Card height slider (0 = auto)
  const chSlider = document.getElementById('cardheight-slider');
  if (chSlider) {
    chSlider.addEventListener('input', () => {
      const v = parseInt(chSlider.value);
      document.getElementById('cardheight-val').textContent = v > 0 ? v + 'px' : 'Auto';
      applyCalendarPanel(currentValues());
    });
  }

  // Widget unlock button
  const widgetLockBtn = document.getElementById('widget-lock-btn');
  if (widgetLockBtn) {
    widgetLockBtn.addEventListener('click', () => {
      const isNowUnlocked = toggleWidgetUnlock();
      widgetLockBtn.textContent = isNowUnlocked ? 'Lock widgets' : 'Unlock to move';
      widgetLockBtn.classList.toggle('active', isNowUnlocked);
    });
  }

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

// ---------------------------------------------------------------------------
// Weather settings
// ---------------------------------------------------------------------------

function initWeatherSettings(initialWeather = {}) {
  // Pending weather changes (location/forecast days/units) before Save
  let pendingWeather = {
    latitude:     initialWeather.latitude     ?? 36.0726,
    longitude:    initialWeather.longitude    ?? -79.792,
    locationName: initialWeather.locationName ?? '',
    forecastDays: initialWeather.forecastDays ?? 3,
    units:        initialWeather.units        ?? 'fahrenheit',
  };

  // Populate controls
  const locLabel   = document.getElementById('location-current-label');
  const locInput   = document.getElementById('location-input');
  const locResults = document.getElementById('location-results');
  const fdSlider   = document.getElementById('forecast-days-slider');
  const fdVal      = document.getElementById('forecast-days-val');
  if (!locInput || !fdSlider) return;

  function refreshDisplay() {
    if (locLabel) locLabel.textContent = pendingWeather.locationName || '';
    fdSlider.value  = pendingWeather.forecastDays;
    if (fdVal) fdVal.textContent = pendingWeather.forecastDays === 0 ? 'Off' : pendingWeather.forecastDays;
    // Units toggles
    document.querySelectorAll('[data-units]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.units === pendingWeather.units);
    });
  }
  refreshDisplay();

  // Re-populate when settings panel opens
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    pendingWeather = {
      latitude:     config.weather?.latitude     ?? 36.0726,
      longitude:    config.weather?.longitude    ?? -79.792,
      locationName: config.weather?.locationName ?? '',
      forecastDays: config.weather?.forecastDays ?? 3,
      units:        config.weather?.units        ?? 'fahrenheit',
    };
    refreshDisplay();
  });

  // Forecast days slider
  fdSlider.addEventListener('input', () => {
    const v = parseInt(fdSlider.value);
    pendingWeather.forecastDays = v;
    if (fdVal) fdVal.textContent = v === 0 ? 'Off' : v;
  });

  // Units toggle
  document.querySelectorAll('[data-units]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingWeather.units = btn.dataset.units;
      document.querySelectorAll('[data-units]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Location search
  document.getElementById('location-search-btn')?.addEventListener('click', () => doSearch());
  locInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  async function doSearch() {
    const q = locInput.value.trim();
    if (!q) return;
    locResults.innerHTML = '<div class="location-result-item" style="color:rgba(255,255,255,0.4)">Searching…</div>';
    locResults.classList.remove('hidden');
    try {
      const results = await hb.geocode(q);
      if (results.length === 0) {
        locResults.innerHTML = '<div class="location-result-item" style="color:rgba(255,255,255,0.4)">No results found</div>';
        return;
      }
      locResults.innerHTML = '';
      results.forEach(r => {
        const item = document.createElement('div');
        item.className = 'location-result-item';
        const sub = [r.state, r.country].filter(Boolean).join(', ');
        item.innerHTML = `<div class="loc-name">${escHtml(r.name)}</div>${sub ? `<div class="loc-sub">${escHtml(sub)}</div>` : ''}`;
        item.addEventListener('click', () => {
          pendingWeather.latitude    = r.latitude;
          pendingWeather.longitude   = r.longitude;
          pendingWeather.locationName = [r.name, r.state, r.country].filter(Boolean).join(', ');
          locInput.value = '';
          locResults.innerHTML = '';
          locResults.classList.add('hidden');
          refreshDisplay();
        });
        locResults.appendChild(item);
      });
    } catch (err) {
      console.error('[Weather] geocode failed:', err.message);
      locResults.innerHTML = '<div class="location-result-item" style="color:rgba(255,80,80,0.8)">Search failed</div>';
    }
  }

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!locResults.classList.contains('hidden') &&
        !locResults.contains(e.target) &&
        e.target !== locInput &&
        e.target.id !== 'location-search-btn') {
      locResults.classList.add('hidden');
    }
  });

  // Save weather button
  document.getElementById('weather-save')?.addEventListener('click', async () => {
    config.weather = { ...(config.weather ?? {}), ...pendingWeather };
    try {
      await hb.saveWeatherConfig(pendingWeather);
      document.getElementById('settings-panel')?.classList.add('hidden');
      console.log('[Weather] config saved:', JSON.stringify(pendingWeather));
      // Reload weather with new settings
      loadWeather();
    } catch (err) {
      console.error('[Weather] save failed:', err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Widget positioning — clock (#top-left) and weather (#top-right)
// ---------------------------------------------------------------------------

let widgetsUnlocked = false;

// Apply saved positions from config.widgets on load
function initWidgetPositions(widgets = {}) {
  applyWidgetPos('top-left',  widgets.clock);
  applyWidgetPos('top-right', widgets.weather);
}

function applyWidgetPos(id, saved) {
  if (!saved) return;
  const el = document.getElementById(id);
  if (!el) return;
  // Switch to absolute left/top positioning once a position is saved
  el.style.position = 'fixed';
  if (saved.top  != null) el.style.top    = saved.top  + 'px';
  if (saved.left != null) el.style.left   = saved.left + 'px';
  if (saved.right != null) {
    el.style.right = saved.right + 'px';
    el.style.left  = 'auto';
  } else {
    el.style.right = 'auto';
  }
  if (saved.width != null) el.style.width = saved.width + 'px';
  if (saved.height != null) el.style.height = saved.height + 'px';
}

function toggleWidgetUnlock() {
  widgetsUnlocked = !widgetsUnlocked;
  ['top-left','top-right'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('widget-unlocked', widgetsUnlocked);
    el.classList.toggle('widget-draggable', widgetsUnlocked);
  });
  return widgetsUnlocked;
}

// Drag + resize logic
(function attachWidgetDrag() {
  const WIDGETS = [
    { id: 'top-left',  key: 'clock'   },
    { id: 'top-right', key: 'weather' },
  ];

  WIDGETS.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (!el) return;

    let dragState  = null;  // { startX, startY, origLeft, origTop }
    let resizeState = null; // { startX, startY, origW, origH }

    // Convert right-relative position to left-relative once
    function ensureLeftBased() {
      const rect = el.getBoundingClientRect();
      el.style.left   = rect.left + 'px';
      el.style.top    = rect.top  + 'px';
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
      el.style.position = 'fixed';
    }

    // ── Drag ──
    el.addEventListener('mousedown', (e) => {
      if (!widgetsUnlocked) return;
      // Don't start drag when clicking the resize handle
      if (e.target.classList.contains('widget-resize-handle')) return;
      e.preventDefault();
      ensureLeftBased();
      const rect = el.getBoundingClientRect();
      dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
    });

    document.addEventListener('mousemove', (e) => {
      if (dragState) {
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        el.style.left = (dragState.origLeft + dx) + 'px';
        el.style.top  = (dragState.origTop  + dy) + 'px';
      }
      if (resizeState) {
        const dw = e.clientX - resizeState.startX;
        const dh = e.clientY - resizeState.startY;
        const newW = Math.max(80,  resizeState.origW + dw);
        const newH = Math.max(40,  resizeState.origH + dh);
        el.style.width  = newW + 'px';
        el.style.height = newH + 'px';
      }
    });

    document.addEventListener('mouseup', async () => {
      if (!dragState && !resizeState) return;
      dragState   = null;
      resizeState = null;
      if (!widgetsUnlocked) return;
      // Save updated position
      const rect = el.getBoundingClientRect();
      const saved = { top: Math.round(rect.top), left: Math.round(rect.left) };
      const w = el.style.width  ? Math.round(el.offsetWidth)  : null;
      const h = el.style.height ? Math.round(el.offsetHeight) : null;
      if (w) saved.width  = w;
      if (h) saved.height = h;
      config.widgets = config.widgets ?? {};
      config.widgets[key] = saved;
      try { await hb.saveWidgetConfig({ [key]: saved }); } catch(err) {
        console.error('[Widget] save failed:', err.message);
      }
    });

    // ── Resize ──
    const handle = el.querySelector('.widget-resize-handle');
    if (handle) {
      handle.addEventListener('mousedown', (e) => {
        if (!widgetsUnlocked) return;
        e.preventDefault();
        e.stopPropagation();
        ensureLeftBased();
        resizeState = {
          startX: e.clientX,
          startY: e.clientY,
          origW:  el.offsetWidth,
          origH:  el.offsetHeight,
        };
      });
    }
  });
})();
