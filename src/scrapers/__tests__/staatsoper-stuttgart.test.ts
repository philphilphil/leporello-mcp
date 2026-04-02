import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { StaatsoperStuttgartScraper } from '../staatsoper-stuttgart.js';

const fixture = readFileSync(new URL('../__fixtures__/staatsoper-stuttgart.html', import.meta.url), 'utf8');
const scraper = new StaatsoperStuttgartScraper({ fetchHtml: async () => fixture });

describe('StaatsoperStuttgartScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(77);
  });
});
