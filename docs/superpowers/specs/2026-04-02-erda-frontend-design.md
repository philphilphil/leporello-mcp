# Erda Frontend — Design Spec

## Overview

A static frontend for Erda that displays upcoming classical music and opera events. Built with Astro, lives in `web/` as a subproject within the monorepo. Rebuilt automatically after each scrape. Served by the existing Node.js server.

## Goals

- Browse all upcoming events in a single-page chronological list
- Filter by city, venue, and date range
- Free text search across title, conductor, cast, venue, and location
- Shareable filtered views via URL query params
- Elegant, warm editorial visual style (concert-program feel)
- Fully static — no client-side data fetching

## Architecture

### Data flow

1. Scrapers run (daily 03:00 UTC or on first start) → populate SQLite
2. Scheduler triggers `npm run build --prefix web` after scraping completes
3. Astro build step (`web/src/lib/data.ts`) opens the SQLite DB read-only via `better-sqlite3` and runs its own queries (does NOT import `src/db.ts` — that module has schema init and singleton logic unsuitable for build-time use)
4. Single page embeds all event data as a JSON blob in a `<script>` tag
5. Node server serves `web/dist/` as static files

### Project structure

```
web/
  package.json
  astro.config.ts
  src/
    pages/
      index.astro             # Single page — event listing
    layouts/
      Base.astro              # HTML shell, fonts, meta
    components/
      EventList.astro         # Renders grouped event rows
      Filters.astro           # City, venue, date range dropdowns
      SearchBar.astro         # Free text search input
    lib/
      data.ts                 # Opens SQLite read-only, queries events/venues/cities
    scripts/
      filter.ts               # Client-side filtering/search logic
  public/
    favicon.svg
```

### Server changes

- **`src/server.ts`**: Add static file handler for `web/dist/`. Any request not matching `/mcp` or `/health` serves static files (with correct MIME types).
- **`src/scheduler.ts`**: After `runAllScrapers()` completes, spawn `npm run build --prefix web`. Log `web_build_start`, `web_build_success`, `web_build_error` events.
- **`Dockerfile`**: Add build stage for web dependencies and `astro build`.

No changes to scraper logic, DB schema, or MCP tools.

## UI Design

### Layout

Chronological list grouped by date. Filter bar at the top, event rows below.

**Date group header**: Date formatted as "Saturday, April 5" in gold accent color, with a subtle bottom border.

**Event row**: Time on the left (fixed width), title (bold) with venue and conductor below. Each row links to the venue's event page.

### Filters

Top bar with:
- **City** dropdown (populated from cities table)
- **Venue** dropdown (populated from venues table, filtered by selected city)
- **Date range** presets: Next 7 / 14 / 30 / 90 days
- **Search** input: filters across title, conductor, cast, venue name, location — as-you-type

All filtering is client-side. The full dataset is embedded in the page.

### URL state

Filters reflected in query params: `?venue=staatsoper-stuttgart&days=14&q=mozart`. On page load, filters are initialized from URL params. Shareable links.

### Visual style

Use the **frontend-design skill** during implementation to achieve a polished, distinctive look. Design direction:

- Dark background with warm off-white text
- Serif headings, sans-serif body
- Gold accent color for date headers and interactive states
- Minimal borders, subtle row separators
- No images — typography and spacing only
- **Header**: "Erda" in serif, short tagline
- **Footer**: Last updated timestamp (from `data_age`), event count per venue

## Client-side behavior

- Vanilla JS (no framework) — Astro's `<script>` tag
- Event data embedded as `<script type="application/json" id="event-data">` in the HTML
- On filter/search change: re-filter the JSON array, re-render the grouped list, update URL params
- Debounce search input (200ms)
- Show "No events found" when filters produce empty results
- Show total event count in the filter bar

## Build & deploy

- `web/package.json` has `astro` as a dependency
- `npm run build` in `web/` produces static files in `web/dist/`
- Docker build installs both root and web dependencies
- Rebuild triggered automatically after each scrape cycle
