import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AuditorioNacionalMadridScraper } from '../auditorio-nacional-madrid.js';
import { testDbIntegration } from './helpers/db-integration.js';

const page1 = readFileSync(new URL('../__fixtures__/auditorio-nacional-madrid.html', import.meta.url), 'utf8');
const page2 = readFileSync(new URL('../__fixtures__/auditorio-nacional-madrid-page2.html', import.meta.url), 'utf8');

// The listing paginates 12 events per page via ?b_start:int=N. Serve page 1 for
// the base URL, page 2 for ?b_start:int=12, and an empty page for anything else
// so the pagination loop terminates the same way it would against the live site.
const emptyPage = '<html><body></body></html>';
const fetchHtml = async (url: string): Promise<string> => {
  if (url.includes('b_start:int=12')) return page2;
  if (url.includes('b_start:int=')) return emptyPage;
  return page1;
};
const scraper = new AuditorioNacionalMadridScraper({ fetchHtml });

describe('AuditorioNacionalMadridScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('paginates across pages and accumulates more than one page of events', async () => {
    const events = await scraper.scrape();
    // Page 1 alone has 12 events; pagination must pull in some of page 2 too.
    expect(events.length).toBeGreaterThan(12);
  });

  it('produces unique event ids across paginated pages', async () => {
    const events = await scraper.scrape();
    const ids = new Set(events.map((e) => e.id));
    expect(ids.size).toBe(events.length);
  });

  it('extracts date and time correctly', async () => {
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('extracts location (hall name)', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
    // Venue has "Sala Sinfónica" and "Sala de Cámara"
    const locations = new Set(withLocation.map(e => e.location));
    expect(locations.size).toBeGreaterThanOrEqual(1);
  });

  it('extracts event URLs', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.url).toMatch(/^https:\/\/auditorionacional\.inaem\.gob\.es\//);
    }
  });

  it('sets all required Event fields', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.venue_id).toBe('auditorio-nacional-madrid');
      expect(event.title).toBeTruthy();
      expect(event.date).toBeTruthy();
      expect(event.scraped_at).toBeTruthy();
      // Optional fields may be null but must exist
      expect('time' in event).toBe(true);
      expect('conductor' in event).toBe(true);
      expect('cast' in event).toBe(true);
      expect('location' in event).toBe(true);
      expect('url' in event).toBe(true);
    }
  });

  testDbIntegration(scraper);
});
