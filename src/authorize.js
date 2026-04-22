/**
 * Kroger OAuth2 authorization code flow.
 *
 * Opens the browser to the Kroger auth page, waits for the redirect on
 * localhost:8767, exchanges the code for tokens, and appends the tokens
 * to .env so they persist for future runs.
 *
 * Usage:
 *   node src/authorize.js
 */

import http from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { getAuthUrl, exchangeCode } from './auth.js';

// Load existing .env
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath   = resolve(__dirname, '../.env');

function loadEnv() {
  if (!existsSync(envPath)) return {};
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
    if (!process.env[key]) process.env[key] = val;
  }
  return env;
}

function saveEnv(updates) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line  = `${key}=${value}`;
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.trimEnd() + `\n${line}\n`;
    }
  }
  writeFileSync(envPath, content, 'utf8');
}

async function openBrowser(url) {
  const { exec } = await import('child_process');
  const platform = process.platform;
  const cmd = platform === 'win32' ? `start "" "${url}"`
            : platform === 'darwin' ? `open "${url}"`
            : `xdg-open "${url}"`;
  exec(cmd);
}

async function waitForCode(port = 8767) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url    = new URL(req.url, `http://localhost:${port}`);
      const code   = url.searchParams.get('code');
      const error  = url.searchParams.get('error');

      if (error) {
        res.writeHead(400);
        res.end(`Authorization error: ${error}`);
        server.close();
        reject(new Error(`Authorization denied: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body>
            <h2>Authorization successful!</h2>
            <p>You can close this tab and return to the terminal.</p>
          </body></html>
        `);
        server.close(() => resolve(code));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(port, () => {
      console.log(`Listening for OAuth2 callback on http://localhost:${port}/callback`);
    });

    server.on('error', reject);

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for authorization (5 min)'));
    }, 5 * 60 * 1000);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

loadEnv();

if (!process.env.KROGER_CLIENT_ID || !process.env.KROGER_CLIENT_SECRET) {
  console.error('Error: KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must be set in .env before authorizing.');
  process.exit(1);
}

const authUrl = getAuthUrl();
console.log('\nOpening browser for Kroger authorization...');
console.log(`If the browser does not open, visit:\n  ${authUrl}\n`);

await openBrowser(authUrl);

let code;
try {
  code = await waitForCode(8767);
} catch (err) {
  console.error(`Authorization failed: ${err.message}`);
  process.exit(1);
}

console.log('Received authorization code. Exchanging for tokens...');

try {
  const tokens = await exchangeCode(code);

  const updates = {
    KROGER_USER_TOKEN:            tokens.access_token,
    KROGER_USER_TOKEN_EXPIRES_AT: String(Date.now() + tokens.expires_in * 1000),
  };
  if (tokens.refresh_token) {
    updates.KROGER_USER_REFRESH_TOKEN = tokens.refresh_token;
  }

  saveEnv(updates);

  console.log('\nSuccess! Tokens saved to .env:');
  console.log('  KROGER_USER_TOKEN');
  if (tokens.refresh_token) console.log('  KROGER_USER_REFRESH_TOKEN');
  console.log('  KROGER_USER_TOKEN_EXPIRES_AT');
  console.log('\nCart tools are now available.');
} catch (err) {
  console.error(`Token exchange failed: ${err.message}`);
  if (err.response?.data) {
    console.error('API response:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
}
