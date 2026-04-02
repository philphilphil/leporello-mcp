# Contribute a Venue-Scraper

> **This section is written for coding agents.** Follow these instructions exactly to add a new venue scraper.

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

Rules:
- All 9 `Event` fields must be set (`null` is fine for optional ones)
- Use `generateEventId(venueId, date, time, title)` — never invent IDs
- Use `new URL(href, BASE_URL + '/').href` for absolute URLs
- Silently skip malformed entries with try/catch per element
- Throw on non-2xx HTTP (the scheduler catches and logs it)
- Use the venue's native-language pages when available (e.g. `/de/spielplan/` instead of `/en/schedule/`) to get original, untranslated event titles

## 2. Save an HTML fixture

```bash
curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  <schedule-url> -o src/scrapers/__fixtures__/<venue-id>.html
```

If curl is blocked (403/empty), use Playwright:

```typescript
// fetch-fixture.ts (run once, then delete)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('<schedule-url>');
writeFileSync('src/scrapers/__fixtures__/<venue-id>.html', await page.content());
await browser.close();
```

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

const fixture = readFileSync(new URL('../__fixtures__/<venue-id>.html', import.meta.url), 'utf8');
const scraper = new MyVenueScraper({ fetchHtml: async () => fixture });

describe('MyVenueScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  // Add venue-specific tests here (e.g. conductor/cast parsing)
});
```

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
npm test               # all tests must pass
npm run scrape         # live scrape, check output for scrape_success
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
