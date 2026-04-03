import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TonhalleZuerichScraper } from '../tonhalle-zuerich.js';

const fixture = readFileSync(new URL('../__fixtures__/tonhalle-zuerich.html', import.meta.url), 'utf8');
const scraper = new TonhalleZuerichScraper({ fetchHtml: async () => fixture });

describe('TonhalleZuerichScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses date and time correctly', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.date).toBe('2026-04-03');
    expect(first.time).toBe('16:00');
  });

  it('parses title', async () => {
    const events = await scraper.scrape();
    expect(events[0].title).toBe('Bach: Johannespassion');
  });

  it('extracts conductor from Leitung role', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.conductor).toBe('Joachim Krause');
  });

  it('extracts cast members', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.cast).toContain('Jessica Jans');
    expect(first.cast).toContain('Markus Eiche');
  });

  it('builds absolute URLs', async () => {
    const events = await scraper.scrape();
    expect(events[0].url).toBe('https://tonhalle-orchester.ch/konzerte/kalender/bach-johannespassion-2007635/');
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('tonhalle-zuerich');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e).toHaveProperty('time');
      expect(e).toHaveProperty('conductor');
      expect(e).toHaveProperty('cast');
      expect(e).toHaveProperty('location');
      expect(e).toHaveProperty('url');
      expect(e.scraped_at).toBeTruthy();
    }
  });
});
