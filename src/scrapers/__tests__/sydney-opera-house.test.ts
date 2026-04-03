import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SydneyOperaHouseScraper } from '../sydney-opera-house.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/sydney-opera-house.html', import.meta.url), 'utf8');
const scraper = new SydneyOperaHouseScraper({ fetchHtml: async () => fixture });

describe('SydneyOperaHouseScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts event title and date', async () => {
    const events = await scraper.scrape();
    const bach = events.find(e => e.title.includes('St John Passion'));
    expect(bach).toBeDefined();
    expect(bach!.date).toBe('2026-04-04');
  });

  it('extracts venue location within SOH', async () => {
    const events = await scraper.scrape();
    const bach = events.find(e => e.title.includes('St John Passion'));
    expect(bach).toBeDefined();
    expect(bach!.location).toBe('Concert Hall');
  });

  it('extracts event URL', async () => {
    const events = await scraper.scrape();
    const phantom = events.find(e => e.title.includes('Phantom of the Opera'));
    expect(phantom).toBeDefined();
    expect(phantom!.url).toContain('sydneyoperahouse.com');
  });

  it('parses date ranges correctly', async () => {
    const events = await scraper.scrape();
    // "30 Mar – 16 May 2026" → start date 2026-03-30
    const river = events.find(e => e.title === 'The River');
    expect(river).toBeDefined();
    expect(river!.date).toBe('2026-03-30');
  });

  it('parses ampersand dates correctly', async () => {
    const events = await scraper.scrape();
    // "5 & 6 Apr 2026" → start date 2026-04-05
    const pogues = events.find(e => e.title === 'The Pogues');
    expect(pogues).toBeDefined();
    expect(pogues!.date).toBe('2026-04-05');
  });

  it('sets time, conductor and cast to null', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.time).toBeNull();
      expect(e.conductor).toBeNull();
      expect(e.cast).toBeNull();
    }
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('sydney-opera-house');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  testDbIntegration(scraper);
});
