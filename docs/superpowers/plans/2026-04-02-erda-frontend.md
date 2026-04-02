# Erda Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static Astro frontend that lists upcoming classical music events with client-side filtering and search, rebuilt automatically after each scrape.

**Architecture:** Astro subproject in `web/` reads the SQLite DB at build time via `better-sqlite3`, embeds all event data as JSON in a single page. Client-side vanilla JS handles filtering/search. The existing Node server serves the built static files.

**Tech Stack:** Astro, TypeScript, better-sqlite3, vanilla JS (client-side)

**Spec:** `docs/superpowers/specs/2026-04-02-erda-frontend-design.md`

---

### Task 1: Scaffold the Astro project

**Files:**
- Create: `web/package.json`
- Create: `web/astro.config.ts`
- Create: `web/tsconfig.json`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "erda-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^5.0.0",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict"
}
```

- [ ] **Step 3: Create `web/astro.config.ts`**

```ts
import { defineConfig } from 'astro/config';

export default defineConfig({
  outDir: 'dist',
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install --prefix web`
Expected: `node_modules/` created in `web/`, lockfile generated.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/tsconfig.json web/astro.config.ts web/package-lock.json
git commit -m "feat(web): scaffold Astro project"
```

---

### Task 2: Data layer — read SQLite at build time

**Files:**
- Create: `web/src/lib/data.ts`

- [ ] **Step 1: Create `web/src/lib/data.ts`**

This module opens the SQLite DB read-only and exports functions to query events, venues, and cities. It does NOT import from `src/db.ts` — that has schema init, seeding, and singleton logic.

```ts
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH =
  process.env.DB_PATH ??
  path.join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'data', 'erda.db');

function openDb(): Database.Database {
  return new Database(DB_PATH, { readonly: true });
}

export interface City {
  id: string;
  name: string;
  country: string;
  venue_count: number;
}

export interface Venue {
  id: string;
  name: string;
  city_id: string;
  city_name: string;
  country: string;
  last_scraped: string | null;
}

export interface Event {
  id: string;
  venue_id: string;
  venue_name: string;
  title: string;
  date: string;
  time: string | null;
  conductor: string | null;
  cast: string[] | null;
  location: string | null;
  url: string | null;
}

export function getCities(): City[] {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT c.id, c.name, c.country, COUNT(v.id) AS venue_count
      FROM cities c
      LEFT JOIN venues v ON v.city_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `).all() as City[];
  } finally {
    db.close();
  }
}

