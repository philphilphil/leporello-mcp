# Contribute a Venue-Scraper
**This section is written for coding agents.** Follow these instructions exactly to add a new venue scraper.

## 1. Create the scraper

Create `src/scrapers/<venue-id>.ts`. The scraper declares its own metadata — city, country, and URL — which the scheduler uses to automatically register the venue in the database before scraping.

```typescript
import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://example.com';

export class MyVenueScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: '<venue-id>',
    venueName: 'My Venue Name',
    cityId: 'munich',
    cityName: 'Munich',
    country: 'DE',           // ISO 3166-1 alpha-2
    scheduleUrl: 'https://example.com/schedule/',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    const html = this.opts.fetchHtml
      ? await this.opts.fetchHtml()
      : await fetch(this.venue.scheduleUrl, {
          headers: { 'User-Agent': USER_AGENT },
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} from ${this.venue.scheduleUrl}`);
          return r.text();
        });
    return this.parse(html);
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('selector-for-each-event').each((_, el) => {
      try {
        const title = $(el).find('...').text().trim();
        const date = '...';   // "YYYY-MM-DD"
        const time = '...';   // "HH:MM" or null
        const conductor = '...'; // conductor name or null
        const cast = ['...']; // array of performer names or null
        const location = '...'; // physical performance hall, e.g. "Liederhalle", or null
        const href = $(el).find('a').attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null; // link to event detail page or null

        if (!title || !date) return;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor,
          cast,
          location,
          url,
          scraped_at: now,
        });
      } catch {
        // skip malformed entries silently
      }
    });

    return events;
  }
}
```

### Fetching data — three approaches

Choose the right approach based on the venue's site:

**1. Plain `fetch()` (default)** — use when `curl` returns the schedule HTML with event data. This is the simplest and fastest approach. Most scrapers use this.

**2. `fetchRenderedHtml()` (Playwright)** — use when the site is JS-rendered and `curl`/`fetch()` returns empty HTML with no event data. Import the helper from `base.ts`:

```typescript
import { fetchRenderedHtml, type Scraper, type VenueMeta } from './base.js';

// In scrape():
const html = this.opts.fetchHtml
  ? await this.opts.fetchHtml()
  : await fetchRenderedHtml(this.venue.scheduleUrl, {
      waitForSelector: '.event-card',  // CSS selector to wait for before extracting HTML
    });
```

The `waitForSelector` option waits for JS-rendered content to appear in the DOM (up to 15s). Always specify it — without it the page may be captured before events load. See `bayerische-staatsoper.ts` for a working example.

**3. JSON API** — some sites serve schedule data via AJAX/API endpoints (check the browser Network tab). Fetch the JSON directly and parse it — no Cheerio needed for extraction, though the response may contain HTML fragments. See `philharmonie-de-paris.ts` for an example.

**How to decide:** Try `curl -s -A "Mozilla/5.0 ..." <url> | grep <known-event-title>`. If it finds events, use plain `fetch()`. If not, check the Network tab for JSON APIs. If neither works, use `fetchRenderedHtml()`.
```

Rules:
- All 9 `Event` fields must be set (`null` is fine for optional ones)
- Use `generateEventId(venueId, date, time, title)` — never invent IDs
- Use `new URL(href, BASE_URL + '/').href` for absolute URLs
- Silently skip malformed entries with try/catch per element
- Throw on non-2xx HTTP (the scheduler catches and logs it)
- Use the venue's native-language pages when available (e.g. `/de/spielplan/` instead of `/en/schedule/`) to get original, untranslated event titles
- **Event detail URLs:** only set `url` to a confirmed detail page URL found directly in the scraped HTML. Never construct or guess URLs (e.g. from title slugs). If a detail URL cannot be reliably extracted, fall back to `this.venue.scheduleUrl` (the schedule overview page) — never `null` when a fallback exists. Some sites only render a short window of events as clickable links; events outside that window should get the overview URL.

## 2. Save an HTML fixture

**For sites that work with plain fetch:**
```bash
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  <schedule-url> -o src/scrapers/__fixtures__/<venue-id>.html
```

**For JS-rendered sites** (when curl returns empty/no events), use Playwright MCP or a script:
```typescript
// fetch-fixture.ts (run once, then delete)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});
const page = await ctx.newPage();
await page.goto('<schedule-url>');
await page.waitForSelector('<event-selector>');
writeFileSync('src/scrapers/__fixtures__/<venue-id>.html', await page.content());
await browser.close();
```

**For JSON API sites**, save the API response content as the fixture (the HTML fragment or JSON body).

## 3. Verify fixture data is current

**This step is critical.** Run `date +%Y` to get the current year, then inspect the fetched fixture to confirm it contains events dated in the current or next season — not stale/cached data from prior years.

If the fixture only contains past events:
- Try alternative schedule URLs (e.g. append the current season year)
- Use different date filters or query parameters
- Look for "upcoming" or "current season" endpoints
- Check if the venue site requires JavaScript rendering (use Playwright instead of curl)

Do not proceed with writing the scraper until you have a fixture with current data.

## 4. Write tests

Create `src/scrapers/__tests__/<venue-id>.test.ts`. Tests use saved fixtures to verify parsing logic — runtime validation in the scheduler catches live breakage.

```typescript
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { MyVenueScraper } from '../<venue-id>.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/<venue-id>.html', import.meta.url), 'utf8');
const scraper = new MyVenueScraper({ fetchHtml: async () => fixture });

describe('MyVenueScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  // Add venue-specific tests here (e.g. conductor/cast parsing)

  testDbIntegration(scraper);
});
```

The `testDbIntegration` helper checks for duplicate event IDs and inserts all parsed events into an in-memory SQLite database to catch primary key collisions, foreign key violations, and schema mismatches. Always place it **last** in the describe block so parsing tests run first.

## 5. Register the scraper

In `src/scheduler.ts`, add to the `scrapers` array:

```typescript
import { MyVenueScraper } from './scrapers/<venue-id>.js';

const scrapers: Scraper[] = [
  // existing scrapers...
  new MyVenueScraper(),
];
```

## 6. Update the venue list

Add the new venue to the **Supported Venues** table in `README.md`.

## 7. Verify

```bash
npm test                              # all tests must pass
npm run scrape -- <venue-id>          # live scrape for the new venue only
npm run scrape                        # optional: scrape all venues
```

## 8. Open a PR

**IMPORTANT: The PR description MUST include a clickable link to the venue's public schedule page** (the calendar/Spielplan URL the scraper reads from). Reviewers use this to manually verify the scraped output against the real listings.

Example PR description:

```markdown
## Summary
- Add scraper for **Venue Name** (City, CC) — Closes #N
- **Schedule URL:** https://example.com/schedule/
- Brief description of how the scraper works
```
