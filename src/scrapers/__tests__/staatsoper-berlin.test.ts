import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { StaatsoperBerlinScraper } from '../staatsoper-berlin.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixturePage1 = readFileSync(new URL('../__fixtures__/staatsoper-berlin.html', import.meta.url), 'utf8');
const fixturePage2 = readFileSync(new URL('../__fixtures__/staatsoper-berlin-page2.html', import.meta.url), 'utf8');

const pages: Record<string, string> = {
  'https://www.staatsoper-berlin.de/de/spielplan/': fixturePage1,
  'https://www.staatsoper-berlin.de/de/spielplan/_f/08-04-2026': fixturePage2,
};

const scraper = new StaatsoperBerlinScraper({
  fetchHtml: async (url: string) => {
    const html = pages[url];
    if (!html) throw new Error(`No fixture for ${url}`);
    return html;
  },
});

describe('StaatsoperBerlinScraper', () => {
  it('parses events from multiple pages', async () => {
    const events = await scraper.scrape();
    // Page 1 has 5 events, page 2 has 13 events
    expect(events.length).toBeGreaterThan(10);
  });

  it('sets all required event fields', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.venue_id).toBe('staatsoper-berlin');
      expect(event.title).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.time).toMatch(/^\d{2}:\d{2}$/);
      expect(event.scraped_at).toBeTruthy();
    }
  });

  it('parses conductor when available', async () => {
    const events = await scraper.scrape();
    const withConductor = events.filter((e) => e.conductor !== null);
    expect(withConductor.length).toBeGreaterThan(0);
  });

  it('parses cast when available', async () => {
    const events = await scraper.scrape();
    const withCast = events.filter((e) => e.cast !== null && e.cast.length > 0);
    expect(withCast.length).toBeGreaterThan(0);
  });

  it('parses location', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter((e) => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
  });

  it('includes composer in title when available', async () => {
    const events = await scraper.scrape();
    const withComposer = events.filter((e) => e.title.includes('('));
    expect(withComposer.length).toBeGreaterThan(0);
  });

  it('stops when no next page link exists', async () => {
    // Single-page scraper with no pagination
    const singlePageScraper = new StaatsoperBerlinScraper({
      fetchHtml: async () => fixturePage2.replace(/data-pagination-fragment-url="[^"]*"/, ''),
    });
    const events = await singlePageScraper.scrape();
    expect(events.length).toBe(13);
  });

  testDbIntegration(scraper);
});
