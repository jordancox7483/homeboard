'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readConfig:           ()      => ipcRenderer.invoke('read-config'),
  saveCalendarConfig:   (cfg)   => ipcRenderer.invoke('save-calendar-config', cfg),
  saveWeatherConfig:    (cfg)   => ipcRenderer.invoke('save-weather-config', cfg),
  saveWidgetConfig:     (cfg)   => ipcRenderer.invoke('save-widget-config', cfg),
  geocode:              (q)     => ipcRenderer.invoke('geocode', q),
  saveWidgetVisibility: (v)     => ipcRenderer.invoke('save-widget-visibility', v),
  saveCountdowns:       (arr)   => ipcRenderer.invoke('save-countdowns', arr),
  fetchWeather:         ()      => ipcRenderer.invoke('fetch-weather'),
  fetchFlickr:          ()      => ipcRenderer.invoke('fetch-flickr'),
  fetchCalendars:       ()      => ipcRenderer.invoke('fetch-calendars'),
  openDevTools:         ()      => ipcRenderer.invoke('open-devtools'),
});
