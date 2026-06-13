import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { LyricOperaChicagoScraper } from '../lyric-opera-chicago.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/lyric-opera-chicago.json', import.meta.url), 'utf8'),
);
// Fixed reference date matching the fixture's capture window, so the
// past/upcoming filter is deterministic regardless of when the test runs.
const NOW = new Date('2026-06-13T12:00:00Z');
const scraper = new LyricOperaChicagoScraper({
  fetchJson: async () => fixtureJson,
  now: () => NOW,
});

describe('LyricOperaChicagoScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('drops past events, keeps only upcoming', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date >= '2026-06-13').toBe(true);
    }
    // The fixture contains old seasons (e.g. Andrea Bocelli, 2017) that must
    // be filtered out.
    expect(events.some(e => e.title === 'Andrea Bocelli in Concert')).toBe(false);
    // A known upcoming performance is present.
    expect(events.some(e => e.title === 'Don Giovanni')).toBe(true);
  });

  it('parses date and time correctly', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (e.time) expect(e.time).toMatch(/^\d{2}:\d{2}$/);
    }
    const donGiovanni = events.find(e => e.title === 'Don Giovanni');
    expect(donGiovanni).toBeDefined();
    expect(donGiovanni!.date).toBe('2026-10-10');
    expect(donGiovanni!.time).toBe('19:30');
  });

  it('builds absolute URLs', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      if (e.url) expect(e.url).toMatch(/^https:\/\/www\.lyricopera\.org\//);
    }
  });

  it('parses location', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location);
    expect(withLocation.length).toBeGreaterThan(0);
    expect(withLocation.some(e => e.location === 'Lyric Opera House')).toBe(true);
  });

  it('produces no duplicate ids', async () => {
    const events = await scraper.scrape();
    const ids = events.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
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

  testDbIntegration(scraper);
});
