/**
 * Kroger REST API client.
 * Docs: https://developer.kroger.com/documentation/public/getting-started/api-reference
 */

import axios from 'axios';
import { getClientToken, getUserToken } from './auth.js';

const BASE = 'https://api.kroger.com/v1';

// ── Low-level helpers ─────────────────────────────────────────────────────────

async function get(path, params = {}, token) {
  const t = token || await getClientToken();
  const { data } = await axios.get(`${BASE}${path}`, {
    params,
    headers: { Authorization: `Bearer ${t}` },
    timeout: 15_000,
  });
  return data;
}

async function put(path, body, token) {
  const { data } = await axios.put(`${BASE}${path}`, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15_000,
  });
  return data;
}

// ── Product search ────────────────────────────────────────────────────────────

/**
 * Search Kroger products by term, optionally scoped to a store.
 * @param {string} token - client token from getClientToken()
 * @param {string} query - search term (e.g. "organic milk")
 * @param {string} [locationId] - Kroger location ID to scope prices/availability
 * @param {number} [limit=10] - number of results (max 50)
 * @returns {Promise<Array<{upc, brand, description, price, imageUrl}>>}
 */
export async function searchProducts(token, query, locationId, limit = 10) {
  if (!query) throw new Error('query is required');

  const params = {
    'filter.term':  query,
    'filter.limit': Math.min(limit, 50),
  };
  if (locationId) params['filter.locationId'] = locationId;

  const response = await get('/products', params, token);
  const items = response?.data || [];

  return items.map((item) => {
    const images = item.images || [];
    const front  = images.find((img) => img.perspective === 'front') || images[0];
    const thumb  = front?.sizes?.find((s) => s.size === 'thumbnail') ||
                   front?.sizes?.[0];

    const priceInfo = item.items?.[0]?.price;
    const price     = priceInfo
      ? `$${priceInfo.regular?.toFixed(2) || '?'} (sale: $${priceInfo.promo?.toFixed(2) || 'N/A'})`
      : 'Price unavailable';

    return {
      upc:         item.upc,
      brand:       item.brand || '',
      description: item.description || '',
      price,
      imageUrl:    thumb?.url || '',
    };
  });
}

// ── Store / location search ───────────────────────────────────────────────────

/**
 * Find Kroger stores near a ZIP code.
 * @param {string} token - client token
 * @param {string} zipCode - US ZIP code
 * @param {number} [limit=5] - number of results
 * @returns {Promise<Array<{locationId, name, address}>>}
 */
export async function searchLocations(token, zipCode, limit = 5) {
  if (!zipCode) throw new Error('zipCode is required');

  const params = {
    'filter.zipCode.near': zipCode,
    'filter.limit':        Math.min(limit, 10),
    'filter.chain':        'Kroger',
  };

  const response = await get('/locations', params, token);
  const locations = response?.data || [];

  return locations.map((loc) => ({
    locationId: loc.locationId,
    name:       loc.name,
    address:    formatAddress(loc.address),
  }));
}

function formatAddress(addr) {
  if (!addr) return '';
  const parts = [addr.addressLine1, addr.city, addr.state, addr.zipCode];
  return parts.filter(Boolean).join(', ');
}

// ── Cart management ───────────────────────────────────────────────────────────

/**
 * Add items to the authenticated user's Kroger cart.
 * Requires a user token obtained via the authorization_code flow.
 * @param {string} userToken - user access token from getUserToken() or exchangeCode()
 * @param {Array<{upc: string, quantity: number}>} items
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function addToCart(userToken, items) {
  if (!userToken) throw new Error('User token required for cart operations. Run node src/authorize.js to authenticate.');
  if (!Array.isArray(items) || items.length === 0) throw new Error('items must be a non-empty array');

  const payload = {
    items: items.map((item) => ({
      upc:       String(item.upc),
      quantity:  item.quantity || 1,
      modality:  'PICKUP',
    })),
  };

  try {
    await put('/cart/add', payload, userToken);
    return { success: true, message: `Added ${items.length} item(s) to your Kroger cart.` };
  } catch (err) {
    const status  = err.response?.status;
    const detail  = err.response?.data?.errors?.[0]?.reason || err.message;
    throw new Error(`Cart add failed (HTTP ${status}): ${detail}`);
  }
}

// ── Convenience: find nearest store locationId ────────────────────────────────

/**
 * Resolve a ZIP code to the nearest store's locationId.
 * Returns null if no stores found.
 * @param {string} token
 * @param {string} zipCode
 * @returns {Promise<string|null>}
 */
export async function nearestLocationId(token, zipCode) {
  const stores = await searchLocations(token, zipCode, 1);
  return stores[0]?.locationId || null;
}
