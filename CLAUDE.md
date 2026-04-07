# Leporello — Codebase Guide

Remote MCP server for classical music / opera event schedules. Node.js 22, TypeScript ESM, SQLite, Cheerio scrapers. Static Astro frontend. Two Docker containers: web (server + frontend) and scraper (fills DB, runs once and exits).

## Commands

```bash
npm run dev      # Start server + scheduler (loads .env)
npm run scrape   # Run scrapers once and exit (loads .env)
npm test         # Run scraper unit tests (16 tests)
npm run build    # Compile TypeScript to dist/
npm run build --prefix web  # Build Astro frontend to web/dist/
```

## Architecture

Two Docker containers sharing a SQLite volume:

- **Web container** (`Dockerfile.web`, entry: `src/index.ts`) — HTTP server (MCP + static Astro frontend), rebuilds frontend on every container start
- **Scraper container** (`Dockerfile.scraper`, entry: `src/scrape.ts`) — runs all scrapers once and exits. Scheduled via host cron or `docker compose run --rm scraper`
- **Scrapers** (`src/scrapers/`) — Cheerio/Playwright-based, one file per venue
- **Frontend** (`web/`) — Astro static site, reads SQLite at build time, client-side filtering/search

## File map

```
src/
  index.ts                    Entry point
  server.ts                   McpServer (4 tools) + HTTP server + static file serving
  scheduler.ts                Scraper registry + runScrapers()
  scrape.ts                   One-shot scrape script (npm run scrape)
  db.ts                       SQLite singleton, schema, queries
  types.ts                    City, Venue, Event interfaces
  scrapers/
    base.ts                   Scraper interface + generateEventId()
    philharmoniker-stuttgart.ts
    staatsoper-stuttgart.ts
    wiener-staatsoper.ts
    metropolitan-opera.ts
    __fixtures__/             Saved HTML/JSON snapshots for tests
    __tests__/                Scraper unit tests (fixture-based)
web/
  astro.config.ts             Astro configuration
  src/
    pages/index.astro         Single page — event listing
    layouts/Base.astro        HTML shell, fonts, meta
    components/               Filters.astro, EventList.astro
    lib/data.ts               Read-only SQLite queries for build time
    scripts/filter.ts         Client-side filtering, search, URL state
    i18n/                     en.ts, de.ts — translation strings
```

## Database

SQLite at `DB_PATH` env var (default `./data/leporello.db`). Initialized on `getDb()` call.

- `cities` — upserted by scrapers via `VenueMeta`
- `venues` — upserted by scrapers via `VenueMeta`, `last_scraped` updated after each successful scrape
- `events` — upserted by scrapers, `cast` stored as JSON string

## Adding a scraper

**Read [CONTRIBUTING.md](CONTRIBUTING.md) first** — it has the full step-by-step guide with code templates, rules, and examples. Agents must follow it exactly.

## MCP tools

| Tool | Input | Notes |
|---|---|---|
| `list_countries` | — | Returns countries with city/venue counts |
| `list_cities` | `country?` | Filter by ISO country code (e.g. "DE") |
| `list_venues` | `country?`, `city?` | Cascading filter: country → city |
| `list_events` | `country?`, `city?`, `venue_id?`, `days_ahead?` | `days_ahead` default 30, max 90; returns `data_age` map |

When a filter value isn't in the catalog (e.g. `city: "paris"`), `list_cities` / `list_venues` / `list_events` add a `note` field to the response telling the agent which filter is uncovered and which tool to call to discover what's available. The same miss is also logged on the `mcp_tool_call` event as `unmatched: {city: "paris"}` for Axiom monitoring — useful to see which cities/countries agents are asking for so we can prioritize new scrapers.

## Scraper pattern

Each scraper:
- Declares `VenueMeta` — the scheduler auto-registers the city and venue in the DB before scraping
- Fetches HTML from the live site (or from `fetchHtml` in tests)
- Parses with Cheerio
- Returns `Event[]` — all 9 fields must be set (`null` is fine for optional ones)
- Silently skips malformed entries (try/catch per element)
- Throws on non-2xx HTTP responses (caught by scheduler → logged as `scrape_error`)

## Tests

Fixture-based — no network calls. Each test file reads a saved HTML snapshot and injects it via `fetchHtml`. If a venue redesigns their site, update the fixture and fix the selectors.

```bash
npm test                    # Run all
npm test -- philharmoniker  # Run one scraper
```

## Logging

All logs are structured JSON on stdout/stderr via `src/logger.ts`. When `AXIOM_TOKEN` and `AXIOM_DATASET` are set, events are also shipped to Axiom (batched, flushed on shutdown). When unset, Axiom is a no-op — local dev and tests need no config.

Env vars (see `.env.sample`):
- `AXIOM_TOKEN` — Axiom ingest token (optional; absent = stdout only)
- `AXIOM_DATASET` — Axiom dataset name, e.g. `leporello-mcp`
- `HASH_SALT` — secret for hashing client IPs in MCP usage events; rotate yearly
- `SERVICE_NAME` — `web` or `scraper`, set per container in `docker-compose.yml` (and per `npm` script for local dev)
- `LEPORELLO_ENV` — set in `.env` on each host: `dev` locally, `production` on the deploy host. Tagged on every Axiom event as `env` so you can filter dev vs prod.

Events:

```json
{"event":"server_start","port":3000}
{"event":"scrape_start","venue":"staatsoper-stuttgart"}
{"event":"scrape_success","venue":"staatsoper-stuttgart","count":77,"duration_ms":214}
{"event":"scrape_error","venue":"...","error":"...","duration_ms":...}
{"event":"scrape_validation_error","venue":"...","errors":[...],"attempt":2,"final":true}
{"event":"web_build_start"}
{"event":"web_build_success","duration_ms":...}
{"event":"web_build_error","error":"...","duration_ms":...}
{"event":"shutdown"}
{"event":"mcp_request_error","error":"..."}
{"event":"mcp_tool_call","tool":"list_events","duration_ms":12,"result_count":47,"args":{"country":"DE"},"client_ua":"Claude/1.2.3","client_ip_hash":"a3f1b2c4d5e6f708"}
{"event":"mcp_tool_call","tool":"list_events","duration_ms":3,"result_count":0,"unmatched":{"city":"paris"},"args":{"city":"paris"},"client_ua":"...","client_ip_hash":"..."}
{"event":"mcp_tool_error","tool":"list_events","duration_ms":3,"args":{...},"error":"..."}
{"event":"axiom_disabled","reason":"no_token"}
{"event":"axiom_ingest_error","error":"..."}
```

To add a new logger call: import `log` / `logError` from `./logger.js` (or `../logger.js`) — never use `console.log(JSON.stringify(...))` directly.

## Playwright screenshots

Save all Playwright screenshots into `.playwright-mcp/` (already gitignored), not the project root.

## Deployment

Docker Compose + Traefik at `leporello.app`.

```bash
docker compose up -d                          # Start web server
docker compose run --rm scraper               # Run all scrapers (exits when done)
docker compose run --rm scraper node dist/scrape.js wiener-staatsoper  # Single venue
docker compose logs -f web                    # Tail web logs
```

Schedule scrapers via host cron (scrape then restart web to rebuild frontend):
```cron
0 3 * * * cd /home/phil/docker/lep && docker compose run --rm scraper && docker compose restart web
```
