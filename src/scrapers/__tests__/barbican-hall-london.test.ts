import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BarbicanHallLondonScraper } from '../barbican-hall-london.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/barbican-hall-london.html', import.meta.url), 'utf8');
const scraper = new BarbicanHallLondonScraper({ fetchHtml: async () => fixture });

describe('BarbicanHallLondonScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses date and time correctly', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    // First event: "Madrid Philharmonic Orchestra: 100 Years of Cinema"
    // datetime="2026-04-04T15:00:00Z" displayed as "Sat 4 Apr 2026, 16:00" (BST)
    expect(first.date).toBe('2026-04-04');
    expect(first.time).toBe('16:00');
  });

  it('extracts conductor when present', async () => {
    const events = await scraper.scrape();
    // "London Symphony Orchestra/Sir Antonio Pappano" has conductor
    const lso = events.find(e => e.title.includes('London Symphony Orchestra/Sir Antonio Pappano'));
    expect(lso).toBeDefined();
    expect(lso!.conductor).toBe('Sir Antonio Pappano');
  });

  it('extracts cast/performers when present', async () => {
    const events = await scraper.scrape();
    const lso = events.find(
      e => e.title === 'London Symphony Orchestra/Sir Antonio Pappano' && e.date === '2026-04-16',
    );
    expect(lso).toBeDefined();
    expect(lso!.cast).toContain('Vilde Frang');
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
