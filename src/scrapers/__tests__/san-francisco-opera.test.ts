import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SanFranciscoOperaScraper } from '../san-francisco-opera.js';

const fixture = JSON.parse(readFileSync(new URL('../__fixtures__/san-francisco-opera.json', import.meta.url), 'utf8'));
const scraper = new SanFranciscoOperaScraper({ fetchJson: async () => fixture });

describe('SanFranciscoOperaScraper', () => {
  it('parses expected events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBe(27);
  });

  it('includes composer in title', async () => {
    const events = await scraper.scrape();
    expect(events[0].title).toBe('The Barber of Seville (Gioachino Rossini)');
  });

  it('parses date and time from ISO string', async () => {
    const events = await scraper.scrape();
    expect(events[0].date).toBe('2026-05-28');
    expect(events[0].time).toBe('19:30');
  });

  it('resolves detail URL against site base', async () => {
    const events = await scraper.scrape();
    expect(events[0].url).toBe('https://www.sfopera.com/operas/the-barber-of-seville/');
  });

  it('includes location from API response', async () => {
    const events = await scraper.scrape();
    expect(events[0].location).toBe('War Memorial Opera House');
  });

  it('sets conductor and cast to null', async () => {
    const events = await scraper.scrape();
    expect(events[0].conductor).toBeNull();
    expect(events[0].cast).toBeNull();
  });
});
