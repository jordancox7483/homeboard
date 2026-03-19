'use strict';

const ical = require('node-ical');
const { google } = require('googleapis');

// ---------------------------------------------------------------------------
// ICS feed fetcher
// ---------------------------------------------------------------------------

async function fetchICS(url, calendarName, color, startDate, endDate) {
  const data = await ical.async.fromURL(url);
  const events = [];

  for (const [, event] of Object.entries(data)) {
    if (event.type !== 'VEVENT') continue;
    if (!event.start) continue;

    // Handle recurring events via rrule
    if (event.rrule) {
      try {
        const occurrences = event.rrule.between(startDate, endDate, true);
        for (const occurrence of occurrences) {
          const duration = event.end ? new Date(event.end) - new Date(event.start) : 0;
          const occEnd = new Date(occurrence.getTime() + duration);
          events.push(formatEvent(event, occurrence, occEnd, calendarName, color));
        }
      } catch {
        // If rrule expansion fails, try the base date
        const baseStart = new Date(event.start);
        if (baseStart >= startDate && baseStart <= endDate) {
          events.push(formatEvent(event, event.start, event.end, calendarName, color));
        }
      }
      continue;
    }

    const eventStart = new Date(event.start);
    const eventEnd = event.end ? new Date(event.end) : eventStart;

    // Include event if it overlaps the window
    if (eventStart > endDate) continue;
    if (eventEnd < startDate) continue;

    events.push(formatEvent(event, event.start, event.end, calendarName, color));
  }

  return events;
}

function formatEvent(event, start, end, calendarName, color) {
  const isAllDay =
    event.datetype === 'date' ||
    (event.start instanceof Date && event.start.dateOnly === true) ||
    (typeof event.start === 'string' && !event.start.includes('T'));

  return {
    id: event.uid || String(Math.random()),
    title: event.summary || '(No title)',
    start: new Date(start).toISOString(),
    end: end ? new Date(end).toISOString() : new Date(start).toISOString(),
    allDay: !!isAllDay,
    calendar: calendarName,
    color,
  };
}

// ---------------------------------------------------------------------------
// Google Calendar (OAuth2)
// ---------------------------------------------------------------------------

async function fetchGoogleCalendar(config, startDate, endDate) {
  const oauth2 = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    'http://localhost:3456/oauth2callback'
  );
  oauth2.setCredentials({ refresh_token: config.google.refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  const res = await calendar.events.list({
    calendarId: config.calendars?.googleCalendarId ?? 'primary',
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });

  return (res.data.items || []).map((ev) => ({
    id: ev.id,
    title: ev.summary || '(No title)',
    start: ev.start.dateTime || ev.start.date,
    end: ev.end?.dateTime || ev.end?.date || ev.start.dateTime || ev.start.date,
    allDay: !!ev.start.date && !ev.start.dateTime,
    calendar: 'Google',
    color: '#4285F4',
  }));
}

module.exports = { fetchICS, fetchGoogleCalendar };
