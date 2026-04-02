# Erda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a remote MCP server that scrapes classical music / opera schedules from two Stuttgart venues and serves them via three MCP tools.

**Architecture:** Single Node.js process runs a native HTTP server (MCP Streamable HTTP transport) and a `node-cron` scheduler. Each daily scrape upserts events into SQLite. The three MCP tools (`list_cities`, `list_venues`, `get_events`) query SQLite synchronously and return JSON.

**Tech Stack:** Node.js 22, TypeScript, `@modelcontextprotocol/sdk`, `better-sqlite3`, `cheerio`, `node-cron`, `vitest`, Docker.

---

## File Map

| File | Purpose |
|---|---|
| `src/types.ts` | Shared `City`, `Venue`, `Event` interfaces |
| `src/db.ts` | SQLite schema init, seed data, all query functions |
| `src/scrapers/base.ts` | `Scraper` interface + `generateEventId()` |
| `src/scrapers/philharmoniker-stuttgart.ts` | Scraper for Stuttgarter Philharmoniker |
| `src/scrapers/staatsoper-stuttgart.ts` | Scraper for Staatsoper Stuttgart |
| `src/scrapers/__fixtures__/philharmoniker-stuttgart.html` | Saved HTML snapshot for tests |
| `src/scrapers/__fixtures__/staatsoper-stuttgart.html` | Saved HTML snapshot for tests |
| `src/scrapers/__tests__/philharmoniker-stuttgart.test.ts` | Scraper unit tests |
| `src/scrapers/__tests__/staatsoper-stuttgart.test.ts` | Scraper unit tests |
| `src/scheduler.ts` | `node-cron` orchestration, structured logging |
| `src/server.ts` | `McpServer` with 3 tools + Node.js HTTP server |
| `src/index.ts` | Entry point: init DB, start HTTP server + scheduler |
| `Dockerfile` | Multi-stage build |
| `docker-compose.yml` | Already exists — Traefik-wired deployment |
| `package.json` | Dependencies and scripts |
| `tsconfig.json` | TypeScript config |
| `vitest.config.ts` | Vitest config |

---

## Task 1: Project setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "erda",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "better-sqlite3": "^11.0.0",
    "cheerio": "^1.0.0",
    "node-cron": "^3.0.3",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.11",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Install dependencies and create data dir**

```bash
npm install
mkdir -p data src/scrapers/__fixtures__ src/scrapers/__tests__
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Init git and commit**

```bash
git init
printf 'node_modules/\ndist/\ndata/\n' > .gitignore
git add .
git commit -m "chore: initial project setup"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write src/types.ts**

```typescript
export interface City {
  id: string;      // "stuttgart"
  name: string;    // "Stuttgart"
  country: string; // "DE"
}

export interface Venue {
  id: string;
  name: string;
  city_id: string;
  url: string;
  last_scraped: string | null;
}

export interface Event {
  id: string;
  venue_id: string;
  title: string;
  date: string;        // "YYYY-MM-DD"
  time: string | null; // "HH:MM"
  conductor: string | null;
  cast: string[] | null;
  url: string | null;
  scraped_at: string;  // ISO 8601
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types"
```

---

## Task 3: Database layer

**Files:**
- Create: `src/db.ts`

- [ ] **Step 1: Write src/db.ts**

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { City, Venue, Event } from './types.js';

