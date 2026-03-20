'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readConfig:           ()      => ipcRenderer.invoke('read-config'),
  saveCalendarConfig:   (cfg)   => ipcRenderer.invoke('save-calendar-config', cfg),
  fetchWeather:         ()      => ipcRenderer.invoke('fetch-weather'),
  fetchFlickr:          ()      => ipcRenderer.invoke('fetch-flickr'),
  fetchCalendars:       ()      => ipcRenderer.invoke('fetch-calendars'),
  openDevTools:         ()      => ipcRenderer.invoke('open-devtools'),
});
