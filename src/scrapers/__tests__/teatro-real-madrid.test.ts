import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TeatroRealMadridScraper } from '../teatro-real-madrid.js';

const fixture = readFileSync(new URL('../__fixtures__/teatro-real-madrid.html', import.meta.url), 'utf8');
const scraper = new TeatroRealMadridScraper({ fetchHtml: async () => fixture });

describe('TeatroRealMadridScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts correct date format', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('extracts time in HH:MM format', async () => {
    const events = await scraper.scrape();
    const withTime = events.filter(e => e.time !== null);
    expect(withTime.length).toBeGreaterThan(0);
    for (const event of withTime) {
      expect(event.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('includes category in title', async () => {
    const events = await scraper.scrape();
    const opera = events.find(e => e.title.includes('Ópera'));
    expect(opera).toBeDefined();
  });

  it('generates absolute URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const event of withUrl) {
      expect(event.url).toMatch(/^https:\/\/www\.teatroreal\.es\//);
    }
  });

  it('creates separate events for multiple time slots', async () => {
    const events = await scraper.scrape();
    // "Un instante en suspensión" on April 11 has 6 time slots
    const suspension = events.filter(e =>
      e.title.includes('Un instante en suspensión') && e.date === '2026-04-11'
    );
    expect(suspension.length).toBe(6);
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.venue_id).toBe('teatro-real-madrid');
      expect(event.title).toBeTruthy();
      expect(event.date).toBeTruthy();
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
