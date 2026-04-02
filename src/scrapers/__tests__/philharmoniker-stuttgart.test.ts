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

  it('extracts conductor from "unter der Leitung von"', async () => {
    const events = await scraper.scrape();
    const withConductor = events.filter((e) => e.conductor);
    expect(withConductor.length).toBeGreaterThan(0);
    expect(withConductor[0].conductor).toBe('Nicolò Foron');
  });

  it('strips title prefixes from conductor name', async () => {
    const events = await scraper.scrape();
    const holly = events.find((e) => e.conductor?.includes('Holly'));
    expect(holly?.conductor).toBe('Holly Hyun Choe');
  });

  it('extracts cast from "mit" clause', async () => {
    const events = await scraper.scrape();
    const withCast = events.filter((e) => e.cast);
    expect(withCast.length).toBeGreaterThan(0);
    expect(withCast[0].cast).toContain('Clayton Stephenson');
  });
});
