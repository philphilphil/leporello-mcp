import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ElbphilharmonieHamburgScraper } from '../elbphilharmonie-hamburg.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixture = readFileSync(new URL('../__fixtures__/elbphilharmonie-hamburg.html', import.meta.url), 'utf8');
const scraper = new ElbphilharmonieHamburgScraper({ fetchHtml: async () => fixture });

describe('ElbphilharmonieHamburgScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date, time, and title correctly', async () => {
    const events = await scraper.scrape();
    const bach = events.find(e => e.title.includes('Matthäus-Passion'));
    expect(bach).toBeDefined();
    expect(bach!.date).toBe('2026-04-02');
    expect(bach!.time).toBe('19:00');
  });

  it('extracts location with building and hall', async () => {
    const events = await scraper.scrape();
    const grosserSaal = events.find(e => e.location?.includes('Großer Saal'));
    expect(grosserSaal).toBeDefined();
    expect(grosserSaal!.location).toMatch(/^(Elbphilharmonie|Laeiszhalle) Großer Saal$/);
  });

  it('includes Laeiszhalle events', async () => {
    const events = await scraper.scrape();
    const laeiszhalle = events.find(e => e.location?.startsWith('Laeiszhalle'));
    expect(laeiszhalle).toBeDefined();
  });

  it('extracts cast from subtitle with slashes', async () => {
    const events = await scraper.scrape();
    const gondwana = events.find(e => e.title.includes('Gondwana'));
    expect(gondwana).toBeDefined();
    expect(gondwana!.cast).toContain('Chip Wickham');
  });

  it('sets URL for each event', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.url).toMatch(/^https:\/\/www\.elbphilharmonie\.de\/de\/programm\//);
    }
  });

  it('has all required Event fields', async () => {
    const events = await scraper.scrape();
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
