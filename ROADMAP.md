# claude-kroger Roadmap

## 🔴 Blocked
- **[Human] Kroger developer credentials** — need `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` from https://developer.kroger.com/dashboard/. Also configure redirect URI `http://localhost:8767/callback` and request scopes `product.compact` and `cart.basic:write`.

## 📋 Backlog
- [x] `[Code]` 2026-04-23 — Add GHCR build-push workflow — migrate container from `node:20-alpine` to a versioned GHCR image (`ghcr.io/aldarondo/...`) with GitHub Actions auto-deploy
- [x] `[Code]` 2026-04-23 — Add weekly scheduled rebuild — GitHub Actions `schedule: cron` to repull and push a fresh image every week, picking up base-image security patches
- [x] [Code] 2026-04-24 — Add `filter.brand` support to `search_products` tool (optional brand filter arg)
- [x] [Code] 2026-04-24 — Add `get_product_details` tool — fetch full product info by UPC including nutrition facts
- [x] [Code] 2026-04-24 — Add `filter.fulfillment` support (PICKUP vs DELIVERY) to product search

## ✅ Completed
- [2026-04-24] Added `filter.brand` and `filter.fulfillment` params to `search_products`; added `get_product_details` tool (UPC lookup with nutrition, size, stock level, categories); 13 tests passing.
- [2026-04-23] GHCR build-push workflow and weekly scheduled rebuild added to `.github/workflows/build.yml`; Dockerfile on `node:22-alpine`
- [2026-04-19] Scaffold: package.json, src/auth.js, src/api.js, src/index.js, src/authorize.js, .env.example, .gitignore, CLAUDE.md
- [2026-04-19] SSE transport pattern: src/server.js (factory), src/index.js (stdio), src/serve.js (SSE on port 8771), docker-compose.yml, unit tests (8 passing)
- [2026-04-19] Deployed to Synology NAS (port 8771); container running — blocked on Kroger credentials in `.env`

## 🚫 Blocked
- ❌ [docker-monitor:deploy-failed] GitHub Actions deploy failed (run #24920105840) — https://github.com/aldarondo/claude-kroger/actions/runs/24920105840 — 2026-04-25 08:01 UTC

- ❌ [docker-monitor:no-ghcr-image] Container `claude-kroger` uses `node:20-alpine` — migrate to `ghcr.io/aldarondo/...` with a GitHub Actions build-push workflow — 2026-04-23 08:00 UTC

