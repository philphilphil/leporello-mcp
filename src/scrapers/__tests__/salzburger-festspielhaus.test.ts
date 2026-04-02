import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SalzburgerFestspieleScraper } from '../salzburger-festspielhaus.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/salzburger-festspielhaus.json', import.meta.url), 'utf8'),
);
const scraper = new SalzburgerFestspieleScraper({ fetchJson: async () => fixtureJson });

describe('SalzburgerFestspieleScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('includes composer in title for opera events', async () => {
    const events = await scraper.scrape();
    const carmen = events.find(e => e.title.includes('Carmen'));
    expect(carmen).toBeDefined();
    expect(carmen!.title).toBe('Carmen (Georges Bizet)');
  });

  it('parses date and time correctly', async () => {
    const events = await scraper.scrape();
    // Every event should have a valid date
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (e.time) {
        expect(e.time).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });

  it('cleans HTML from location field', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      if (e.location) {
        expect(e.location).not.toContain('<br>');
        expect(e.location).not.toContain('<br/>');
      }
    }
  });

  it('extracts conductor when available', async () => {
    const events = await scraper.scrape();
    const withConductor = events.filter(e => e.conductor !== null);
    expect(withConductor.length).toBeGreaterThan(0);
    // Tugan Sokhiev conducts Wiener Philharmoniker
    const sokhiev = events.find(e => e.conductor === 'Tugan Sokhiev');
    expect(sokhiev).toBeDefined();
  });

  it('generates stable event IDs', async () => {
    const events = await scraper.scrape();
    const ids = events.map(e => e.id);
    // All IDs should be 16-char hex strings
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    }
    // No duplicate IDs
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sets venue_id correctly', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.venue_id).toBe('salzburger-festspielhaus');
    }
  });

  it('includes event URL', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/www\.salzburgerfestspiele\.at\//);
    }
  });
});
