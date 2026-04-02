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
});
