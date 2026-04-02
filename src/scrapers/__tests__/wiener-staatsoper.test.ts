import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { WienerStaatsoperScraper } from '../wiener-staatsoper.js';

const fixtureHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/wiener-staatsoper.html'),
  'utf8',
);

describe('WienerStaatsoperScraper', () => {
  it('parses events from fixture', async () => {
    const scraper = new WienerStaatsoperScraper({ fetchHtml: async () => fixtureHtml });
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('returns events with required fields', async () => {
    const scraper = new WienerStaatsoperScraper({ fetchHtml: async () => fixtureHtml });
    const events = await scraper.scrape();
    const [event] = events;
    expect(event.venue_id).toBe('wiener-staatsoper');
    expect(event.title).toBeTruthy();
    expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(event.id).toHaveLength(16);
  });

  it('extracts conductor and cast for opera events', async () => {
    const scraper = new WienerStaatsoperScraper({ fetchHtml: async () => fixtureHtml });
    const events = await scraper.scrape();
    const parsifal = events.find(e => e.title.includes('Parsifal'));
    expect(parsifal).toBeDefined();
    expect(parsifal!.conductor).toBe('Axel Kober');
    expect(parsifal!.cast).toContain('Gerald Finley');
  });

  it('extracts location', async () => {
    const scraper = new WienerStaatsoperScraper({ fetchHtml: async () => fixtureHtml });
    const events = await scraper.scrape();
    const mainStageEvent = events.find(e => e.location === 'Main Stage');
    expect(mainStageEvent).toBeDefined();
  });

  it('generates stable IDs across multiple parses', async () => {
    const scraper = new WienerStaatsoperScraper({ fetchHtml: async () => fixtureHtml });
    const [a] = await scraper.scrape();
    const [b] = await scraper.scrape();
    expect(a.id).toBe(b.id);
  });
});
