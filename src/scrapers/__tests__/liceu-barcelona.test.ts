import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { LiceuBarcelonaScraper } from '../liceu-barcelona.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = JSON.parse(readFileSync(new URL('../__fixtures__/liceu-barcelona.json', import.meta.url), 'utf8'));
const scraper = new LiceuBarcelonaScraper({ fetchJson: async () => fixture });

describe('LiceuBarcelonaScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(368);
  });

  it('includes composer in title', async () => {
    const events = await scraper.scrape();
    const ladyM = events.find(e => e.title.includes('Lady Macbeth'));
    expect(ladyM).toBeDefined();
    expect(ladyM!.title).toContain('Dmitri Xostakóvitx');
  });

  it('parses date and time', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('builds absolute URLs from Catalan paths', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/www\.liceubarcelona\.cat\//);
    }
  });

  it('extracts cast when artists are present', async () => {
    const events = await scraper.scrape();
    const withCast = events.filter(e => e.cast && e.cast.length > 0);
    expect(withCast.length).toBeGreaterThan(0);
    // Verify cast entries are non-empty strings
    for (const e of withCast) {
      for (const name of e.cast!) {
        expect(name.length).toBeGreaterThan(0);
      }
    }
  });

  it('all events have required fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toMatch(/^[0-9a-f]{16}$/);
      expect(e.venue_id).toBe('liceu-barcelona');
      expect(e.title).toBeTruthy();
      expect(e.scraped_at).toBeTruthy();
    }
  });

  testDbIntegration(scraper);
});
