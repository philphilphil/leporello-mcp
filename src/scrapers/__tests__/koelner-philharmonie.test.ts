import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { KoelnerPhilharmonieScraper } from '../koelner-philharmonie.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/koelner-philharmonie.json', import.meta.url), 'utf8'),
);
const scraper = new KoelnerPhilharmonieScraper({ fetchJson: async () => fixtureJson });

describe('KoelnerPhilharmonieScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    // The live feed carries dozens of concerts in the next 90 days; assert a
    // robust lower bound rather than an exact count that breaks on refresh.
    expect(events.length).toBeGreaterThan(10);
  });

  it('extracts date and time correctly', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('does not return past events or events beyond ~90 days', async () => {
    const events = await scraper.scrape();
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + 91 * 86_400_000).toISOString().slice(0, 10);
    for (const e of events) {
      expect(e.date >= today).toBe(true);
      expect(e.date <= cutoff).toBe(true);
    }
  });

  // Field-mapping canary against a controlled input. Fails only if the feed's
  // field names or the mapping logic change — not when the schedule rolls over.
  it('maps name/date/cast/room/slug to the Event fields', () => {
    const events = scraper.parse({
      count: 1,
      next: null,
      results: [
        {
          id: 4736,
          name: 'The Constellation Choir & Orchestra | Sir John Eliot Gardiner',
          date_start: new Date(Date.now() + 7 * 86_400_000)
            .toISOString()
            .replace(/T.*/, 'T20:00:00+02:00'),
          cast_names: 'The Constellation Choir & Orchestra | John Eliot Gardiner',
          room: { name: 'Kölner Philharmonie' },
          slug: { de: 'the-constellation-choir-orchestra-sir-john-eliot-gardiner' },
          status: 'sale',
        },
      ],
    });
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.title).toBe('The Constellation Choir & Orchestra | Sir John Eliot Gardiner');
    expect(e.time).toBe('20:00');
    expect(e.cast).toEqual(['The Constellation Choir & Orchestra', 'John Eliot Gardiner']);
    expect(e.conductor).toBeNull(); // feed exposes no role data — no guessing
    expect(e.location).toBe('Kölner Philharmonie');
    expect(e.url).toBe(
      'https://www.koelner-philharmonie.de/de/konzerte/the-constellation-choir-orchestra-sir-john-eliot-gardiner/4736',
    );
  });

  it('builds absolute detail URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter((e) => e.url !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) {
      expect(e.url).toMatch(/^https:\/\/www\.koelner-philharmonie\.de\/de\/konzerte\/[^/]+\/\d+$/);
    }
  });

  it('populates location (room) for most events', async () => {
    const events = await scraper.scrape();
    const withLocation = events.filter((e) => e.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
  });

  it('sets all 9 Event fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e).toHaveProperty('id');
      expect(e).toHaveProperty('venue_id', 'koelner-philharmonie');
      expect(e).toHaveProperty('title');
      expect(e).toHaveProperty('date');
      expect(e).toHaveProperty('time');
      expect(e).toHaveProperty('conductor');
      expect(e).toHaveProperty('cast');
      expect(e).toHaveProperty('location');
      expect(e).toHaveProperty('url');
      expect(e).toHaveProperty('scraped_at');
    }
  });

  testDbIntegration(scraper);
});
