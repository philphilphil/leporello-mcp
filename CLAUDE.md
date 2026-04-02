# Leporello — Codebase Guide

Remote MCP server for classical music / opera event schedules. Node.js 22, TypeScript ESM, SQLite, Cheerio scrapers, node-cron scheduler. Static Astro frontend.

## Commands

```bash
npm run dev      # Start server + scheduler (loads .env)
npm run scrape   # Run scrapers once and exit (loads .env)
npm test         # Run scraper unit tests (16 tests)
npm run build    # Compile TypeScript to dist/
npm run build --prefix web  # Build Astro frontend to web/dist/
```

## Architecture

One process, four responsibilities:
- **HTTP server** (`src/server.ts`) — Streamable HTTP MCP endpoint at `POST /mcp`, health check at `GET /health`, static frontend for everything else
- **Scheduler** (`src/scheduler.ts`) — node-cron runs `runAllScrapers()` daily at 03:00 UTC, then rebuilds the frontend
- **Scrapers** (`src/scrapers/`) — Cheerio-based, one file per venue
- **Frontend** (`web/`) — Astro static site, reads SQLite at build time, client-side filtering/search

Entry point is `src/index.ts`: initializes DB → starts HTTP server → starts scheduler → triggers initial scrape if DB is empty.

## File map

```
src/
  index.ts                    Entry point
  server.ts                   McpServer (4 tools) + HTTP server + static file serving
  scheduler.ts                node-cron + runAllScrapers() + rebuildWeb()
  scrape.ts                   One-shot scrape script (npm run scrape)
  db.ts                       SQLite singleton, schema, seed data, queries
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

1. Create `src/scrapers/<venue-id>.ts`:
   - `export class MyVenueScraper implements Scraper`
   - Declare `readonly venue: VenueMeta` with venueId, venueName, cityId, cityName, country, scheduleUrl
   - Constructor with optional `{ fetchHtml?: () => Promise<string> }` for test injection
   - Separate `scrape()` and `parse(html)` methods
   - Use `generateEventId()` from `./base.js`
   - Use `new URL(href, BASE_URL + '/').href` for URL construction
   - Use the venue's native-language pages when available (e.g. `/de/spielplan/` instead of `/en/schedule/`) to get original, untranslated event titles
2. Fetch fixture: `curl -s -A "Mozilla/5.0..." <url> -o src/scrapers/__fixtures__/<venue-id>.html`
3. Write tests in `src/scrapers/__tests__/<venue-id>.test.ts` (see existing tests)
4. Add to `scrapers` array in `src/scheduler.ts`
5. Add the new venue to the **Supported Venues** table in `README.md`
6. **PR description MUST include a clickable link to the venue's schedule page** (e.g. `**Schedule URL:** https://...`)

## MCP tools

| Tool | Input | Notes |
|---|---|---|
| `list_countries` | — | Returns countries with city/venue counts |
| `list_cities` | `country?` | Filter by ISO country code (e.g. "DE") |
| `list_venues` | `country?`, `city?` | Cascading filter: country → city |
| `list_events` | `country?`, `city?`, `venue_id?`, `days_ahead?` | `days_ahead` default 30, max 90; returns `data_age` map |

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

All logs are structured JSON on stdout/stderr:

```json
{"event":"server_start","port":3000}
{"event":"scheduler_start","cron":"0 3 * * *"}
{"event":"scrape_start","venue":"staatsoper-stuttgart"}
{"event":"scrape_success","venue":"staatsoper-stuttgart","count":77,"duration_ms":214}
{"event":"scrape_error","venue":"...","error":"...","duration_ms":...}
{"event":"web_build_start"}
{"event":"web_build_success","duration_ms":...}
{"event":"initial_scrape_triggered"}
{"event":"mcp_request_error","error":"..."}
```

## Playwright screenshots

Save all Playwright screenshots into `.playwright-mcp/` (already gitignored), not the project root.

## Deployment

Docker Compose + Traefik at `leporello.app`.

```bash
docker compose up -d
docker compose logs -f leporello
```
