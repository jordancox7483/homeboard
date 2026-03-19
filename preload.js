'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readConfig:     ()  => ipcRenderer.invoke('read-config'),
  fetchWeather:   ()  => ipcRenderer.invoke('fetch-weather'),
  fetchFlickr:    ()  => ipcRenderer.invoke('fetch-flickr'),
  fetchCalendars: ()  => ipcRenderer.invoke('fetch-calendars'),
  openDevTools:   ()  => ipcRenderer.invoke('open-devtools'),
});
