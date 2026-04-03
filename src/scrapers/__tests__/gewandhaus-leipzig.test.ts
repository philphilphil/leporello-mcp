import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { GewandhausLeipzigScraper } from '../gewandhaus-leipzig.js';

const fixture = readFileSync(new URL('../__fixtures__/gewandhaus-leipzig.html', import.meta.url), 'utf8');
const scraper = new GewandhausLeipzigScraper({ fetchHtml: async () => fixture });

describe('GewandhausLeipzigScraper', () => {
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

  it('extracts conductor when present', async () => {
    const events = await scraper.scrape();
    const withConductor = events.find(e => e.conductor !== null);
    expect(withConductor).toBeDefined();
    expect(withConductor!.conductor).toBeTruthy();
  });

  it('extracts location', async () => {
    const events = await scraper.scrape();
    const withLocation = events.find(e => e.location !== null);
    expect(withLocation).toBeDefined();
  });

  it('builds absolute detail URLs', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      if (e.url) {
        expect(e.url).toMatch(/^https:\/\/www\.gewandhausorchester\.de\//);
      }
    }
  });
});
