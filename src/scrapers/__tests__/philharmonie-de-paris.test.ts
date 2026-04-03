import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PhilharmonieDeParisScraper } from '../philharmonie-de-paris.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/philharmonie-de-paris.html', import.meta.url), 'utf8');
const scraper = new PhilharmonieDeParisScraper({ fetchHtml: async () => fixture });

describe('PhilharmonieDeParisScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('philharmonie-de-paris');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time).toMatch(/^\d{2}:\d{2}$/);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  it('parses subtitle into cast', async () => {
    const events = await scraper.scrape();
    const withCast = events.filter(e => e.cast !== null);
    expect(withCast.length).toBeGreaterThan(0);
  });

  it('parses location (hall name)', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
  });

  it('parses event URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/philharmoniedeparis\.fr\//);
    }
  });

  testDbIntegration(scraper);
});
