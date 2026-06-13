import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BarbicanHallLondonScraper } from '../barbican-hall-london.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixturePage1 = readFileSync(new URL('../__fixtures__/barbican-hall-london.html', import.meta.url), 'utf8');
const fixturePage2 = readFileSync(new URL('../__fixtures__/barbican-hall-london-page2.html', import.meta.url), 'utf8');

const SCHEDULE_URL = 'https://www.barbican.org.uk/whats-on/classical-music';
const PAGE2_URL = `${SCHEDULE_URL}?page=1`;
const EMPTY = '<html><body></body></html>';

const pages: Record<string, string> = {
  [SCHEDULE_URL]: fixturePage1,
  [PAGE2_URL]: fixturePage2,
};

// Serves the two committed page fixtures, then an empty page to halt pagination.
const scraper = new BarbicanHallLondonScraper({
  fetchHtml: async (url: string) => pages[url] ?? EMPTY,
});

// A single-page scraper (page 2 empty) for parsing-focused assertions.
const firstPageScraper = new BarbicanHallLondonScraper({
  fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
});

describe('BarbicanHallLondonScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses date and time correctly', async () => {
    const events = await firstPageScraper.scrape();
    const first = events[0];
    // First event: "City Music Foundation Artists in recital"
    // displayed as "Sun 14 Jun 2026, 17:30" (local time)
    expect(first.date).toBe('2026-06-14');
    expect(first.time).toBe('17:30');
    // Every parsed date/time has the canonical shape.
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time === null || /^\d{2}:\d{2}$/.test(e.time)).toBe(true);
    }
  });

  it('extracts conductor when present', async () => {
    const events = await firstPageScraper.scrape();
    // "London Symphony Orchestra/Sir Antonio Pappano" lists a conductor.
    const lso = events.find(e => e.title === 'London Symphony Orchestra/Sir Antonio Pappano');
    expect(lso).toBeDefined();
    expect(lso!.conductor).toBe('Sir Antonio Pappano');
  });

  it('extracts cast/performers when present', async () => {
    const events = await firstPageScraper.scrape();
    const lso = events.find(e => e.title === 'London Symphony Orchestra/Sir Antonio Pappano');
    expect(lso).toBeDefined();
    expect(lso!.cast).toContain('London Symphony Orchestra');
    // Conductor must not be duplicated into the cast list.
    expect(lso!.cast).not.toContain('Sir Antonio Pappano');
  });

  it('builds absolute event URLs', async () => {
    const events = await firstPageScraper.scrape();
    const withUrl = events.filter(e => e.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url!.startsWith('https://www.barbican.org.uk/')).toBe(true);
    }
  });

  it('paginates into the second page within the 90-day window', async () => {
    const onePage = await firstPageScraper.scrape();
    const bothPages = await scraper.scrape();
    // Page 2 adds upcoming September events that fall inside the window.
    expect(bothPages.length).toBeGreaterThan(onePage.length);
    const ids = bothPages.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids across pages
  });

  it('sets all 9 Event fields', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('venue_id', 'barbican-hall-london');
      expect(event).toHaveProperty('title');
      expect(event).toHaveProperty('date');
      expect(event).toHaveProperty('time');
      expect(event).toHaveProperty('conductor');
      expect(event).toHaveProperty('cast');
      expect(event).toHaveProperty('location');
      expect(event).toHaveProperty('url');
      expect(event).toHaveProperty('scraped_at');
    }
  });

  testDbIntegration(scraper);
});