export function getVenues(): Venue[] {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT v.id, v.name, v.city_id, c.name AS city_name, c.country, v.last_scraped
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      ORDER BY v.name
    `).all() as Venue[];
  } finally {
    db.close();
  }
}

export function getEvents(daysAhead: number = 90): Event[] {
  const db = openDb();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date();
    until.setDate(until.getDate() + daysAhead);
    const untilStr = until.toISOString().slice(0, 10);

    const rows = db.prepare(`
      SELECT e.id, e.venue_id, v.name AS venue_name,
             e.title, e.date, e.time, e.conductor, e.cast, e.location, e.url
      FROM events e
      JOIN venues v ON v.id = e.venue_id
      WHERE e.date >= ? AND e.date <= ?
      ORDER BY e.date, COALESCE(e.time, '')
    `).all(today, untilStr) as Array<Event & { cast: string | null }>;

    return rows.map((r) => ({
      ...r,
      cast: typeof r.cast === 'string' ? JSON.parse(r.cast) : null,
    }));
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npx astro check 2>&1 || true && cd ..`

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/data.ts
git commit -m "feat(web): add build-time data layer for SQLite queries"
```

---

### Task 3: Base layout and index page with embedded data

**Files:**
- Create: `web/src/layouts/Base.astro`
- Create: `web/src/pages/index.astro`

- [ ] **Step 1: Create `web/src/layouts/Base.astro`**

```astro
---
interface Props {
  title: string;
}
const { title } = Astro.props;
---
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</head>
<body>
  <slot />
</body>
</html>
```

- [ ] **Step 2: Create `web/src/pages/index.astro`**

This page fetches all data at build time and embeds it as JSON. The HTML structure will be fleshed out in later tasks — for now, just verify the data pipeline works.

```astro
---
import Base from '../layouts/Base.astro';
import { getCities, getVenues, getEvents } from '../lib/data.ts';

const cities = getCities();
const venues = getVenues();
const events = getEvents(90);
const dataAge: Record<string, string | null> = {};
for (const v of venues) {
  if (v.last_scraped) dataAge[v.id] = v.last_scraped;
}

const pageData = { cities, venues, events, dataAge };
---
<Base title="Erda — Classical Music Events">
  <script type="application/json" id="event-data" set:html={JSON.stringify(pageData)} />
  <main id="app">
    <p>Loaded {events.length} events from {venues.length} venues.</p>
  </main>
</Base>
```

- [ ] **Step 3: Test the build**

Run: `npm run build --prefix web`
Expected: Build succeeds, `web/dist/index.html` contains the JSON blob and the event count message.

- [ ] **Step 4: Commit**

```bash
git add web/src/layouts/Base.astro web/src/pages/index.astro
git commit -m "feat(web): add base layout and index page with embedded event data"
```

---

### Task 4: Client-side filtering and search

**Files:**
- Create: `web/src/scripts/filter.ts`

- [ ] **Step 1: Create `web/src/scripts/filter.ts`**

This is the client-side script that reads the embedded JSON, filters it, and renders the event list. It also syncs filter state with URL query params.

```ts
interface Event {
  id: string;
  venue_id: string;
  venue_name: string;
  title: string;
  date: string;
  time: string | null;
  conductor: string | null;
  cast: string[] | null;
  location: string | null;
  url: string | null;
}

interface Venue {
  id: string;
  name: string;
  city_id: string;
  city_name: string;
}

interface City {
  id: string;
  name: string;
}

interface PageData {
  cities: City[];
  venues: Venue[];
  events: Event[];
  dataAge: Record<string, string | null>;
}

const data: PageData = JSON.parse(
  document.getElementById('event-data')!.textContent!
);

const citySelect = document.getElementById('filter-city') as HTMLSelectElement;
const venueSelect = document.getElementById('filter-venue') as HTMLSelectElement;
const daysSelect = document.getElementById('filter-days') as HTMLSelectElement;
const searchInput = document.getElementById('filter-search') as HTMLInputElement;
const eventList = document.getElementById('event-list')!;
const eventCount = document.getElementById('event-count')!;

function initFiltersFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.has('city')) citySelect.value = params.get('city')!;
  if (params.has('venue')) venueSelect.value = params.get('venue')!;
  if (params.has('days')) daysSelect.value = params.get('days')!;
  if (params.has('q')) searchInput.value = params.get('q')!;
}

function updateUrl(): void {
  const params = new URLSearchParams();
  if (citySelect.value) params.set('city', citySelect.value);
  if (venueSelect.value) params.set('venue', venueSelect.value);
  if (daysSelect.value !== '30') params.set('days', daysSelect.value);
  if (searchInput.value) params.set('q', searchInput.value);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

function populateVenueDropdown(): void {
  const city = citySelect.value;
  const currentVenue = venueSelect.value;
  const filtered = city
    ? data.venues.filter((v) => v.city_id === city)
    : data.venues;

  venueSelect.innerHTML = '<option value="">All Venues</option>';
  for (const v of filtered) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    venueSelect.appendChild(opt);
  }

  // Restore selection if still valid
  if (filtered.some((v) => v.id === currentVenue)) {
    venueSelect.value = currentVenue;
  }
}

