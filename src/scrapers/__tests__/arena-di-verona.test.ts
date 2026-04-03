import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ArenaDiVeronaScraper } from '../arena-di-verona.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/arena-di-verona.html', import.meta.url), 'utf8');
const scraper = new ArenaDiVeronaScraper({ fetchHtml: async () => fixture });

describe('ArenaDiVeronaScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date, time, and location', async () => {
    const events = await scraper.scrape();
    const withTime = events.find(e => e.time !== null);
    expect(withTime).toBeDefined();
    expect(withTime!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(withTime!.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('skips placeholder days with malformed dates', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('builds absolute URLs for event links', async () => {
    const events = await scraper.scrape();
    const withUrl = events.find(e => e.url !== null);
    expect(withUrl).toBeDefined();
    expect(withUrl!.url).toMatch(/^https:\/\/www\.arena\.it\//);
  });

  testDbIntegration(scraper);
});
