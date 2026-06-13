import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { MusikvereinWienScraper } from '../musikverein-wien.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixturePage1 = readFileSync(new URL('../__fixtures__/musikverein-wien.html', import.meta.url), 'utf8');
const fixturePage2 = readFileSync(new URL('../__fixtures__/musikverein-wien-page2.html', import.meta.url), 'utf8');

const SCHEDULE_URL = 'https://spielplan.musikverein.at/spielplan';
const EMPTY = '<html><body></body></html>';

// The default /spielplan page is the rolling window; ?month=YYYY-MM pages cover
// later months. Serve page1 for the default URL, page2 for the first month
// page, then an empty page so pagination halts deterministically.
const pages: Record<string, string> = {
  [SCHEDULE_URL]: fixturePage1,
};
// First ?month= page (one month after "now") serves page2; later months empty.
function fetchFor(url: string): string {
  if (pages[url]) return pages[url];
  if (/\?month=/.test(url)) {
    // Serve page2 for exactly the first month page we haven't served yet.
    if (!servedPage2) { servedPage2 = true; return fixturePage2; }
    return EMPTY;
  }
  return EMPTY;
}
let servedPage2 = false;

const scraper = new MusikvereinWienScraper({
  fetchHtml: async (url: string) => fetchFor(url),
});

describe('MusikvereinWienScraper', () => {
  it('parses events from fixture', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date, time, and location', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.time).toMatch(/^\d{2}:\d{2}$/);
    expect(first.location).toBeTruthy();
  });

  it('sets all required Event fields with valid shapes', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('musikverein-wien');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time === null || /^\d{2}:\d{2}$/.test(e.time)).toBe(true);
      expect(e.conductor).toBeNull();
      expect(e.cast === null || Array.isArray(e.cast)).toBe(true);
      expect(e.url === null || e.url.startsWith('https://')).toBe(true);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  it('extracts performers as cast', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    // Wiener Philharmoniker is the resident orchestra; its entries always carry
    // a conductor/soloist in the performers slot.
    const wienerPhil = events.find(e => e.title.includes('Wiener Philharmoniker'));
    expect(wienerPhil).toBeDefined();
    expect(wienerPhil!.cast).not.toBeNull();
    expect(wienerPhil!.cast!.length).toBeGreaterThan(0);
    expect(wienerPhil!.cast!.every(c => typeof c === 'string' && c.length > 0)).toBe(true);
  });

  it('splits multiple performers on the bullet separator', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const multi = events.find(e => e.cast && e.cast.length > 1);
    expect(multi).toBeDefined();
  });

  it('appends composers to title with an em-dash', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const withComposer = events.find(e => e.title.includes(' — '));
    expect(withComposer).toBeDefined();
  });

  it('has absolute musikverein URLs for events', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const event of withUrl) {
      expect(event.url).toMatch(/^https:\/\/musikverein\.at\/konzert\//);
    }
  });

  it('paginates across month pages and dedupes overlaps', async () => {
    servedPage2 = false;
    const bothPages = await scraper.scrape();

    const singlePage = new MusikvereinWienScraper({
      fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
    });
    const onePage = await singlePage.scrape();

    expect(bothPages.length).toBeGreaterThan(onePage.length); // month page added events
    const ids = bothPages.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids across pages
  });

  it('deduplicates when the same window repeats across pages', async () => {
    const repeating = new MusikvereinWienScraper({
      fetchHtml: async () => fixturePage1, // every page returns the same window
    });
    const events = await repeating.scrape();
    expect(new Set(events.map(e => e.id)).size).toBe(events.length);

    const singlePage = new MusikvereinWienScraper({
      fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
    });
    const onePage = await singlePage.scrape();
    expect(events.length).toBe(onePage.length); // repeated window added nothing
  });

  testDbIntegration(new MusikvereinWienScraper({
    fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
  }));
});
