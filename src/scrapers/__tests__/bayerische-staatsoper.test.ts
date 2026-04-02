import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BayerischeStaatsoperScraper } from '../bayerische-staatsoper.js';

const fixture = readFileSync(new URL('../__fixtures__/bayerische-staatsoper.html', import.meta.url), 'utf8');
const scraper = new BayerischeStaatsoperScraper({ fetchHtml: async () => fixture });

describe('BayerischeStaatsoperScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses date in YYYY-MM-DD format', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('parses time in HH:MM format', async () => {
    const events = await scraper.scrape();
    const withTime = events.filter(e => e.time);
    expect(withTime.length).toBeGreaterThan(0);
    for (const e of withTime) {
      expect(e.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('generates URLs under staatsoper.de', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/www\.staatsoper\.de\/stuecke\//);
    }
  });

  it('includes composer in title when available', async () => {
    const events = await scraper.scrape();
    const withComposer = events.filter(e => e.title.includes('('));
    expect(withComposer.length).toBeGreaterThan(0);
  });

  it('parses location from time/location string', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location);
    expect(withLocation.length).toBeGreaterThan(0);
  });
});
