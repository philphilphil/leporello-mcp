import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { LyricOperaChicagoScraper } from '../lyric-opera-chicago.js';

const fixture = readFileSync(new URL('../__fixtures__/lyric-opera-chicago.html', import.meta.url), 'utf8');
const scraper = new LyricOperaChicagoScraper({ fetchHtml: async () => fixture });

describe('LyricOperaChicagoScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses date and time correctly', async () => {
    const events = await scraper.scrape();
    // First event should be April 1, 2026
    expect(events[0].date).toBe('2026-04-01');
    expect(events[0].time).toBe('14:00');
  });

  it('parses event title and URL', async () => {
    const events = await scraper.scrape();
    expect(events[0].title).toBeTruthy();
    expect(events[0].url).toMatch(/^https:\/\/www\.lyricopera\.org\//);
  });

  it('parses location', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location);
    expect(withLocation.length).toBeGreaterThan(0);
    expect(withLocation[0].location).toBe('Lyric Opera House');
  });

  it('sets all required event fields', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.venue_id).toBe('lyric-opera-chicago');
      expect(event.title).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.scraped_at).toBeTruthy();
      // Optional fields can be null
      expect('time' in event).toBe(true);
      expect('conductor' in event).toBe(true);
      expect('cast' in event).toBe(true);
      expect('location' in event).toBe(true);
      expect('url' in event).toBe(true);
    }
  });
});
