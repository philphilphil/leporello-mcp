import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { PhilharmonikerStuttgartScraper } from '../philharmoniker-stuttgart.js';

const fixture = readFileSync(new URL('../__fixtures__/philharmoniker-stuttgart.html', import.meta.url), 'utf8');
const scraper = new PhilharmonikerStuttgartScraper({ fetchHtml: async () => fixture });

describe('PhilharmonikerStuttgartScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(37);
  });
});