const DB_PATH =
  process.env.DB_PATH ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'erda.db');

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cities (
      id      TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      country TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS venues (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      city_id      TEXT NOT NULL REFERENCES cities(id),
      url          TEXT NOT NULL,
      last_scraped TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id         TEXT PRIMARY KEY,
      venue_id   TEXT NOT NULL REFERENCES venues(id),
      title      TEXT NOT NULL,
      date       TEXT NOT NULL,
      time       TEXT,
      conductor  TEXT,
      cast       TEXT,
      url        TEXT,
      scraped_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS events_venue_date ON events(venue_id, date);
  `);

  seedStaticData(db);
}

function seedStaticData(db: Database.Database): void {
  db.prepare(
    `INSERT OR IGNORE INTO cities (id, name, country) VALUES (?, ?, ?)`
  ).run('stuttgart', 'Stuttgart', 'DE');

  const ins = db.prepare(
    `INSERT OR IGNORE INTO venues (id, name, city_id, url) VALUES (?, ?, ?, ?)`
  );
  ins.run('staatsoper-stuttgart', 'Staatsoper Stuttgart', 'stuttgart',
    'https://www.oper-stuttgart.de/spielplan/');
  ins.run('philharmoniker-stuttgart', 'Stuttgarter Philharmoniker', 'stuttgart',
    'https://www.stuttgarter-philharmoniker.de/konzerte/');
}

// ── Query helpers ──────────────────────────────────────────────────────────────

export function getCities(): Array<City & { venue_count: number }> {
  return getDb().prepare(`
    SELECT c.id, c.name, c.country, COUNT(v.id) AS venue_count
    FROM cities c
    LEFT JOIN venues v ON v.city_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `).all() as Array<City & { venue_count: number }>;
}

export function getVenues(
  cityId?: string,
): Array<Venue & { city_name: string; country: string }> {
  const db = getDb();
  if (cityId) {
    return db.prepare(`
      SELECT v.*, c.name AS city_name, c.country
      FROM venues v JOIN cities c ON c.id = v.city_id
      WHERE v.city_id = ?
      ORDER BY v.name
    `).all(cityId) as Array<Venue & { city_name: string; country: string }>;
  }
  return db.prepare(`
    SELECT v.*, c.name AS city_name, c.country
    FROM venues v JOIN cities c ON c.id = v.city_id
    ORDER BY v.name
  `).all() as Array<Venue & { city_name: string; country: string }>;
}

export function getEvents(opts: {
  cityId?: string;
  venueId?: string;
  daysAhead: number;
}): Array<Event & { venue_name: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + opts.daysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let sql = `
    SELECT e.*, v.name AS venue_name
    FROM events e
    JOIN venues v ON v.id = e.venue_id
    WHERE e.date >= ? AND e.date <= ?
  `;
  const params: unknown[] = [today, until];

  if (opts.venueId) {
    sql += ' AND e.venue_id = ?';
    params.push(opts.venueId);
  } else if (opts.cityId) {
    sql += ' AND v.city_id = ?';
    params.push(opts.cityId);
  }

  sql += " ORDER BY e.date, COALESCE(e.time, '')";

  return getDb().prepare(sql).all(...params) as Array<Event & { venue_name: string }>;
}

export function upsertEvents(events: Event[]): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO events
      (id, venue_id, title, date, time, conductor, cast, url, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  getDb().transaction((evts: Event[]) => {
    for (const e of evts) {
      stmt.run(
        e.id, e.venue_id, e.title, e.date, e.time,
        e.conductor,
        e.cast ? JSON.stringify(e.cast) : null,
        e.url, e.scraped_at,
      );
    }
  })(events);
}

export function updateLastScraped(venueId: string, ts: string): void {
  getDb()
    .prepare(`UPDATE venues SET last_scraped = ? WHERE id = ?`)
    .run(ts, venueId);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db.ts
git commit -m "feat: add SQLite database layer with schema and query helpers"
```

---

## Task 4: Scraper base

**Files:**
- Create: `src/scrapers/base.ts`

- [ ] **Step 1: Write src/scrapers/base.ts**

```typescript
import { createHash } from 'node:crypto';
import type { Event } from '../types.js';

export interface Scraper {
  readonly venueId: string;
  scrape(): Promise<Event[]>;
}

/**
 * Derives a stable 16-char hex ID from venue + date + time + title.
 * Stable across scrape runs so upsert works correctly.
 */
export function generateEventId(
  venueId: string,
  date: string,
  time: string | null,
  title: string,
): string {
  const key = `${venueId}:${date}:${time ?? ''}:${title.toLowerCase().trim()}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scrapers/base.ts
git commit -m "feat: add scraper interface and stable event ID generator"
```

---

## Task 5: Stuttgarter Philharmoniker scraper

**Files:**
- Create: `src/scrapers/__fixtures__/philharmoniker-stuttgart.html`
- Create: `src/scrapers/__tests__/philharmoniker-stuttgart.test.ts`
- Create: `src/scrapers/philharmoniker-stuttgart.ts`

- [ ] **Step 1: Fetch and save the HTML fixture**

```bash
curl -s \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml" \
  -H "Accept-Language: de-DE,de;q=0.9" \
  "https://www.stuttgarter-philharmoniker.de/konzerte/" \
  -o src/scrapers/__fixtures__/philharmoniker-stuttgart.html

wc -c src/scrapers/__fixtures__/philharmoniker-stuttgart.html
```

Expected: File is at least 20 KB. If it's tiny, the site may have bot protection — retry with a delay or a different IP.

- [ ] **Step 2: Inspect the fixture and identify selectors**

Open `src/scrapers/__fixtures__/philharmoniker-stuttgart.html` in an editor or browser and find:

1. The CSS class on each concert block (search for "Freitag" or a date like "10.04." to locate one)
2. The element containing the date string (format: `DD.MM. – Weekday`)
3. The element containing the time string (format: `HH:MM`)
4. The `<a>` tag with the concert title (its `href` points to something like `/konzerte/1234.html`)
5. Any element with composer/conductor info

Write down your findings — you'll use them in Step 5.

- [ ] **Step 3: Write the failing test**

```typescript
// src/scrapers/__tests__/philharmoniker-stuttgart.test.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { PhilharmonikerStuttgartScraper } from '../philharmoniker-stuttgart.js';

const fixtureHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/philharmoniker-stuttgart.html'),
  'utf8',
);

describe('PhilharmonikerStuttgartScraper', () => {
  it('parses at least one event from fixture', async () => {
    const scraper = new PhilharmonikerStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('returns events with required fields', async () => {
    const scraper = new PhilharmonikerStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const [event] = await scraper.scrape();
    expect(event.venue_id).toBe('philharmoniker-stuttgart');
    expect(event.title).toBeTruthy();
    expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(event.id).toHaveLength(16);
  });

  it('generates stable IDs across multiple parses', async () => {
    const scraper = new PhilharmonikerStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const [a] = await scraper.scrape();
    const [b] = await scraper.scrape();
    expect(a.id).toBe(b.id);
  });
});
```

- [ ] **Step 4: Run test to confirm it fails**

```bash
npm test -- philharmoniker
```

Expected: FAIL with "Cannot find module '../philharmoniker-stuttgart.js'"

- [ ] **Step 5: Implement the scraper**

The selectors below match the typical structure found on the site (date "DD.MM. – Weekday", time "HH:MM", title link). **Verify them against your fixture from Step 2 and adjust as needed.**

```typescript
// src/scrapers/philharmoniker-stuttgart.ts
import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId } from './base.js';

type FetchHtml = () => Promise<string>;

const SCHEDULE_URL = 'https://www.stuttgarter-philharmoniker.de/konzerte/';
const BASE_URL = 'https://www.stuttgarter-philharmoniker.de';

export class PhilharmonikerStuttgartScraper {
  readonly venueId = 'philharmoniker-stuttgart';

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    const html = this.opts.fetchHtml
      ? await this.opts.fetchHtml()
      : await fetch(SCHEDULE_URL).then((r) => r.text());
    return this.parse(html);
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    // Selector: adjust to match actual fixture (search for class names around a date string)
    $('[class*="konzert"], [class*="concert"], [class*="event-item"], article').each((_, el) => {
      try {
        const rawDate = $(el).find('[class*="date"], [class*="datum"], time').first().text().trim();
        const rawTime = $(el).find('[class*="time"], [class*="zeit"], [class*="uhr"]').first().text().trim();
        const titleEl = $(el).find('a[href*=".html"], h2 > a, h3 > a, .title a').first();
        const title = titleEl.text().trim();
        const href = titleEl.attr('href') ?? '';

        if (!title || !rawDate) return;

        const date = parseDate(rawDate, currentYear);
        if (!date) return;

        const time = parseTime(rawTime);
        const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor: null,
          cast: null,
          url: href ? url : null,
          scraped_at: now,
        });
      } catch {
        // skip malformed entries silently
      }
    });

    return events;
  }
}

