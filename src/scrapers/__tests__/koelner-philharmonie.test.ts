import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { KoelnerPhilharmonieScraper } from '../koelner-philharmonie.js';

const fixture = readFileSync(new URL('../__fixtures__/koelner-philharmonie.html', import.meta.url), 'utf8');
const scraper = new KoelnerPhilharmonieScraper({ fetchHtml: async () => fixture });

describe('KoelnerPhilharmonieScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date and time correctly', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('extracts conductor from pipe-separated subtitle', async () => {
    const events = await scraper.scrape();
    const passion = events.find(e => e.title === 'Johannes-Passion');
    expect(passion).toBeDefined();
    expect(passion!.conductor).toBe('Andrea Marcon');
    expect(passion!.cast).toContain('La Cetra Vokalensemble');
    expect(passion!.cast).toContain('Gürzenich-Orchester Köln');
  });

  it('builds absolute URLs', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      if (e.url) {
        expect(e.url).toMatch(/^https:\/\/www\.koelner-philharmonie\.de\//);
      }
    }
  });
});
