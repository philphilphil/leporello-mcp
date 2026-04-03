import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CarnegieHallNewYorkScraper } from '../carnegie-hall-new-york.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/carnegie-hall-new-york.json', import.meta.url), 'utf8'),
);
const scraper = new CarnegieHallNewYorkScraper({ fetchJson: async () => fixtureJson });

describe('CarnegieHallNewYorkScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date and time correctly', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (e.time) expect(e.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('extracts location from facility', async () => {
    const events = await scraper.scrape();
    const withLocation = events.find(e => e.location === 'Stern Auditorium / Perelman Stage');
    expect(withLocation).toBeDefined();
  });

  it('extracts conductor from performers', async () => {
    const events = await scraper.scrape();
    const withConductor = events.find(e => e.conductor !== null);
    expect(withConductor).toBeDefined();
    expect(withConductor!.conductor).toBeTruthy();
  });

  it('builds absolute URLs', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      if (e.url) {
        expect(e.url).toMatch(/^https:\/\/www\.carnegiehall\.org\//);
      }
    }
  });

  it('includes subtitle in title when present', async () => {
    const events = await scraper.scrape();
    const withSubtitle = events.find(e => e.title.includes(' — '));
    expect(withSubtitle).toBeDefined();
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('carnegie-hall-new-york');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.scraped_at).toBeTruthy();
      // time, conductor, cast, location, url may be null
    }
  });
});
