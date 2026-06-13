import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { OpernhausZuerichScraper } from '../opernhaus-zuerich.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixturePage1 = readFileSync(new URL('../__fixtures__/opernhaus-zuerich.html', import.meta.url), 'utf8');
const fixturePage2 = readFileSync(new URL('../__fixtures__/opernhaus-zuerich-page2.html', import.meta.url), 'utf8');

const SCHEDULE_URL = 'https://www.opernhaus.ch/spielplan/kalendarium/';
const PAGE2_URL = 'https://www.opernhaus.ch/spielplan/kalendarium/page2';
const EMPTY = '<html><body></body></html>';

const pages: Record<string, string> = {
  [SCHEDULE_URL]: fixturePage1,
  [PAGE2_URL]: fixturePage2,
};

// Serves the two committed page fixtures, then an empty page to halt pagination.
const scraper = new OpernhausZuerichScraper({
  fetchHtml: async (url: string) => pages[url] ?? EMPTY,
});

describe('OpernhausZuerichScraper', () => {
  it('parses events from the fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('sets all required Event fields with valid shapes', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('opernhaus-zuerich');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time === null || /^\d{2}:\d{2}$/.test(e.time)).toBe(true);
      expect(e.conductor).toBeNull();
      expect(e.cast).toBeNull();
      expect(e.location === null || typeof e.location === 'string').toBe(true);
      expect(e.url === null || e.url.startsWith('https://www.opernhaus.ch')).toBe(true);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  it('extracts date and time correctly from JSON-LD', async () => {
    const events = await scraper.scrape();
    const ballo = events.find(e => e.title.startsWith('Un ballo in maschera'));
    expect(ballo).toBeDefined();
    expect(ballo!.date).toBe('2026-06-13');
    expect(ballo!.time).toBe('19:00');
  });

  it('extracts location', async () => {
    const events = await scraper.scrape();
    const ballo = events.find(e => e.title.startsWith('Un ballo in maschera'));
    expect(ballo).toBeDefined();
    expect(ballo!.location).toBe('Hauptbühne Opernhaus');
  });

  it('builds an absolute event URL', async () => {
    const events = await scraper.scrape();
    const ballo = events.find(e => e.title.startsWith('Un ballo in maschera'));
    expect(ballo).toBeDefined();
    expect(ballo!.url).toContain('opernhaus.ch');
    expect(ballo!.url).toContain('un-ballo-in-maschera');
  });

  it('enriches the title with composer info', async () => {
    const events = await scraper.scrape();
    const tannhaeuser = events.find(e => e.title.startsWith('Tannhäuser'));
    expect(tannhaeuser).toBeDefined();
    expect(tannhaeuser!.title).toContain('Richard Wagner');
  });

  it('paginates beyond the first page', async () => {
    // Page 1 only: page 2 returns empty, so pagination stops after one page.
    const singlePage = new OpernhausZuerichScraper({
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
    const singlePage = new OpernhausZuerichScraper({
      fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
    });
    const repeating = new OpernhausZuerichScraper({
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
    expect(events.length).toBeLessThan(60);
  });

  testDbIntegration(scraper);
});
