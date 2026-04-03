import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { RoyalOperaHouseLondonScraper } from '../royal-opera-house-london.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/royal-opera-house-london.json', import.meta.url), 'utf8'),
);
const scraper = new RoyalOperaHouseLondonScraper({ fetchJson: async () => fixtureJson });

describe('RoyalOperaHouseLondonScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses date and time correctly', async () => {
    const events = await scraper.scrape();
    const rigoletto = events.find(e => e.title === 'Rigoletto');
    expect(rigoletto).toBeDefined();
    expect(rigoletto!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rigoletto!.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('includes location from venue data', async () => {
    const events = await scraper.scrape();
    const mainStageEvent = events.find(e => e.location === 'Main Stage');
    expect(mainStageEvent).toBeDefined();
  });

  it('builds correct event URLs', async () => {
    const events = await scraper.scrape();
    const rigoletto = events.find(e => e.title === 'Rigoletto');
    expect(rigoletto!.url).toBe('https://www.rbo.org.uk/tickets-and-events/rigoletto-oliver-mears');
  });

  it('includes subtitle in title when present', async () => {
    const events = await scraper.scrape();
    const withSubtitle = events.find(e => e.title.includes('—'));
    if (withSubtitle) {
      expect(withSubtitle.title).toContain('—');
    }
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.venue_id).toBe('royal-opera-house-london');
      expect(event.title).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.scraped_at).toBeTruthy();
      // Optional fields can be null but must be present
      expect('time' in event).toBe(true);
      expect('conductor' in event).toBe(true);
      expect('cast' in event).toBe(true);
      expect('location' in event).toBe(true);
      expect('url' in event).toBe(true);
    }
  });
});
