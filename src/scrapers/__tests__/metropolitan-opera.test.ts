import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { MetropolitanOperaScraper } from '../metropolitan-opera.js';

const fixtureJson = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/metropolitan-opera.json'),
    'utf8',
  ),
);

describe('MetropolitanOperaScraper', () => {
  it('parses all performance events from fixture', async () => {
    const scraper = new MetropolitanOperaScraper({ fetchJson: async () => fixtureJson });
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBe(25);
  });

  it('returns events with required fields', async () => {
    const scraper = new MetropolitanOperaScraper({ fetchJson: async () => fixtureJson });
    const [event] = await scraper.scrape();
    expect(event.venue_id).toBe('metropolitan-opera');
    expect(event.title).toBeTruthy();
    expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(event.id).toHaveLength(16);
  });

  it('parses conductor and cast from cast string', async () => {
    const scraper = new MetropolitanOperaScraper({ fetchJson: async () => fixtureJson });
    const events = await scraper.scrape();
    // First event: "Nézet-Séguin; Davidsen, Gubanova, Spyres, Konieczny, Green"
    const tristan = events[0];
    expect(tristan.conductor).toBe('Nézet-Séguin');
    expect(tristan.cast).toContain('Davidsen');
    expect(tristan.cast!.length).toBeGreaterThan(1);
  });

  it('includes composer in title', async () => {
    const scraper = new MetropolitanOperaScraper({ fetchJson: async () => fixtureJson });
    const events = await scraper.scrape();
    const tristan = events[0];
    expect(tristan.title).toBe('Tristan und Isolde (Richard Wagner)');
  });

  it('generates stable IDs across multiple parses', async () => {
    const scraper = new MetropolitanOperaScraper({ fetchJson: async () => fixtureJson });
    const [a] = await scraper.scrape();
    const [b] = await scraper.scrape();
    expect(a.id).toBe(b.id);
  });
});
