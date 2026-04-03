import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BerlinerPhilharmonieBerlinScraper } from '../berliner-philharmonie-berlin.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/berliner-philharmonie-berlin.json', import.meta.url), 'utf8'),
);
const scraper = new BerlinerPhilharmonieBerlinScraper({ fetchJson: async () => fixtureJson });

describe('BerlinerPhilharmonieBerlinScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBe(20);
  });

  it('parses date and time correctly', async () => {
    const events = await scraper.scrape();
    // All events should have valid YYYY-MM-DD dates
    for (const event of events) {
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (event.time) {
        expect(event.time).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });

  it('extracts conductor from artists', async () => {
    const events = await scraper.scrape();
    const withConductor = events.filter(e => e.conductor !== null);
    expect(withConductor.length).toBeGreaterThan(0);
    // Second event (Kirill Petrenko conducting)
    expect(withConductor[0].conductor).toBe('Kirill Petrenko');
  });

  it('extracts cast (soloists) from artists', async () => {
    const events = await scraper.scrape();
    const withCast = events.filter(e => e.cast !== null && e.cast.length > 0);
    expect(withCast.length).toBeGreaterThan(0);
  });

  it('sets all 9 Event fields', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('venue_id', 'berliner-philharmonie-berlin');
      expect(event).toHaveProperty('title');
      expect(event).toHaveProperty('date');
      expect(event).toHaveProperty('time');
      expect(event).toHaveProperty('conductor');
      expect(event).toHaveProperty('cast');
      expect(event).toHaveProperty('location');
      expect(event).toHaveProperty('url');
      expect(event).toHaveProperty('scraped_at');
    }
  });

  it('builds correct detail URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const event of withUrl) {
      expect(event.url).toMatch(/^https:\/\/www\.berliner-philharmoniker\.de\/konzerte\/kalender\/\d+\/$/);
    }
  });

  it('includes location (place)', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter(e => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
  });

  testDbIntegration(scraper);
});
