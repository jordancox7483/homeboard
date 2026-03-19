#!/usr/bin/env node
'use strict';

/**
 * One-time Google OAuth 2.0 setup for HomeBoard.
 * Run: npm run setup-auth
 *
 * Opens a browser to the Google consent screen, listens on localhost:3456
 * for the OAuth callback, exchanges the code for tokens, and saves the
 * refresh token to ~/HomeBoard/config.json.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(os.homedir(), 'HomeBoard', 'config.json');
const DEFAULTS_PATH = path.join(__dirname, '..', 'config', 'defaults.json');
const REDIRECT_URI = 'http://localhost:3456/oauth2callback';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const PORT = 3456;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'));
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = Buffer.from(body);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': data.length,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve(JSON.parse(raw)));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const config = loadConfig();
  const { clientId, clientSecret } = config.google;

  if (!clientId || !clientSecret) {
    console.error('Error: google.clientId and google.clientSecret must be set in ~/HomeBoard/config.json');
    process.exit(1);
  }

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  console.log('\nHomeBoard — Google Calendar Setup\n');
  console.log('Opening your browser for Google OAuth consent...');
  console.log('\nIf the browser does not open, paste this URL manually:\n');
  console.log(authUrl + '\n');

  // Try to open the browser (cross-platform)
  try {
    const openCmd =
      process.platform === 'win32'  ? `start "" "${authUrl}"` :
      process.platform === 'darwin' ? `open "${authUrl}"` :
                                      `xdg-open "${authUrl}"`;
    execSync(openCmd, { stdio: 'ignore', shell: true });
  } catch {
    // Failed to open browser — user will paste manually
  }

  // Start local callback server
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/oauth2callback') {
        res.end();
        return;
      }
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h2>Authorization failed: ${error}</h2><p>You may close this tab.</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#fff">
          <h2 style="color:#C9A96E">HomeBoard authorized</h2>
          <p>You may close this tab and return to the terminal.</p>
        </body></html>
      `);
      server.close();
      resolve(authCode);
    });

    server.listen(PORT, () => {
      console.log(`Waiting for Google to redirect to http://localhost:${PORT}/oauth2callback ...`);
    });

    server.on('error', reject);

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for OAuth callback'));
    }, 5 * 60 * 1000);
  });

  console.log('\nAuthorization code received. Exchanging for tokens...');

  const tokenBody =
    `code=${encodeURIComponent(code)}` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&grant_type=authorization_code`;

  const tokens = await httpsPost('https://oauth2.googleapis.com/token', tokenBody);

  if (!tokens.refresh_token) {
    console.error('\nError: No refresh token returned. Make sure prompt=consent was honored.');
    console.error('Received:', JSON.stringify(tokens, null, 2));
    process.exit(1);
  }

  config.google.refreshToken = tokens.refresh_token;
  saveConfig(config);

  console.log('\nSuccess! Refresh token saved to ~/HomeBoard/config.json');
  console.log('Google Calendar is now connected. Start HomeBoard with: npm start\n');
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
