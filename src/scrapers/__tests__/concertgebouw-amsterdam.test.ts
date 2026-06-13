import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ConcertgebouwAmsterdamScraper } from '../concertgebouw-amsterdam.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixturePage1 = readFileSync(new URL('../__fixtures__/concertgebouw-amsterdam.html', import.meta.url), 'utf8');
const fixturePage2 = readFileSync(new URL('../__fixtures__/concertgebouw-amsterdam-page2.html', import.meta.url), 'utf8');

const SCHEDULE_URL = 'https://www.concertgebouw.nl/concerten-en-tickets';
const PAGE2_URL = 'https://www.concertgebouw.nl/concerten-en-tickets?page=2';
const EMPTY = '<html><body></body></html>';

const pages: Record<string, string> = {
  [SCHEDULE_URL]: fixturePage1,
  [PAGE2_URL]: fixturePage2,
};

// Serves the two committed page fixtures, then an empty page to halt pagination.
const scraper = new ConcertgebouwAmsterdamScraper({
  fetchHtml: async (url: string) => pages[url] ?? EMPTY,
});

describe('ConcertgebouwAmsterdamScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('has all required fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('concertgebouw-amsterdam');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time === null || /^\d{2}:\d{2}$/.test(e.time)).toBe(true);
      expect(e.conductor === null || typeof e.conductor === 'string').toBe(true);
      expect(e.cast === null || Array.isArray(e.cast)).toBe(true);
      expect(e.url === null || /^https:\/\/www\.concertgebouw\.nl\//.test(e.url)).toBe(true);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  it('parses the real hall name as location', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter((e) => e.location);
    expect(withLocation.length).toBeGreaterThan(0);
    // Concertgebouw halls are "Grote Zaal" / "Kleine Zaal" — never the "–"
    // time separator or a "v.a. € …" price (the bug this guards against).
    for (const e of withLocation) {
      expect(e.location).not.toBe('–');
      expect(e.location).not.toMatch(/€|v\.a\./);
    }
    const halls = new Set(withLocation.map((e) => e.location));
    expect(halls.has('Grote Zaal') || halls.has('Kleine Zaal')).toBe(true);
  });

  it('parses program as cast', async () => {
    const events = await scraper.scrape();
    const withCast = events.filter((e) => e.cast);
    expect(withCast.length).toBeGreaterThan(0);
  });

  it('generates absolute URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter((e) => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/www\.concertgebouw\.nl\//);
    }
  });

  it('paginates beyond the first page', async () => {
    const singlePage = new ConcertgebouwAmsterdamScraper({
      fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
    });
    const onePage = await singlePage.scrape();
    const bothPages = await scraper.scrape();

    expect(bothPages.length).toBeGreaterThan(onePage.length); // page 2 added events
    const ids = bothPages.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });

  it('deduplicates events repeated across pages', async () => {
    // Serve the same fixture for pages 1 and 2: every event repeats, so dedup
    // collapses them and pagination stops (page 2 added nothing new).
    const singlePage = new ConcertgebouwAmsterdamScraper({
      fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
    });
    const repeating = new ConcertgebouwAmsterdamScraper({
      fetchHtml: async (url: string) =>
        (url === SCHEDULE_URL || url === PAGE2_URL ? fixturePage1 : EMPTY),
    });
    const onePage = await singlePage.scrape();
    const events = await repeating.scrape();

    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(events.length).toBe(onePage.length); // repeated page added nothing
  });

  testDbIntegration(scraper);
});
