import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { OperFrankfurtScraper } from '../oper-frankfurt.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/oper-frankfurt.html', import.meta.url), 'utf8');
const scraper = new OperFrankfurtScraper({ fetchHtml: async () => fixture });

describe('OperFrankfurtScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(46);
  });

  it('includes composer in title', async () => {
    const events = await scraper.scrape();
    const tristan = events.find(e => e.title.includes('Tristan'));
    expect(tristan).toBeDefined();
    expect(tristan!.title).toBe('Tristan und Isolde (Richard Wagner)');
  });

  it('parses time from "HH.MM Uhr" format', async () => {
    const events = await scraper.scrape();
    const tristan = events.find(e => e.title.includes('Tristan'));
    expect(tristan!.time).toBe('17:00');
    const werther = events.find(e => e.title.includes('Werther'));
    expect(werther!.time).toBe('19:30');
  });

  it('extracts location from meta text', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location);
    expect(withLocation.length).toBeGreaterThan(0);
    expect(withLocation[0].location).toBe('Opernhaus');
  });

  it('generates URLs under the season-calendar path', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/oper-frankfurt\.de\/de\/spielplan\//);
    }
  });

  it('all events have required fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toMatch(/^[0-9a-f]{16}$/);
      expect(e.venue_id).toBe('oper-frankfurt');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  testDbIntegration(scraper);
});
