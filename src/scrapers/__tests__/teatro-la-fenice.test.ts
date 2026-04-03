import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TeatroLaFeniceScraper } from '../teatro-la-fenice.js';

const fixture = readFileSync(new URL('../__fixtures__/teatro-la-fenice.html', import.meta.url), 'utf8');
const scraper = new TeatroLaFeniceScraper({ fetchHtml: async () => fixture });

describe('TeatroLaFeniceScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses date in YYYY-MM-DD format', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('parses time in HH:MM format or null', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      if (e.time !== null) {
        expect(e.time).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });

  it('includes event URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter((e) => e.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/www\.teatrolafenice\.it\//);
    }
  });

  it('includes location when available', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter((e) => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('teatro-la-fenice');
      expect(e.title).toBeTruthy();
      expect(e.date).toBeTruthy();
      expect(e.scraped_at).toBeTruthy();
      // Optional fields can be null but must be present
      expect(e).toHaveProperty('time');
      expect(e).toHaveProperty('conductor');
      expect(e).toHaveProperty('cast');
      expect(e).toHaveProperty('location');
      expect(e).toHaveProperty('url');
    }
  });
});
