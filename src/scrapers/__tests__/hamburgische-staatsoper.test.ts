import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { HamburgischeStaatsoperScraper } from '../hamburgische-staatsoper.js';

const fixture = readFileSync(new URL('../__fixtures__/hamburgische-staatsoper.html', import.meta.url), 'utf8');
const scraper = new HamburgischeStaatsoperScraper({ fetchHtml: async () => fixture });

describe('HamburgischeStaatsoperScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date in YYYY-MM-DD format', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('extracts time in HH:MM format', async () => {
    const events = await scraper.scrape();
    const withTime = events.filter(e => e.time !== null);
    expect(withTime.length).toBeGreaterThan(0);
    for (const e of withTime) {
      expect(e.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('extracts conductor and cast', async () => {
    const events = await scraper.scrape();
    const lohengrin = events.find(e => e.title.includes('Lohengrin'));
    expect(lohengrin).toBeDefined();
    expect(lohengrin!.conductor).toBe('Omer Meir Wellber');
    expect(lohengrin!.cast).toContain('Klaus Florian Vogt');
  });

  it('includes composer in title', async () => {
    const events = await scraper.scrape();
    const withComposer = events.find(e => e.title.includes('('));
    expect(withComposer).toBeDefined();
    // e.g. "Die große Stille (Wolfgang Amadeus Mozart)"
    expect(withComposer!.title).toMatch(/.+\(.+\)/);
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('hamburgische-staatsoper');
      expect(e.title).toBeTruthy();
      expect(e.date).toBeTruthy();
      expect(e.scraped_at).toBeTruthy();
      // Optional fields must be present (null is fine)
      expect(e).toHaveProperty('time');
      expect(e).toHaveProperty('conductor');
      expect(e).toHaveProperty('cast');
      expect(e).toHaveProperty('location');
      expect(e).toHaveProperty('url');
    }
  });
});
