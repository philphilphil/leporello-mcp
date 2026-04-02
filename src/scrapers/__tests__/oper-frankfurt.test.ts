import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { OperFrankfurtScraper } from '../oper-frankfurt.js';

const fixture = readFileSync(new URL('../__fixtures__/oper-frankfurt.html', import.meta.url), 'utf8');
const scraper = new OperFrankfurtScraper({ fetchHtml: async () => fixture });

describe('OperFrankfurtScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(46);
  });

  it('generates URLs under the season-calendar path', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/oper-frankfurt\.de\/de\/spielplan\//);
    }
  });
});
