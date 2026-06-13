import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TeatroAllaScalaScraper } from '../teatro-alla-scala.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/teatro-alla-scala.html', import.meta.url), 'utf8');
// Fixed reference date matching the fixture's capture window, so the
// past/upcoming filter is deterministic regardless of when the test runs.
const NOW = new Date('2026-06-13T12:00:00Z');
const scraper = new TeatroAllaScalaScraper({
  fetchHtml: async () => fixture,
  now: () => NOW,
});

describe('TeatroAllaScalaScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('drops past events, keeps only upcoming', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date >= '2026-06-13').toBe(true);
    }
    // The calendario archive contains old seasons (e.g. Don Carlo, 2024-01-02)
    // that must be filtered out.
    expect(events.some((e) => e.title.includes('Don Carlo'))).toBe(false);
  });

  it('deduplicates events with multiple subscription types', async () => {
    const events = await scraper.scrape();
    const ids = events.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('extracts composer in title', async () => {
    const events = await scraper.scrape();
    // Composer is appended as "Title (Composer)"; assert on an exact upcoming
    // opera title rather than a substring (intro talks like "Prima delle
    // prime - …" carry the work name but no composer).
    expect(events.some((e) => e.title === 'La traviata (Giuseppe Verdi)')).toBe(true);
  });

  it('builds absolute URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter((e) => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    expect(withUrl[0].url).toMatch(/^https:\/\/www\.teatroallascala\.org\//);
  });

  testDbIntegration(scraper);
});
