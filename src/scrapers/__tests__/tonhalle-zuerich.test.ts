import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TonhalleZuerichScraper } from '../tonhalle-zuerich.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixturePage1 = readFileSync(new URL('../__fixtures__/tonhalle-zuerich.html', import.meta.url), 'utf8');
const fixturePage2 = readFileSync(new URL('../__fixtures__/tonhalle-zuerich-page2.html', import.meta.url), 'utf8');

const SCHEDULE_URL = 'https://tonhalle-orchester.ch/konzerte/kalender/';
const PAGE2_URL = 'https://tonhalle-orchester.ch/konzerte/kalender/page2?action=filtercalendar';
const EMPTY = '<div class="js-calendarlist-list"></div>';

const pages: Record<string, string> = {
  [SCHEDULE_URL]: fixturePage1,
  [PAGE2_URL]: fixturePage2,
};

// Serves the two committed page fixtures, then an empty list to halt pagination.
const scraper = new TonhalleZuerichScraper({
  fetchHtml: async (url: string) => pages[url] ?? EMPTY,
});

describe('TonhalleZuerichScraper', () => {
  it('parses events from the fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('sets all required Event fields with valid shapes', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('tonhalle-zuerich');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time === null || /^\d{2}:\d{2}$/.test(e.time)).toBe(true);
      expect(e.conductor === null || typeof e.conductor === 'string').toBe(true);
      expect(e.cast === null || Array.isArray(e.cast)).toBe(true);
      expect(e.location).toBeNull();
      expect(e.url === null || e.url.startsWith('https://tonhalle-orchester.ch')).toBe(true);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  it('extracts a conductor from the "Leitung" role', async () => {
    const events = await scraper.scrape();
    expect(events.filter((e) => e.conductor !== null).length).toBeGreaterThan(0);
  });

  it('extracts cast members', async () => {
    const events = await scraper.scrape();
    expect(events.filter((e) => e.cast !== null && e.cast.length > 0).length).toBeGreaterThan(0);
  });

  it('paginates beyond the first page', async () => {
    // Page 1 only: page 2 returns empty, so pagination stops after one page.
    const singlePage = new TonhalleZuerichScraper({
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
    // must collapse them back to a single page's worth.
    const singlePage = new TonhalleZuerichScraper({
      fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
    });
    const repeating = new TonhalleZuerichScraper({
      fetchHtml: async (url: string) =>
        (url === SCHEDULE_URL || url === PAGE2_URL ? fixturePage1 : EMPTY),
    });
    const onePage = await singlePage.scrape();
    const events = await repeating.scrape();

    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(events.length).toBe(onePage.length); // repeated page added nothing
  });

  it('stops paginating at an empty page', async () => {
    // Two non-empty fixtures then EMPTY — must terminate, not loop to MAX_PAGES.
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(40);
  });

  testDbIntegration(scraper);
});
