# Erda

A remote MCP server that aggregates classical music and opera schedules from Stuttgart venues and serves them via three MCP tools.

## Tools

| Tool | Description |
|---|---|
| `list_cities` | All cities with venues |
| `list_venues` | All venues, optionally filtered by city |
| `get_events` | Upcoming events, filtered by city or venue, with data freshness info |

## Quick start

```bash
git clone <repo>
cd erda
cp .env.sample .env
npm install
npm run dev
```

The server starts on `http://localhost:3000`. On first run it scrapes both venues automatically (~30s).

**Run a one-off scrape** (no server):
```bash
npm run scrape
```

**Inspect the data** — the SQLite database is at `data/erda.db`. Open it in any SQLite browser (e.g. DB Browser for SQLite) to explore the `cities`, `venues`, and `events` tables.

## Connect to Claude

Add to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "erda": {
      "url": "https://your-domain.com/mcp"
    }
  }
}
```

Or for local development:

```json
{
  "mcpServers": {
    "erda": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Calling the API directly

The MCP endpoint requires these headers:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_cities","arguments":{}},"id":1}'
```

The response is SSE — the JSON payload is on the `data:` line.

## Deploy (Docker + Traefik)

1. Copy `.env.sample` to `.env` and set values
2. Update the hostname in `docker-compose.yml` (`erda.example.com` → your domain)
3. Run:

```bash
docker compose up -d
```

The container scrapes on startup if the database is empty, then runs daily at 03:00 UTC.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/erda.db` | SQLite file path |
| `SCRAPE_CRON` | `0 3 * * *` | Cron expression for daily scrape |

## Adding a new venue

1. Add the city to `seedStaticData()` in `src/db.ts` (if not already there)
2. Add the venue to `seedStaticData()` in `src/db.ts`
3. Create `src/scrapers/<venue-id>.ts` implementing the `Scraper` interface (use an existing scraper as reference)
4. Fetch and save the HTML fixture: `curl -s -A "Mozilla/5.0..." <url> -o src/scrapers/__fixtures__/<venue-id>.html`
5. Write tests in `src/scrapers/__tests__/<venue-id>.test.ts`
6. Register the scraper in the `scrapers` array in `src/scheduler.ts`

## Refreshing a broken scraper

When a venue redesigns their site and the scraper returns 0 events:

```bash
# Save fresh fixture
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  <venue-url> -o src/scrapers/__fixtures__/<venue-id>.html

# Fix selectors in the scraper, then verify
npm test
```

## Current venues

| ID | Venue |
|---|---|
| `staatsoper-stuttgart` | Staatsoper Stuttgart |
| `philharmoniker-stuttgart` | Stuttgarter Philharmoniker |
