'use strict';

// WMO Weather Code mapping for Open-Meteo responses.

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
  96: { desc: 'Thunderstorm w/ hail','icon': '⛈' },
  99: { desc: 'Severe thunderstorm', icon: '⛈' },
};

function decodeWeatherCode(code) {
  return WMO[code] || { desc: 'Unknown', icon: '?' };
}

module.exports = { decodeWeatherCode, WMO };
