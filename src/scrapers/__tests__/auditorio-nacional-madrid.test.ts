import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AuditorioNacionalMadridScraper } from '../auditorio-nacional-madrid.js';

const fixture = readFileSync(new URL('../__fixtures__/auditorio-nacional-madrid.html', import.meta.url), 'utf8');
const scraper = new AuditorioNacionalMadridScraper({ fetchHtml: async () => fixture });

describe('AuditorioNacionalMadridScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
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
});
