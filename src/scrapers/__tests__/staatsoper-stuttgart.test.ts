import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { StaatsoperStuttgartScraper } from '../staatsoper-stuttgart.js';

const fixtureHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__/staatsoper-stuttgart.html'),
  'utf8',
);

describe('StaatsoperStuttgartScraper', () => {
  it('parses at least one event from fixture', async () => {
    const scraper = new StaatsoperStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const events = await scraper.scrape();
    expect(events.length).toBe(77);
  });

  it('returns events with required fields', async () => {
    const scraper = new StaatsoperStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const [event] = await scraper.scrape();
    expect(event.venue_id).toBe('staatsoper-stuttgart');
    expect(event.title).toBeTruthy();
    expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(event.id).toHaveLength(16);
  });

  it('generates stable IDs across multiple parses', async () => {
    const scraper = new StaatsoperStuttgartScraper({ fetchHtml: async () => fixtureHtml });
    const [a] = await scraper.scrape();
    const [b] = await scraper.scrape();
    expect(a.id).toBe(b.id);
  });
});
