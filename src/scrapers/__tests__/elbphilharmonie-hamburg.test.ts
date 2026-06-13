import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ElbphilharmonieHamburgScraper } from '../elbphilharmonie-hamburg.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/elbphilharmonie-hamburg.html', import.meta.url), 'utf8');

// The live page paginates by following a trailing `<li data-url="...">` loader.
// For fixture-based tests we serve the snapshot for the first request and an
// empty page afterwards so pagination terminates deterministically with no network.
function makeScraper() {
  let firstCall = true;
  return new ElbphilharmonieHamburgScraper({
    fetchHtml: async () => {
      if (firstCall) {
        firstCall = false;
        return fixture;
      }
      return '<html><body><ul></ul></body></html>';
    },
  });
}

const scraper = makeScraper();

describe('ElbphilharmonieHamburgScraper', () => {
  it('parses events from fixture', async () => {
    const events = await makeScraper().scrape();
    expect(events.length).toBeGreaterThan(10);
  });

  it('stops paginating instead of looping on the snapshot', async () => {
    // One fixture page holds 15 events; the empty follow-up page yields none.
    const events = await makeScraper().scrape();
    expect(events.length).toBe(15);
  });

  it('extracts date, time, and title correctly', async () => {
    const events = await makeScraper().scrape();
    const organ = events.find(e => e.title.includes('Mari Fukumoto'));
    expect(organ).toBeDefined();
    expect(organ!.date).toBe('2026-06-14');
    expect(organ!.time).toBe('11:00');
  });

  it('extracts location with building and hall', async () => {
    const events = await makeScraper().scrape();
    const grosserSaal = events.find(e => e.location?.includes('Großer Saal'));
    expect(grosserSaal).toBeDefined();
    expect(grosserSaal!.location).toMatch(/^(Elbphilharmonie|Laeiszhalle) Großer Saal$/);
  });

  it('includes Laeiszhalle events', async () => {
    const events = await makeScraper().scrape();
    const laeiszhalle = events.find(e => e.location?.startsWith('Laeiszhalle'));
    expect(laeiszhalle).toBeDefined();
  });

  it('extracts cast from subtitle with slashes', async () => {
    const events = await makeScraper().scrape();
    const junge = events.find(e => e.title.includes('Junge Symphoniker'));
    expect(junge).toBeDefined();
    expect(junge!.cast).toContain('Zemlinsky');
  });

  it('deduplicates events by id', async () => {
    const events = await makeScraper().scrape();
    const ids = events.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sets URL for each event', async () => {
    const events = await makeScraper().scrape();
    for (const event of events) {
      expect(event.url).toMatch(/^https:\/\/www\.elbphilharmonie\.de\/de\/programm\//);
    }
  });

  it('has all required Event fields', async () => {
    const events = await makeScraper().scrape();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.venue_id).toBe('elbphilharmonie-hamburg');
      expect(event.title).toBeTruthy();
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.scraped_at).toBeTruthy();
    }
  });

  testDbIntegration(scraper);
});
