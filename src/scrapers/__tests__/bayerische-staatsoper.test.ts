import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BayerischeStaatsoperScraper } from '../bayerische-staatsoper.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/bayerische-staatsoper.html', import.meta.url), 'utf8');
const scraper = new BayerischeStaatsoperScraper({ fetchHtml: async () => fixture });

describe('BayerischeStaatsoperScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses date in YYYY-MM-DD format', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('parses time in HH:MM format', async () => {
    const events = await scraper.scrape();
    const withTime = events.filter((e) => e.time !== null);
    expect(withTime.length).toBeGreaterThan(0);
    for (const e of withTime) {
      expect(e.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('includes composer in title for operas', async () => {
    const events = await scraper.scrape();
    const parsifal = events.find((e) => e.title.includes('PARSIFAL'));
    expect(parsifal).toBeDefined();
    expect(parsifal!.title).toContain('Richard Wagner');
  });

  it('extracts location from info line', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter((e) => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
    expect(withLocation.some((e) => e.location === 'Nationaltheater')).toBe(true);
  });

  it('builds absolute URLs', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      if (e.url) {
        expect(e.url).toMatch(/^https:\/\/www\.staatsoper\.de\//);
      }
    }
  });

  it('filters out non-performance genres (tours, community, etc.)', async () => {
    const events = await scraper.scrape();
    // Fixture has 44 rows total, but only ~26 are Oper/Ballett/Konzert/Liederabend
    expect(events.length).toBeLessThan(44);
    expect(events.length).toBeGreaterThan(10);
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('bayerische-staatsoper');
      expect(e.title).toBeTruthy();
      expect(e.date).toBeTruthy();
      expect(e.scraped_at).toBeTruthy();
      // time, conductor, cast, location, url may be null
      expect('time' in e).toBe(true);
      expect('conductor' in e).toBe(true);
      expect('cast' in e).toBe(true);
      expect('location' in e).toBe(true);
      expect('url' in e).toBe(true);
    }
  });

  testDbIntegration(scraper);
});