// "10.04. – Freitag" or "10.04.2026" → "2026-04-10"
function parseDate(raw: string, currentYear: number): string | null {
  // Try DD.MM.YYYY
  let m = raw.match(/(\d{1,2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1].padStart(2, '0')}`;
  // Try DD.MM. (infer year — if month already passed this year, use next year)
  m = raw.match(/(\d{1,2})\.(\d{2})\./);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = m[2];
  const year =
    parseInt(month, 10) < new Date().getMonth() + 1 ? currentYear + 1 : currentYear;
  return `${year}-${month}-${day}`;
}

// "19:30", "19.30 Uhr" → "19:30"
function parseTime(raw: string): string | null {
  const m = raw.match(/(\d{2})[.:](\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- philharmoniker
```

Expected: 3 tests PASS. If they fail, look at what `events.length` actually is and trace back to the selector in `parse()`.

- [ ] **Step 7: Commit**

```bash
git add src/scrapers/__fixtures__/philharmoniker-stuttgart.html \
        src/scrapers/__tests__/philharmoniker-stuttgart.test.ts \
        src/scrapers/philharmoniker-stuttgart.ts
git commit -m "feat: add Stuttgarter Philharmoniker scraper with fixture tests"
```

---

## Task 6: Staatsoper Stuttgart scraper

**Files:**
- Create: `src/scrapers/__fixtures__/staatsoper-stuttgart.html`
- Create: `src/scrapers/__tests__/staatsoper-stuttgart.test.ts`
- Create: `src/scrapers/staatsoper-stuttgart.ts`

- [ ] **Step 1: Fetch and save the HTML fixture**

```bash
curl -s \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml" \
  -H "Accept-Language: de-DE,de;q=0.9" \
  "https://www.oper-stuttgart.de/spielplan/" \
  -o src/scrapers/__fixtures__/staatsoper-stuttgart.html

wc -c src/scrapers/__fixtures__/staatsoper-stuttgart.html
```

Expected: File is at least 30 KB with real HTML content.

**If the file is tiny or blank (bot protection):** The site may require JavaScript rendering. In that case, install Playwright and use it to render the page:

```bash
npm install -D playwright
npx playwright install chromium --with-deps
node --input-type=module <<'EOF'
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://www.oper-stuttgart.de/spielplan/');
await page.waitForLoadState('networkidle');
const html = await page.content();
await browser.close();
import { writeFileSync } from 'fs';
writeFileSync('src/scrapers/__fixtures__/staatsoper-stuttgart.html', html);
console.log('saved', html.length, 'bytes');
EOF
```

If Playwright is needed for production scraping (not just fixture generation), see the Playwright note at the end of Step 5.

- [ ] **Step 2: Inspect the fixture and identify selectors**

Open `src/scrapers/__fixtures__/staatsoper-stuttgart.html`. Search for a known opera title or a date pattern to locate event blocks. Identify:

1. The CSS class on each event container
2. The date element (may include day-of-week + date or just "DD.MM.YYYY")
3. The time element
4. The title/production name element and its link `href`
5. Any conductor or cast elements

Note these for Step 5.

- [ ] **Step 3: Write the failing test**

```typescript
// src/scrapers/__tests__/staatsoper-stuttgart.test.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { StaatsoperStuttgartScraper } from '../staatsoper-stuttgart.js';

const fixtureHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/staatsoper-stuttgart.html'),
  'utf8',
);

describe('StaatsoperStuttgartScraper', () => {
  it('parses at least one event from fixture', async () => {
    const scraper = new StaatsoperStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('returns events with required fields', async () => {
    const scraper = new StaatsoperStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const [event] = await scraper.scrape();
    expect(event.venue_id).toBe('staatsoper-stuttgart');
    expect(event.title).toBeTruthy();
    expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(event.id).toHaveLength(16);
  });

  it('generates stable IDs across multiple parses', async () => {
    const scraper = new StaatsoperStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const [a] = await scraper.scrape();
    const [b] = await scraper.scrape();
    expect(a.id).toBe(b.id);
  });
});
```

- [ ] **Step 4: Run test to confirm it fails**

```bash
npm test -- staatsoper
```

Expected: FAIL with "Cannot find module '../staatsoper-stuttgart.js'"

- [ ] **Step 5: Implement the scraper**

The selectors below are starting points based on typical German opera house sites. **Verify and adjust them against your fixture from Step 2.**

```typescript
// src/scrapers/staatsoper-stuttgart.ts
import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId } from './base.js';

type FetchHtml = () => Promise<string>;

const SCHEDULE_URL = 'https://www.oper-stuttgart.de/spielplan/';
const BASE_URL = 'https://www.oper-stuttgart.de';

export class StaatsoperStuttgartScraper {
  readonly venueId = 'staatsoper-stuttgart';

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    const html = this.opts.fetchHtml
      ? await this.opts.fetchHtml()
      : await fetch(SCHEDULE_URL).then((r) => r.text());
    return this.parse(html);
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    // Selector: adjust to match the actual fixture structure
    $('[class*="production"], [class*="spielplan"] li, [class*="vorstellung"], article').each(
      (_, el) => {
        try {
          const rawDate = $(el)
            .find('[class*="date"], [class*="datum"], time')
            .first()
            .text()
            .trim();
          const rawTime = $(el)
            .find('[class*="time"], [class*="uhrzeit"], [class*="beginn"]')
            .first()
            .text()
            .trim();
          const titleEl = $(el)
            .find('[class*="title"] a, [class*="titel"] a, h2 a, h3 a')
            .first();
          const title =
            titleEl.text().trim() ||
            $(el).find('[class*="title"], [class*="titel"]').first().text().trim();
          const href = titleEl.attr('href') ?? '';
          const conductor =
            $(el)
              .find('[class*="conductor"], [class*="dirigent"]')
              .first()
              .text()
              .trim() || null;

          if (!title || !rawDate) return;

          const date = parseDate(rawDate, currentYear);
          if (!date) return;

          const time = parseTime(rawTime);
          const url = href
            ? href.startsWith('http')
              ? href
              : `${BASE_URL}${href}`
            : null;

          events.push({
            id: generateEventId(this.venueId, date, time, title),
            venue_id: this.venueId,
            title,
            date,
            time,
            conductor,
            cast: null,
            url,
            scraped_at: now,
          });
        } catch {
          // skip malformed entries silently
        }
      },
    );

    return events;
  }
}

// Handles "15.04.2026", "Di 15.04.", "15.04. 19:30", "Dienstag, 15. April 2026"
function parseDate(raw: string, currentYear: number): string | null {
  // Try DD.MM.YYYY
  let m = raw.match(/(\d{1,2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1].padStart(2, '0')}`;
  // Try DD.MM.
  m = raw.match(/(\d{1,2})\.(\d{2})\./);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = m[2];
  const year =
    parseInt(month, 10) < new Date().getMonth() + 1 ? currentYear + 1 : currentYear;
  return `${year}-${month}-${day}`;
}

// "19:30", "19.30 Uhr" → "19:30"
function parseTime(raw: string): string | null {
  const m = raw.match(/(\d{2})[.:](\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}
```

**Note — if the site requires Playwright at runtime** (JS-rendered content), add this to `package.json` dependencies:
```json
"playwright": "^1.48.0"
```
Then replace the `fetch()` call in `scrape()` with:
```typescript
import { chromium } from 'playwright';
// ...
async scrape(): Promise<Event[]> {
  if (this.opts.fetchHtml) return this.parse(await this.opts.fetchHtml());
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(SCHEDULE_URL);
  await page.waitForLoadState('networkidle');
  const html = await page.content();
  await browser.close();
  return this.parse(html);
}
```
And add `npx playwright install chromium --with-deps` to the Dockerfile before the runtime stage.

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: 6 tests PASS across both scraper test files.

- [ ] **Step 7: Commit**

```bash
git add src/scrapers/__fixtures__/staatsoper-stuttgart.html \
        src/scrapers/__tests__/staatsoper-stuttgart.test.ts \
        src/scrapers/staatsoper-stuttgart.ts
git commit -m "feat: add Staatsoper Stuttgart scraper with fixture tests"
```

---

## Task 7: Scheduler

**Files:**
- Create: `src/scheduler.ts`

- [ ] **Step 1: Write src/scheduler.ts**

```typescript
import cron from 'node-cron';
import { upsertEvents, updateLastScraped } from './db.js';
import type { Scraper } from './scrapers/base.js';
import { PhilharmonikerStuttgartScraper } from './scrapers/philharmoniker-stuttgart.js';
import { StaatsoperStuttgartScraper } from './scrapers/staatsoper-stuttgart.js';

const scrapers: Scraper[] = [
  new PhilharmonikerStuttgartScraper(),
  new StaatsoperStuttgartScraper(),
];

export async function runAllScrapers(): Promise<void> {
  for (const scraper of scrapers) {
    const start = Date.now();
    console.log(JSON.stringify({ event: 'scrape_start', venue: scraper.venueId }));
    try {
      const events = await scraper.scrape();
      upsertEvents(events);
      const ts = new Date().toISOString();
      updateLastScraped(scraper.venueId, ts);
      console.log(
        JSON.stringify({
          event: 'scrape_success',
          venue: scraper.venueId,
          count: events.length,
          duration_ms: Date.now() - start,
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'scrape_error',
          venue: scraper.venueId,
          error: String(err),
          duration_ms: Date.now() - start,
        }),
      );
    }
  }
}

export function startScheduler(): void {
  const expr = process.env.SCRAPE_CRON ?? '0 3 * * *';
  console.log(JSON.stringify({ event: 'scheduler_start', cron: expr }));
  cron.schedule(expr, () => {
    runAllScrapers().catch(console.error);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scheduler.ts
git commit -m "feat: add daily scraper scheduler with structured JSON logging"
```

---

## Task 8: MCP server

**Files:**
- Create: `src/server.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Write src/server.ts**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { getCities, getVenues, getEvents } from './db.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'erda', version: '1.0.0' });

  server.tool(
    'list_cities',
    'List all cities that have classical music or opera venues in the database.',
    {},
    async () => {
      const cities = getCities();
      return {
        content: [{ type: 'text', text: JSON.stringify({ cities }) }],
      };
    },
  );

  server.tool(
    'list_venues',
    'List all classical music and opera venues. Optionally filter by city name.',
    {
      city: z
        .string()
        .optional()
        .describe('City name to filter by, e.g. "Stuttgart"'),
    },
    async ({ city }) => {
      const venues = getVenues(city?.toLowerCase()).map((v) => ({
        id: v.id,
        name: v.name,
        city: v.city_name,
        country: v.country,
        last_scraped: v.last_scraped,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify({ venues }) }],
      };
    },
  );

  server.tool(
    'get_events',
    'Get upcoming classical music and opera events. Filter by city or venue. Returns data_age so the caller knows how fresh the data is.',
    {
      city: z.string().optional().describe('City name, e.g. "Stuttgart"'),
      venue_id: z
        .string()
        .optional()
        .describe('Venue ID, e.g. "staatsoper-stuttgart"'),
      days_ahead: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe('How many days ahead to look (default: 30, max: 90)'),
    },
    async ({ city, venue_id, days_ahead }) => {
      const rows = getEvents({
        cityId: city?.toLowerCase(),
        venueId: venue_id,
        daysAhead: days_ahead ?? 30,
      });

      // Build data_age from venues touched by this query
      const venueRows = getVenues(city?.toLowerCase());
      const data_age: Record<string, string> = {};
      for (const v of venueRows) {
        if (v.last_scraped) data_age[v.id] = v.last_scraped;
      }

      const events = rows.map((e) => ({
        id: e.id,
        venue_id: e.venue_id,
        venue_name: e.venue_name,
        title: e.title,
        date: e.date,
        time: e.time,
        ...(e.conductor ? { conductor: e.conductor } : {}),
        ...(e.cast ? { cast: JSON.parse(e.cast as unknown as string) } : {}),
        url: e.url,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ events, data_age }) }],
      };
    },
  );

  return server;
}

export function startHttpServer(mcpServer: McpServer): void {
  const port = Number(process.env.PORT ?? 3000);

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/mcp') {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.writeHead(404).end();
    },
  );

  httpServer.listen(port, () => {
    console.log(JSON.stringify({ event: 'server_start', port }));
  });
}
```

- [ ] **Step 2: Write src/index.ts**

```typescript
import { getDb } from './db.js';
import { createMcpServer, startHttpServer } from './server.js';
import { startScheduler, runAllScrapers } from './scheduler.js';

// Initialize DB — creates schema and seeds cities/venues
const db = getDb();

const mcpServer = createMcpServer();
startHttpServer(mcpServer);
startScheduler();

// On first run (empty events table), scrape immediately rather than waiting for 03:00
const { count } = db
  .prepare('SELECT COUNT(*) AS count FROM events')
  .get() as { count: number };

if (count === 0) {
  console.log(JSON.stringify({ event: 'initial_scrape_triggered' }));
  runAllScrapers().catch(console.error);
}
```

- [ ] **Step 3: Verify TypeScript compiles without errors**

```bash
npm run build
```

Expected: `dist/` created, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "feat: add MCP server with list_cities, list_venues, get_events tools"
```

---

## Task 9: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Write Dockerfile**

```dockerfile
# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p data
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build the Docker image**

```bash
docker build -t erda .
```

Expected: Build completes, exit code 0.

- [ ] **Step 3: Smoke-test the container**

```bash
docker run --rm -d --name erda-test -p 3000:3000 erda
sleep 3
curl -s http://localhost:3000/health
docker stop erda-test
```

Expected output from curl: `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile"
```

---

## Task 10: End-to-end smoke test

- [ ] **Step 1: Start server locally**

```bash
DB_PATH=./data/test.db npm run dev
```

Wait for both log lines:
- `{"event":"server_start","port":3000}`
- `{"event":"initial_scrape_triggered"}`
- `{"event":"scrape_success","venue":"philharmoniker-stuttgart",...}`
- `{"event":"scrape_success","venue":"staatsoper-stuttgart",...}`

- [ ] **Step 2: Call list_cities**

In a second terminal:

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_cities","arguments":{}},"id":1}'
```

Expected: response contains `"Stuttgart"` in the cities array.

- [ ] **Step 3: Call get_events**

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_events","arguments":{"city":"Stuttgart","days_ahead":60}},"id":2}'
```

Expected: valid JSON with `events` array and `data_age` map. Events may be empty if the fixture data is outside the 60-day window, but there must be no error.

- [ ] **Step 4: Final commit**

```bash
rm data/test.db
git add docs/
git commit -m "docs: add spec and implementation plan"
```

---

## Notes

- **Selector debugging:** If a scraper returns 0 events, add a `console.log($('body').text().slice(0, 500))` inside `parse()` to verify the fixture loaded, then narrow down the selector using the browser DevTools on the live site.
- **Year rollover:** Both `parseDate` implementations handle the Dec→Jan rollover by comparing the parsed month against the current month.
- **Fixture refresh:** When a venue changes their site layout and scraper breaks in production, run the `curl` command from the relevant scraper task again, update the fixture file, fix the selectors, run `npm test` to confirm, and commit.
- **Adding a new venue:** Create a new scraper in `src/scrapers/`, add a seed row to `seedStaticData()` in `db.ts`, and register the scraper in the `scrapers` array in `scheduler.ts`.
