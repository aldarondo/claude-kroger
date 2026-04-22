/**
 * claude-kroger MCP server factory.
 * Call createServer() to get a configured Server instance without a transport.
 *
 * Env vars required:
 *   KROGER_CLIENT_ID      - OAuth2 app client ID
 *   KROGER_CLIENT_SECRET  - OAuth2 app client secret
 *
 * Optional (for cart operations):
 *   KROGER_USER_TOKEN               - User access token (run src/authorize.js to get)
 *   KROGER_USER_REFRESH_TOKEN       - Refresh token
 *   KROGER_USER_TOKEN_EXPIRES_AT    - Expiry in unix ms
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getClientToken, getUserToken } from './auth.js';
import { searchProducts, searchLocations, addToCart, nearestLocationId } from './api.js';

// Load .env if present (dev convenience)
try {
  const { readFileSync } = await import('fs');
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not present — that's fine
}

export function createServer() {
  const server = new Server(
    { name: 'claude-kroger', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // ── Tool definitions ────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_products',
        description:
          'Search for products at Kroger by name or keyword. Optionally provide a zip_code to get ' +
          'local pricing and availability. Returns product name, brand, price, and UPC.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search term — product name, brand, or keyword (e.g. "organic whole milk", "tide pods")',
            },
            zip_code: {
              type: 'string',
              description: 'Optional. US ZIP code to find the nearest store and get local pricing.',
            },
            limit: {
              type: 'number',
              description: 'Number of results to return (default: 10, max: 50)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_stores',
        description: 'Find Kroger stores near a given ZIP code. Returns store name, location ID, and address.',
        inputSchema: {
          type: 'object',
          properties: {
            zip_code: {
              type: 'string',
              description: 'US ZIP code to search near',
            },
          },
          required: ['zip_code'],
        },
      },
      {
        name: 'add_to_cart',
        description:
          'Add items to the user\'s Kroger cart. Requires user authentication — run `node src/authorize.js` ' +
          'first to complete the OAuth2 flow and set KROGER_USER_TOKEN. ' +
          'Accepts product names (will search to resolve UPC) or explicit UPC codes.',
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description: 'Items to add to cart',
              items: {
                type: 'object',
                properties: {
                  product_name_or_upc: {
                    type: 'string',
                    description: 'Product name to search for, or a 13-digit UPC code',
                  },
                  quantity: {
                    type: 'number',
                    description: 'Quantity to add (default: 1)',
                  },
                },
                required: ['product_name_or_upc'],
              },
            },
            zip_code: {
              type: 'string',
              description: 'Optional. ZIP code to find nearest store when resolving product names to UPCs.',
            },
          },
          required: ['items'],
        },
      },
    ],
  }));

  // ── Tool handlers ───────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'search_products': {
          const token      = await getClientToken();
          const limit      = args.limit ?? 10;
          let   locationId = null;

          if (args.zip_code) {
            locationId = await nearestLocationId(token, args.zip_code);
          }

          const products = await searchProducts(token, args.query, locationId, limit);

          if (products.length === 0) {
            return { content: [{ type: 'text', text: `No products found for "${args.query}".` }] };
          }

          const lines = products.map((p, i) => {
            const brand = p.brand ? `${p.brand} — ` : '';
            return `${i + 1}. ${brand}${p.description}\n   UPC: ${p.upc} | ${p.price}`;
          });

          const header = locationId
            ? `Found ${products.length} product(s) for "${args.query}" (store: ${locationId}):`
            : `Found ${products.length} product(s) for "${args.query}" (no store selected — prices may vary):`;

          return { content: [{ type: 'text', text: `${header}\n\n${lines.join('\n\n')}` }] };
        }

        case 'find_stores': {
          const token  = await getClientToken();
          const stores = await searchLocations(token, args.zip_code);

          if (stores.length === 0) {
            return { content: [{ type: 'text', text: `No Kroger stores found near ${args.zip_code}.` }] };
          }

          const lines = stores.map((s, i) =>
            `${i + 1}. ${s.name}\n   Location ID: ${s.locationId}\n   ${s.address}`
          );

          return {
            content: [{ type: 'text', text: `Kroger stores near ${args.zip_code}:\n\n${lines.join('\n\n')}` }],
          };
        }

        case 'add_to_cart': {
          const userToken = await getUserToken();
          if (!userToken) {
            return {
              content: [{
                type: 'text',
                text: 'Cart access requires user authentication. Run `node src/authorize.js` to complete the OAuth2 flow and set KROGER_USER_TOKEN.',
              }],
              isError: true,
            };
          }

          const clientToken = await getClientToken();
          let   locationId  = null;
          if (args.zip_code) {
            locationId = await nearestLocationId(clientToken, args.zip_code);
          }

          // Resolve product names to UPCs
          const resolvedItems = [];
          const notFound = [];

          for (const item of args.items) {
            const raw = item.product_name_or_upc;
            const qty = item.quantity ?? 1;

            // Looks like a UPC (all digits, 12-13 chars)
            if (/^\d{12,13}$/.test(raw)) {
              resolvedItems.push({ upc: raw, quantity: qty });
              continue;
            }

            // Search for it
            const products = await searchProducts(clientToken, raw, locationId, 1);
            if (products.length > 0) {
              resolvedItems.push({ upc: products[0].upc, quantity: qty });
            } else {
              notFound.push(raw);
            }
          }

          const messages = [];

          if (notFound.length > 0) {
            messages.push(`Could not find products for: ${notFound.join(', ')}`);
          }

          if (resolvedItems.length > 0) {
            const result = await addToCart(userToken, resolvedItems);
            messages.push(result.message);
          } else {
            messages.push('No items could be resolved. Nothing added to cart.');
          }

          return { content: [{ type: 'text', text: messages.join('\n') }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
