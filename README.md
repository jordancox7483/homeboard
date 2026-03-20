# HomeBoard

> *This README was written with the help of Claude (Anthropic's AI assistant).*

A self-hosted ambient dashboard for macOS and Windows, inspired by DakBoard. Runs as an Electron app in fullscreen kiosk mode and simultaneously serves the same dashboard over the local network so any device (iPad, phone, second monitor) can open it in a browser.

- Live Flickr photostream background with crossfade transitions
- Current time and date (Playfair Display)
- Weather from Open-Meteo (no API key required)
- Aggregated events from Google Calendar + public ICS feeds (F1, IndyCar, IMSA, NASCAR, US Holidays)
- Built-in Express web server on port 3000 — open on any device on the same network

---

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **macOS or Windows** (both are supported)
- A **Google Cloud project** with the Calendar API enabled (only needed for Google Calendar integration)

---

## 1. Install dependencies

```bash
cd homeboard
npm install
```

---

## 2. Config file

On first launch, HomeBoard creates `~/HomeBoard/config.json` from the bundled defaults. You can edit it before launching.

> On Windows this resolves to `C:\Users\YourName\HomeBoard\config.json`.

**Key fields:**

| Field | Description |
|---|---|
| `flickr.userId` | Your Flickr user ID (see below) |
| `flickr.rotationIntervalSeconds` | Seconds between photo transitions (default: 60) |
| `google.clientId` | Google OAuth client ID |
| `google.clientSecret` | Google OAuth client secret |
| `google.refreshToken` | Populated automatically by `npm run setup-auth` |
| `calendars.publicICS` | Array of `{ name, url, color }` ICS feeds |
| `weather.latitude` / `weather.longitude` | Your location |
| `weather.units` | `"fahrenheit"` or `"celsius"` |
| `display.kioskMode` | `true` = fullscreen kiosk, `false` = windowed |
| `display.calendarDaysAhead` | How many days ahead to show events (default: 30) |
| `display.maxEvents` | Max number of events in the bottom panel (default: 10) |

### Finding your Flickr user ID

1. Go to your Flickr profile page (e.g. `https://www.flickr.com/photos/username/`)
2. Visit [idgettr.com](https://idgettr.com) or [Flickr ID Finder](https://www.webfx.com/tools/idgettr/) and paste your profile URL
3. Your user ID looks like `41867021@N02`

Set it in `~/HomeBoard/config.json`:
```json
"flickr": { "userId": "YOUR_ID_HERE", "rotationIntervalSeconds": 60 }
```

---

## 3. Google Calendar setup (optional)

### 3a. Create a Google Cloud OAuth client

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Google Calendar API**: APIs & Services → Library → search "Google Calendar API" → Enable
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
5. Application type: **Web application**
6. Add `http://localhost:3456/oauth2callback` under **Authorized redirect URIs**
7. Copy the **Client ID** and **Client Secret** into `~/HomeBoard/config.json`:
   ```json
   "google": {
     "clientId": "YOUR_CLIENT_ID",
     "clientSecret": "YOUR_CLIENT_SECRET",
     "refreshToken": ""
   }
   ```

### 3b. Authorize HomeBoard

```bash
npm run setup-auth
```

This opens your browser to the Google consent screen (works on macOS, Windows, and Linux). After granting access, the refresh token is saved automatically to `~/HomeBoard/config.json`.

If Google Calendar is not connected, a yellow banner will appear on the dashboard: **"Google Calendar not connected — run npm run setup-auth"**.

---

## 4. First run

```bash
npm start
```

On startup, the terminal prints the network address for other devices:

```
HomeBoard web server running:
  Local:   http://localhost:3000
  Network: http://192.168.1.42:3000  <-- open this on your iPad
```

Open the Network URL in Safari on an iPad, or any browser on any device on the same Wi-Fi network. The dashboard is identical to the Electron window.

**Keyboard shortcuts (Electron window):**

| Key | Action |
|---|---|
| `ESC` | Exit kiosk / fullscreen |
| `Cmd+Option+I` (macOS) / `Ctrl+Alt+I` (Windows) | Open DevTools |

---

## 5. Build

### macOS

```bash
npm run build        # .app + .zip (arm64 + x64) → dist/
npm run build:dmg    # .dmg installer → dist/
```

### Windows

```bash
npm run build:win:portable   # Single standalone .exe, no install required → dist/
npm run build:win            # NSIS installer .exe → dist/
```

The portable `.exe` is the fastest path for testing — just double-click and it runs. The NSIS installer adds a desktop shortcut, Start Menu entry, and an uninstaller.

> **Cross-compiling:** electron-builder can build for the other platform from CI, but building macOS `.app` bundles requires a Mac, and building Windows installers with code signing requires Windows or a Windows VM. For local dev, build on the platform you're targeting.

---

## 6. Launch on login

### macOS

1. Open **System Settings → General → Login Items**
2. Click **+** under "Open at Login"
3. Select `dist/mac/HomeBoard.app`

### Windows

The NSIS installer (`npm run build:win`) adds a Start Menu shortcut you can pin to Startup. Alternatively:

1. Press `Win+R`, type `shell:startup`, hit Enter
2. Drop a shortcut to `HomeBoard.exe` into that folder

---

## Troubleshooting

- **Flickr photos not loading** — verify your Flickr user ID is correct and the photostream is public. Check DevTools console (Cmd+Option+I / Ctrl+Alt+I).
- **Google Calendar not connecting** — make sure `http://localhost:3456/oauth2callback` is listed under Authorized Redirect URIs in your Google Cloud OAuth client, then re-run `npm run setup-auth`.
- **ICS feed failing** — the dashboard continues loading the other calendars if one feed fails. Check the terminal for `[Calendar] <name> failed:` messages.
- **Weather not loading** — verify `latitude` and `longitude` in config.json are correct decimal coordinates.
- **iPad can't reach the dashboard** — make sure the Mac/PC and iPad are on the same Wi-Fi network and your firewall allows inbound connections on port 3000.
