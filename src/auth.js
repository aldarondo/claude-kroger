/**
 * Kroger OAuth2 token management.
 *
 * Two flows:
 *   1. client_credentials — for product search and store lookup (no user needed)
 *   2. authorization_code — for cart management (requires user login)
 *
 * Docs: https://developer.kroger.com/documentation/public/getting-started/api-reference#tag/Authentication
 */

import axios from 'axios';

const TOKEN_URL = 'https://api.kroger.com/v1/connect/oauth2/token';
const AUTH_URL  = 'https://api.kroger.com/v1/connect/oauth2/authorize';
const REDIRECT_URI = process.env.KROGER_REDIRECT_URI || 'http://localhost:8767/callback';

// ── In-memory cache for the client token ─────────────────────────────────────
let _clientToken    = null;
let _clientExpiresAt = 0;   // unix ms

/**
 * Get (or refresh) a client_credentials token.
 * Used for product search and store lookup.
 * @returns {Promise<string>} access token
 */
export async function getClientToken() {
  // Serve from cache if still valid (with 60s safety margin)
  if (_clientToken && Date.now() < _clientExpiresAt - 60_000) {
    return _clientToken;
  }

  const clientId     = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must be set');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'product.compact',
  });

  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    timeout: 15_000,
  });

  _clientToken    = data.access_token;
  _clientExpiresAt = Date.now() + data.expires_in * 1000;

  return _clientToken;
}

/**
 * Build the authorization URL for the user OAuth2 flow (cart access).
 * Direct the user to this URL to grant cart permissions.
 * @returns {string} authorization URL
 */
export function getAuthUrl() {
  const clientId = process.env.KROGER_CLIENT_ID;
  if (!clientId) throw new Error('KROGER_CLIENT_ID must be set');

  const params = new URLSearchParams({
    scope:         'cart.basic:write product.compact',
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  REDIRECT_URI,
  });

  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for a user access token.
 * Saves the token to KROGER_USER_TOKEN env var for the current process.
 * @param {string} code - authorization code from the redirect callback
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number}>}
 */
export async function exchangeCode(code) {
  const clientId     = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must be set');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const params = new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    timeout: 15_000,
  });

  // Persist to env for this process
  process.env.KROGER_USER_TOKEN = data.access_token;
  if (data.refresh_token) {
    process.env.KROGER_USER_REFRESH_TOKEN = data.refresh_token;
  }
  process.env.KROGER_USER_TOKEN_EXPIRES_AT = String(Date.now() + data.expires_in * 1000);

  return data;
}

/**
 * Get the user access token, refreshing if expired.
 * Returns null if no user token is configured (cart will be unavailable).
 * @returns {Promise<string|null>}
 */
export async function getUserToken() {
  const token     = process.env.KROGER_USER_TOKEN;
  const expiresAt = parseInt(process.env.KROGER_USER_TOKEN_EXPIRES_AT || '0', 10);

  if (!token) return null;

  // Still valid
  if (Date.now() < expiresAt - 60_000) return token;

  // Attempt refresh
  const refreshToken = process.env.KROGER_USER_REFRESH_TOKEN;
  if (!refreshToken) return null;

  return refreshUserToken(refreshToken);
}

async function refreshUserToken(refreshToken) {
  const clientId     = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;
  const credentials  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });

  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    timeout: 15_000,
  });

  process.env.KROGER_USER_TOKEN = data.access_token;
  if (data.refresh_token) {
    process.env.KROGER_USER_REFRESH_TOKEN = data.refresh_token;
  }
  process.env.KROGER_USER_TOKEN_EXPIRES_AT = String(Date.now() + data.expires_in * 1000);

  return data.access_token;
}
