import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { LiceuBarcelonaScraper } from '../liceu-barcelona.js';

const fixture = JSON.parse(readFileSync(new URL('../__fixtures__/liceu-barcelona.json', import.meta.url), 'utf8'));
const scraper = new LiceuBarcelonaScraper({ fetchJson: async () => fixture });

describe('LiceuBarcelonaScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(230);
  });
});
