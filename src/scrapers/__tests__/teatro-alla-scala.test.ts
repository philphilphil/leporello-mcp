import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TeatroAllaScalaScraper } from '../teatro-alla-scala.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/teatro-alla-scala.html', import.meta.url), 'utf8');
const scraper = new TeatroAllaScalaScraper({ fetchHtml: async () => fixture });

describe('TeatroAllaScalaScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('deduplicates events with multiple subscription types', async () => {
    const events = await scraper.scrape();
    const ids = events.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('extracts composer in title', async () => {
    const events = await scraper.scrape();
    const donCarlo = events.find((e) => e.title.includes('Don Carlo'));
    expect(donCarlo).toBeDefined();
    expect(donCarlo!.title).toContain('Giuseppe Verdi');
  });

  it('builds absolute URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter((e) => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    expect(withUrl[0].url).toMatch(/^https:\/\/www\.teatroallascala\.org\//);
  });

  testDbIntegration(scraper);
});
