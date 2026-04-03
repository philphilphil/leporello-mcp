import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ConcertgebouwAmsterdamScraper } from '../concertgebouw-amsterdam.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/concertgebouw-amsterdam.html', import.meta.url), 'utf8');
const scraper = new ConcertgebouwAmsterdamScraper({ fetchHtml: async () => fixture });

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
      expect(e.scraped_at).toBeTruthy();
      // time, conductor, cast, location, url may be null
    }
  });

  it('parses location (hall name)', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter((e) => e.location);
    expect(withLocation.length).toBeGreaterThan(0);
    // Concertgebouw has Grote Zaal and Kleine Zaal
    const halls = new Set(withLocation.map((e) => e.location));
    expect(halls.size).toBeGreaterThan(0);
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

  testDbIntegration(scraper);
});
