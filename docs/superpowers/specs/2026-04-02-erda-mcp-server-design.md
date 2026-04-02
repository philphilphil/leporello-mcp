# Erda — Classical Music and Opera Calendar MCP Server

**Date:** 2026-04-02  
**Status:** Approved

## Overview

A remote MCP server that aggregates opera and classical music schedules from venue websites via daily scraping, serving structured event data to LLM clients. Public access, no authentication. Deployed as a single Docker container on a VPS behind Caddy.

---

## Architecture

**Stack:**
- Runtime: Node.js + TypeScript
- HTTP server: Hono (fast, minimal)
- MCP transport: Streamable HTTP (`POST /mcp`)
- Database: SQLite via `better-sqlite3` (synchronous, WAL mode)
- Scraping: Cheerio (default); Playwright only if JS rendering is required
- Scheduling: `node-cron` (runs inside same process)
- Deployment: Single Docker container + Caddy reverse proxy (auto TLS)

**Data flow:**
```
node-cron (daily 03:00) → Scraper[] → SQLite upsert
Claude → POST /mcp → Hono → MCP SDK → SQLite read → Response
```

---

## Project Structure

```
erda/
├── src/
│   ├── server.ts          # Hono server + MCP Streamable HTTP handler
│   ├── db.ts              # SQLite schema, migrations, query helpers
│   ├── scheduler.ts       # node-cron, runs all scrapers daily
│   ├── scrapers/
│   │   ├── base.ts        # Scraper interface: scrape() → Event[]
│   │   ├── staatsoper-stuttgart.ts
│   │   └── philharmoniker-stuttgart.ts
│   └── types.ts           # Event, Venue, shared types
├── data/                  # SQLite file (Docker volume mount)
├── Dockerfile
└── docker-compose.yml
```

---

## Database Schema

```sql
CREATE TABLE cities (
  id          TEXT PRIMARY KEY,   -- e.g. "stuttgart"
  name        TEXT NOT NULL,      -- "Stuttgart"
  country     TEXT NOT NULL       -- ISO 3166-1 alpha-2, e.g. "DE"
);

CREATE TABLE venues (
  id          TEXT PRIMARY KEY,   -- e.g. "staatsoper-stuttgart"
  name        TEXT NOT NULL,
  city_id     TEXT NOT NULL REFERENCES cities(id),
  url         TEXT NOT NULL,
  last_scraped TEXT               -- ISO 8601 timestamp, null if never scraped
);

CREATE TABLE events (
  id          TEXT PRIMARY KEY,   -- sha256(venueId:date:time:normalizedTitle)[0:16]
  venue_id    TEXT NOT NULL REFERENCES venues(id),
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,      -- "YYYY-MM-DD"
  time        TEXT,               -- "HH:MM", nullable
  conductor   TEXT,
  cast        TEXT,               -- JSON array of strings
  url         TEXT,
  scraped_at  TEXT NOT NULL       -- ISO 8601 timestamp
);

CREATE INDEX events_venue_date ON events(venue_id, date);
```

`list_cities` becomes a direct `SELECT * FROM cities` with a `venue_count` join — no string aggregation or deduplication needed.

**Event ID generation:** `sha256(`${venueId}:${date}:${time}:${title.toLowerCase().trim()}`).slice(0, 16)`. Stable across scrape runs; enables upsert without duplicates. Edge case: two performances of the same piece at the same venue/date/time (rare) would collide — deferred to post-MVP.

---

## Scraper Interface

```typescript
interface Scraper {
  venueId: string;
  scrape(): Promise<Event[]>;
}
```

The scheduler calls all registered scrapers daily. Each scraper's results are upserted into SQLite. On failure, the scraper logs the error and exits gracefully — existing data for that venue is preserved until the next successful scrape. `venues.last_scraped` is only updated on success.

**HTML parsing strategy:** Cheerio by default (no browser overhead). Playwright is used only when a venue site requires JavaScript rendering. Playwright adds ~200MB to the Docker image and startup time, so it should be avoided unless necessary.