function filterEvents(): Event[] {
  const city = citySelect.value;
  const venue = venueSelect.value;
  const days = parseInt(daysSelect.value, 10);
  const query = searchInput.value.toLowerCase().trim();

  const today = new Date();
  const until = new Date();
  until.setDate(today.getDate() + days);
  const todayStr = today.toISOString().slice(0, 10);
  const untilStr = until.toISOString().slice(0, 10);

  return data.events.filter((e) => {
    if (e.date < todayStr || e.date > untilStr) return false;
    if (venue && e.venue_id !== venue) return false;
    if (city && !venue) {
      const v = data.venues.find((v) => v.id === e.venue_id);
      if (v && v.city_id !== city) return false;
    }
    if (query) {
      const haystack = [
        e.title,
        e.venue_name,
        e.conductor,
        e.location,
        ...(e.cast ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function render(): void {
  const events = filterEvents();
  updateUrl();

  eventCount.textContent = `${events.length} event${events.length !== 1 ? 's' : ''}`;

  if (events.length === 0) {
    eventList.innerHTML = '<p class="no-results">No events found</p>';
    return;
  }

  // Group by date
  const groups = new Map<string, Event[]>();
  for (const e of events) {
    const list = groups.get(e.date) ?? [];
    list.push(e);
    groups.set(e.date, list);
  }

  let html = '';
  for (const [date, evts] of groups) {
    html += `<div class="date-group">`;
    html += `<h3 class="date-header">${formatDate(date)}</h3>`;
    for (const e of evts) {
      const time = e.time ?? '';
      const details = [e.venue_name, e.conductor].filter(Boolean).join(' · ');
      const tag = e.url ? 'a' : 'div';
      const href = e.url ? ` href="${e.url}" target="_blank" rel="noopener"` : '';
      html += `<${tag} class="event-row"${href}>`;
      html += `<span class="event-time">${time}</span>`;
      html += `<div class="event-info">`;
      html += `<span class="event-title">${e.title}</span>`;
      html += `<span class="event-details">${details}</span>`;
      html += `</div>`;
      html += `</${tag}>`;
    }
    html += `</div>`;
  }
  eventList.innerHTML = html;
}

// Debounce helper
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// Wire up event listeners
citySelect.addEventListener('change', () => {
  populateVenueDropdown();
  render();
});
venueSelect.addEventListener('change', render);
daysSelect.addEventListener('change', render);
searchInput.addEventListener('input', debounce(render, 200));

// Initialize
populateVenueDropdown();
initFiltersFromUrl();
render();
```

- [ ] **Step 2: Commit**

```bash
git add web/src/scripts/filter.ts
git commit -m "feat(web): add client-side filtering, search, and URL state"
```

---

### Task 5: Full page UI with frontend-design skill

**Files:**
- Modify: `web/src/pages/index.astro`
- Modify: `web/src/layouts/Base.astro`
- Create: `web/src/components/Filters.astro`
- Create: `web/src/components/EventList.astro`
- Create: `web/public/favicon.svg`

This task uses the **frontend-design skill** to create a polished, warm editorial look. The design direction:

- Dark background (`#1a1a1a`-ish) with warm off-white text
- Serif headings (Georgia or similar), sans-serif body
- Gold accent (`#c9a96e`-ish) for date group headers and hover states
- Minimal borders, subtle row separators
- Header: "Erda" in serif with a short tagline
- Footer: last updated timestamp, event count per venue

- [ ] **Step 1: Invoke the `frontend-design` skill**

Use the frontend-design skill to design and implement all the Astro components and CSS listed above. The skill should produce production-grade, visually distinctive UI. Provide it with the full context: the existing `filter.ts` expects elements with specific IDs (`filter-city`, `filter-venue`, `filter-days`, `filter-search`, `event-list`, `event-count`), and the page already has a `<script type="application/json" id="event-data">` blob.

The components should produce HTML that includes:
- A `<select id="filter-city">` with an "All Cities" default option and an `<option>` per city
- A `<select id="filter-venue">` with an "All Venues" default option (populated by JS)
- A `<select id="filter-days">` with options: 7, 14, 30 (default), 90
- An `<input id="filter-search">` with placeholder "Search events..."
- A `<span id="event-count">` for showing the count
- A `<div id="event-list">` where rendered events appear

The page must include `<script>import '../scripts/filter.ts';</script>` to load the client-side logic.

- [ ] **Step 2: Create `web/public/favicon.svg`**

A simple SVG favicon — a lyre, musical note, or the letter "E" in a serif font.

- [ ] **Step 3: Test the build and verify in browser**

Run: `npm run build --prefix web`
Then: `npx --prefix web astro preview`
Expected: Page loads with styled header, filter bar, event list (or "No events found" if DB is empty), and footer.

- [ ] **Step 4: Commit**

```bash
git add web/src/ web/public/
git commit -m "feat(web): add polished UI components with editorial design"
```

---

### Task 6: Static file serving in the Node server

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add static file handler to `src/server.ts`**

Add a handler that serves files from `web/dist/` for any request that doesn't match `/mcp` or `/health`. Use `node:fs` and `node:path` — no extra dependencies.

Add this helper and modify the request handler:

```ts
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const WEB_DIST = join(
  fileURLToPath(import.meta.url), '..', '..', 'web', 'dist'
);

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  // Resolve path and prevent directory traversal
  let filePath = join(WEB_DIST, pathname);
  if (!filePath.startsWith(WEB_DIST)) {
    res.writeHead(403).end();
    return;
  }

  // Try exact file, then append index.html for directories
  try {
    let content: Buffer;
    try {
      content = await readFile(filePath);
    } catch {
      filePath = join(filePath, 'index.html');
      content = await readFile(filePath);
    }

    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }).end(content);
  } catch {
    res.writeHead(404).end();
  }
}
```

Then in the request handler, replace the final `res.writeHead(404).end()` with:

```ts
await serveStatic(req, res, pathname ?? '/');
return;
```

- [ ] **Step 2: Verify the existing tests still pass**

Run: `npm test`
Expected: All 6 tests pass.

- [ ] **Step 3: Test manually**

Run: `npm run dev`
Open `http://localhost:3000/` — should serve the Astro-built page (if `web/dist/` exists from a prior build).

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: serve static frontend from web/dist/"
```

---

### Task 7: Trigger Astro rebuild after scraping

**Files:**
- Modify: `src/scheduler.ts`

- [ ] **Step 1: Add rebuild trigger to `src/scheduler.ts`**

After `runAllScrapers()` completes, spawn `npm run build --prefix web` as a child process. Import `execFile` from `node:child_process` and `promisify` from `node:util`.

Add this function:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function rebuildWeb(): Promise<void> {
  console.log(JSON.stringify({ event: 'web_build_start' }));
  const start = Date.now();
  try {
    await execFileAsync('npm', ['run', 'build', '--prefix', 'web'], {
      cwd: path.join(fileURLToPath(import.meta.url), '..', '..'),
      timeout: 60_000,
    });
    console.log(
      JSON.stringify({ event: 'web_build_success', duration_ms: Date.now() - start })
    );
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'web_build_error', error: String(err), duration_ms: Date.now() - start })
    );
  }
}
```

Add `import path from 'node:path';` and `import { fileURLToPath } from 'node:url';` at the top.

Then at the end of `runAllScrapers()`, add:

```ts
await rebuildWeb();
```

- [ ] **Step 2: Verify the existing tests still pass**

Run: `npm test`
Expected: All 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/scheduler.ts
git commit -m "feat: trigger Astro rebuild after scraping completes"
```

---

### Task 8: Update Dockerfile

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Update `Dockerfile` to include web build**

```dockerfile
# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Web build stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=web-builder /app/web/dist ./web/dist
# Web dependencies needed for rebuild after scrape
COPY web/package*.json ./web/
RUN cd web && npm ci
COPY web/astro.config.ts web/tsconfig.json ./web/
COPY web/src ./web/src
RUN mkdir -p data
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Test Docker build**

Run: `docker build -t erda .`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: update Dockerfile for web build and runtime rebuild"
```

---

### Task 9: Add `.gitignore` entries and final verification

**Files:**
- Modify: `.gitignore` (or create if missing)

- [ ] **Step 1: Add web build artifacts and superpowers dir to `.gitignore`**

Append these lines:

```
web/dist/
web/node_modules/
.superpowers/
```

- [ ] **Step 2: Full end-to-end test**

Run the scraper to populate the DB, then build the frontend, then start the server:

```bash
npm run scrape
npm run build --prefix web
npm run dev
```

Open `http://localhost:3000/` — verify:
- Page loads with header, filter bar, event list
- Events are grouped by date with gold date headers
- City, venue, and date range filters work
- Free text search filters as you type
- URL updates with query params
- Footer shows last updated timestamps

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add gitignore entries for web build artifacts"
```
