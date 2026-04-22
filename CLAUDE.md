# claude-kroger

## Project Purpose
MCP server wrapping the Kroger Developer API. Exposes three tools to a shopping assistant:
- `search_products` — search by keyword, optionally scoped to nearest store by ZIP
- `find_stores` — locate Kroger stores near a ZIP code
- `add_to_cart` — add items to the user's Kroger cart (requires user OAuth2)

Designed to run as a local stdio MCP server registered with Claude Desktop or any MCP-compatible host.

## Key Commands
```bash
npm install              # install dependencies
npm start                # run MCP server (stdio mode)
npm test                 # run unit tests
node src/authorize.js    # interactive OAuth2 flow to get KROGER_USER_TOKEN (needed for cart)
```

## Setup
1. Create a Kroger developer app at https://developer.kroger.com/dashboard/
   - Set redirect URI to `http://localhost:8767/callback`
   - Request scopes: `product.compact`, `cart.basic:write`
2. Copy `.env.example` → `.env`, fill in `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`
3. `npm install`
4. `npm start` — product search and store lookup work immediately
5. For cart access: run `node src/authorize.js` to complete the user OAuth2 flow

## Auth Model
- **Client credentials** (`getClientToken`): used automatically for `search_products` and `find_stores`. No user interaction needed. Token cached in-memory and auto-renewed.
- **Authorization code** (`getUserToken`): required for `add_to_cart`. Run `src/authorize.js` once; tokens saved to `.env` and auto-refreshed.

## MCP Registration (Claude Desktop)
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "kroger": {
      "command": "node",
      "args": ["C:/path/to/claude-kroger/src/index.js"]
    }
  }
}
```

## After Every Completed Task
- Move task to ✅ Completed in ROADMAP.md with today's date

## Git Rules
- Never create pull requests. Push directly to main.
- solo/auto-push OK

@~/Documents/GitHub/CLAUDE.md