**MVP venues:**
- `staatsoper-stuttgart` — Staatsoper Stuttgart
- `philharmoniker-stuttgart` — Stuttgarter Philharmoniker

---

## MCP Tools

### `list_cities`
Returns all cities for which venue data exists.

```typescript
// Input: none

// Output
{
  cities: Array<{
    name: string;       // "Stuttgart"
    country: string;    // "DE"
    venue_count: number;
  }>
}
```

### `list_venues`
Returns all known venues, optionally filtered by city.

```typescript
// Input
{ city?: string }

// Output
{
  venues: Array<{
    id: string;           // "staatsoper-stuttgart"
    name: string;         // "Staatsoper Stuttgart"
    city: string;         // "Stuttgart"
    country: string;      // "DE"
    last_scraped: string | null;
  }>
}
```

### `get_events`
Returns upcoming events, optionally filtered by city or venue.

```typescript
// Input
{
  city?: string;
  venue_id?: string;
  days_ahead?: number;  // default: 30, max: 90
}

// Output
{
  events: Array<{
    id: string;
    venue_id: string;
    venue_name: string;
    title: string;
    date: string;        // "YYYY-MM-DD"
    time: string | null; // "HH:MM"
    conductor?: string;
    cast?: string[];
    url: string;
  }>;
  data_age: Record<string, string>;  // venue_id → last_scraped ISO timestamp
}
```

**Discovery flow:** `list_cities` → `list_venues` → `get_events`

---

## Deployment

**Dockerfile:** Multi-stage build, Node.js Alpine base. SQLite file stored in a named Docker volume (`erda-data`), persisted across container restarts.

**docker-compose.yml:**
```yaml
services:
  erda:
    build: .
    restart: unless-stopped
    volumes:
      - erda-data:/app/data
    environment:
      - SCRAPE_CRON=0 3 * * *
      - PORT=3000
    networks:
      - gateway
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=gateway"
      - "traefik.http.routers.erda.rule=Host(`erda.example.com`)"
      - "traefik.http.routers.erda.entrypoints=websecure"
      - "traefik.http.routers.erda.tls.certresolver=myresolver"
      - "traefik.http.services.erda.loadbalancer.server.port=3000"

volumes:
  erda-data:

networks:
  gateway:
    external: true
```

**Reverse proxy:** Traefik (external, `gateway` network, `myresolver` for TLS). Public MCP endpoint: `https://erda.<domain>/mcp`

**Logging:** Structured JSON logs (scrape start/end, event count, errors). No external monitoring in MVP.

---

## Testing

**Scraper unit tests** using HTML fixtures — no real HTTP calls.

**Structure:**
```
src/
└── scrapers/
    ├── __fixtures__/
    │   ├── staatsoper-stuttgart.html   # saved raw HTML snapshot
    │   └── philharmoniker-stuttgart.html
    ├── __tests__/
    │   ├── staatsoper-stuttgart.test.ts
    │   └── philharmoniker-stuttgart.test.ts
```

Each scraper accepts an optional `fetchHtml` dependency (defaults to real `fetch`), so tests can inject the fixture instead:

```typescript
// staatsoper-stuttgart.test.ts
it("parses events from fixture", async () => {
  const html = fs.readFileSync("__fixtures__/staatsoper-stuttgart.html", "utf8");
  const scraper = new StaatsoperStuttgartScraper({ fetchHtml: () => html });
  const events = await scraper.scrape();

  expect(events.length).toBeGreaterThan(0);
  expect(events[0]).toMatchObject({
    venue_id: "staatsoper-stuttgart",
    title: expect.any(String),
    date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
});
```

**Fixture maintenance:** When a venue updates their HTML structure and the scraper breaks, update the fixture with a fresh `curl` snapshot and fix the scraper. The fixture is committed to git so CI runs against a known-good snapshot.

**Test runner:** Vitest (fast, native TypeScript, no config overhead).

---

## Out of Scope (MVP)

- Authentication / API keys
- More than 2 venues
- Monitoring / alerting
- Web UI
- Enrichment via Open Opus API
