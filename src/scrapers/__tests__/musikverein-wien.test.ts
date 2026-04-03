import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { MusikvereinWienScraper } from '../musikverein-wien.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/musikverein-wien.html', import.meta.url), 'utf8');
const scraper = new MusikvereinWienScraper({ fetchHtml: async () => fixture });

describe('MusikvereinWienScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date, time, and location', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.time).toMatch(/^\d{2}:\d{2}$/);
    expect(first.location).toBeTruthy();
  });

  it('extracts performers as cast', async () => {
    const events = await scraper.scrape();
    const wienerPhil = events.find(e => e.title.includes('Wiener Philharmoniker'));
    expect(wienerPhil).toBeDefined();
    expect(wienerPhil!.cast).toContain('Sir Simon Rattle');
  });

  it('appends composers to title', async () => {
    const events = await scraper.scrape();
    const wienerPhil = events.find(e => e.title.includes('Wiener Philharmoniker') && e.title.includes('Mahler'));
    expect(wienerPhil).toBeDefined();
    expect(wienerPhil!.title).toContain('Gustav Mahler');
  });

  it('has valid URLs for all events', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      if (event.url) {
        expect(event.url).toContain('musikverein.at/konzert/');
      }
    }
  });

  testDbIntegration(scraper);
});
