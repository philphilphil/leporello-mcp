import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { WienerStaatsoperScraper } from '../wiener-staatsoper.js';

const fixture = readFileSync(new URL('../__fixtures__/wiener-staatsoper.html', import.meta.url), 'utf8');
const scraper = new WienerStaatsoperScraper({ fetchHtml: async () => fixture });

describe('WienerStaatsoperScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts conductor and cast', async () => {
    const events = await scraper.scrape();
    const parsifal = events.find(e => e.title.includes('Parsifal'));
    expect(parsifal).toBeDefined();
    expect(parsifal!.conductor).toBe('Axel Kober');
    expect(parsifal!.cast).toContain('Gerald Finley');
  });
});
