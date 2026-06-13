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
    // The live feed carries hundreds of events; assert a robust lower bound
    // rather than an exact count that breaks on every fixture refresh.
    expect(events.length).toBeGreaterThan(50);
  });

  it('parses events that have super_title but no title (e.g. Lunchkonzert)', () => {
    // The feed delivers some events (free lunch concerts) with an empty
    // `title` but a populated `super_title`. They must not be dropped — the
    // parser already falls back to super_title when building the title.
    const events = scraper.parse({
      found: 1,
      hits: [
        {
          document: {
            title: '',
            super_title: 'Lunchkonzert',
            place: 'Foyer Großer Saal',
            detail_url: '/konzerte/kalender/99999/',
            time_start: 1788346800,
            time_start_formatted: '13.00 Uhr',
            date_string: '',
            artists: [],
            works_overview_formatted: '',
            is_guest_event: false,
          },
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Lunchkonzert');
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
    // Conductor is a non-empty string (avoid asserting a specific name, which
    // changes whenever the schedule does).
    expect(typeof withConductor[0].conductor).toBe('string');
    expect((withConductor[0].conductor as string).length).toBeGreaterThan(0);
  });

  // Field-mapping canary: exact values against a controlled input. Unlike the
  // live fixture (whose contents roll forward with the schedule), this fails
  // only if the artist-role mapping logic or the feed's field names change —
  // not when the venue simply reschedules concerts.
  it('maps the Dirigent/-in role to conductor and other soloists to cast', () => {
    const events = scraper.parse({
      found: 1,
      hits: [
        {
          document: {
            title: 'Testkonzert',
            super_title: '',
            place: 'Großer Saal',
            detail_url: '/konzerte/kalender/12345/',
            time_start: 1788346800,
            time_start_formatted: '20.00 Uhr',
            date_string: '',
            works_overview_formatted: '',
            is_guest_event: false,
            artists: [
              { name: 'Jane Conductor', role: 'Dirigentin' },
              { name: 'Sam Soloist', role: 'Violine' },
              { name: 'The Orchestra', role: 'Orchester' },
            ],
          },
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0].conductor).toBe('Jane Conductor');
    expect(events[0].cast).toEqual(['Sam Soloist']); // soloist in, orchestra out
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
