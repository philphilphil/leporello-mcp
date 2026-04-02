import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { WienerKonzerthausScraper } from '../wiener-konzerthaus.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/wiener-konzerthaus.json', import.meta.url), 'utf8'),
);
const scraper = new WienerKonzerthausScraper({ fetchJson: async () => fixtureJson });

describe('WienerKonzerthausScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(30);
  });

  it('extracts date and time from ISO datetime', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.date).toBe('2026-04-07');
    expect(first.time).toBe('19:30');
  });

  it('extracts room as location', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.location).toBe('Großer Saal');
  });

  it('builds event detail URL from slug', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.url).toBe('https://konzerthaus.at/de/programm-und-karten/philharmonix-funk/62911');
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toMatch(/^[0-9a-f]{16}$/);
      expect(e.venue_id).toBe('wiener-konzerthaus');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.scraped_at).toBeTruthy();
      expect(e).toHaveProperty('time');
      expect(e).toHaveProperty('conductor');
      expect(e).toHaveProperty('cast');
      expect(e).toHaveProperty('location');
      expect(e).toHaveProperty('url');
    }
  });
});
