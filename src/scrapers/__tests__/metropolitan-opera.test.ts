import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { MetropolitanOperaScraper } from '../metropolitan-opera.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/metropolitan-opera.json', import.meta.url), 'utf8'),
);
const scraper = new MetropolitanOperaScraper({ fetchJson: async () => fixtureJson });

describe('MetropolitanOperaScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(25);
  });

  it('parses conductor and cast', async () => {
    const events = await scraper.scrape();
    expect(events[0].conductor).toBe('Nézet-Séguin');
    expect(events[0].cast).toContain('Davidsen');
  });

  it('includes composer in title', async () => {
    const events = await scraper.scrape();
    expect(events[0].title).toBe('Tristan und Isolde (Richard Wagner)');
  });
});
