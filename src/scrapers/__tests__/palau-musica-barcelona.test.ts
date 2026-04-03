import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PalauMusicaBarcelonaScraper } from '../palau-musica-barcelona.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = JSON.parse(readFileSync(new URL('../__fixtures__/palau-musica-barcelona.json', import.meta.url), 'utf8'));
const scraper = new PalauMusicaBarcelonaScraper({ fetchJson: async () => fixture });

describe('PalauMusicaBarcelonaScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('palau-musica-barcelona');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time).toMatch(/^\d{2}:\d{2}$/);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  it('parses location from stage data', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
    expect(withLocation[0].location).toBeTruthy();
  });

  it('parses conductor when available', async () => {
    const events = await scraper.scrape();
    const withConductor = events.filter(e => e.conductor !== null);
    expect(withConductor.length).toBeGreaterThan(0);
  });

  it('includes event URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    expect(withUrl[0].url).toMatch(/^https:\/\/www\.palaumusica\.cat\//);
  });

  testDbIntegration(scraper);
});
