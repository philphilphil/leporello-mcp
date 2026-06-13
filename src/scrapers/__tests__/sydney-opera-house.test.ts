import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SydneyOperaHouseScraper } from '../sydney-opera-house.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/sydney-opera-house.html', import.meta.url), 'utf8');
const scraper = new SydneyOperaHouseScraper({ fetchHtml: async () => fixture });

describe('SydneyOperaHouseScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    // 15 cards, but multi-date cards expand: "9 & 11 Apr" = 2, "15 – 18 Apr" = 4, etc.
    expect(events.length).toBeGreaterThan(15);
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

  it('expands ampersand dates into separate events', async () => {
    const events = await scraper.scrape();
    // "9 & 11 Apr 2026" → two events
    const mahler = events.filter(e => e.title.includes("Mahler"));
    expect(mahler).toHaveLength(2);
    expect(mahler.map(e => e.date).sort()).toEqual(['2026-04-09', '2026-04-11']);
  });

  it('expands same-month date ranges into separate events', async () => {
    const events = await scraper.scrape();
    // "15 – 18 Apr 2026" → four events
    const tchaikovsky = events.filter(e => e.title.includes("Tchaikovsky"));
    expect(tchaikovsky).toHaveLength(4);
    expect(tchaikovsky.map(e => e.date).sort()).toEqual([
      '2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18',
    ]);
  });

  it('uses start date only for cross-month ranges', async () => {
    const events = await scraper.scrape();
    // "2 Apr – 3 May 2026" → single event with start date
    const phantom = events.filter(e => e.title.includes('Phantom of the Opera'));
    expect(phantom).toHaveLength(1);
    expect(phantom[0].date).toBe('2026-04-02');
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
