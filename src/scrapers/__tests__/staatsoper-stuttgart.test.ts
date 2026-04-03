import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { StaatsoperStuttgartScraper } from '../staatsoper-stuttgart.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/staatsoper-stuttgart.html', import.meta.url), 'utf8');
const scraper = new StaatsoperStuttgartScraper({ fetchHtml: async () => fixture });

describe('StaatsoperStuttgartScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(77);
  });

  it('extracts date and time from startDate meta', async () => {
    const events = await scraper.scrape();
    expect(events[0].date).toBe('2026-04-02');
    expect(events[0].time).toBe('18:00');
  });

  it('extracts location', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location);
    expect(withLocation.length).toBeGreaterThan(0);
    expect(withLocation[0].location).toBe('Staatsoper Stuttgart');
  });

  it('builds absolute URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/www\.staatsoper-stuttgart\.de\//);
    }
  });

  it('all events have required fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toMatch(/^[0-9a-f]{16}$/);
      expect(e.venue_id).toBe('staatsoper-stuttgart');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  testDbIntegration(scraper);
});
