import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SemperoperDresdenScraper } from '../semperoper-dresden.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/semperoper-dresden.html', import.meta.url), 'utf8');
const scraper = new SemperoperDresdenScraper({ fetchHtml: async () => fixture });

describe('SemperoperDresdenScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('sets correct venue_id on all events', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.venue_id).toBe('semperoper-dresden');
    }
  });

  it('extracts date and time from timestamps', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('assigns location from venue code', async () => {
    const events = await scraper.scrape();
    const semperoper = events.find(e => e.location === 'Semperoper');
    const semperZwei = events.find(e => e.location === 'Semper Zwei');
    expect(semperoper).toBeDefined();
    expect(semperZwei).toBeDefined();
  });

  it('populates detail URLs for events with known slugs', async () => {
    const events = await scraper.scrape();
    const withDetailUrl = events.filter(e => e.url?.includes('/stuecke/'));
    expect(withDetailUrl.length).toBeGreaterThan(0);
    expect(withDetailUrl[0].url).toMatch(/^https:\/\/www\.semperoper\.de\/spielplan\/stuecke\//);
  });

  testDbIntegration(scraper);
});
