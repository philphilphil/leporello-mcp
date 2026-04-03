import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { StaatsoperBerlinScraper } from '../staatsoper-berlin.js';

const fixture = readFileSync(new URL('../__fixtures__/staatsoper-berlin.html', import.meta.url), 'utf8');
const scraper = new StaatsoperBerlinScraper({ fetchHtml: async () => fixture });

describe('StaatsoperBerlinScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('sets all required event fields', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.venue_id).toBe('staatsoper-berlin');
      expect(event.title).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.time).toMatch(/^\d{2}:\d{2}$/);
      expect(event.scraped_at).toBeTruthy();
    }
  });

  it('parses conductor when available', async () => {
    const events = await scraper.scrape();
    const withConductor = events.filter((e) => e.conductor !== null);
    expect(withConductor.length).toBeGreaterThan(0);
  });

  it('parses cast when available', async () => {
    const events = await scraper.scrape();
    const withCast = events.filter((e) => e.cast !== null && e.cast.length > 0);
    expect(withCast.length).toBeGreaterThan(0);
  });

  it('parses location', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter((e) => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
  });

  it('includes composer in title when available', async () => {
    const events = await scraper.scrape();
    const withComposer = events.filter((e) => e.title.includes('('));
    expect(withComposer.length).toBeGreaterThan(0);
  });
});
