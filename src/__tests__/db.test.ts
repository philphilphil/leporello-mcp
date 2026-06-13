import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Event } from '../types.js';

// Each test loads a fresh db module with DB_PATH=':memory:' so the singleton
// is empty and isolated. Seeding uses the public upsert/replace helpers.

type DbModule = typeof import('../db.js');

async function freshDb(): Promise<DbModule> {
  process.env.DB_PATH = ':memory:';
  vi.resetModules();
  return await import('../db.js');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeEvent(overrides: Partial<Event> & { id: string; venue_id: string; date: string }): Event {
  return {
    id: overrides.id,
    venue_id: overrides.venue_id,
    title: overrides.title ?? 'Test concert',
    date: overrides.date,
    time: overrides.time ?? '19:30',
    conductor: overrides.conductor ?? null,
    cast: overrides.cast ?? null,
    location: overrides.location ?? null,
    url: overrides.url ?? 'https://example.com/event',
    scraped_at: overrides.scraped_at ?? new Date().toISOString(),
  };
}

async function seed(db: DbModule): Promise<void> {
  // Two countries, three cities, four venues
  db.upsertCity('stuttgart', 'Stuttgart', 'DE');
  db.upsertCity('berlin', 'Berlin', 'DE');
  db.upsertCity('wien', 'Wien', 'AT');

  db.upsertVenue('staatsoper-stuttgart', 'Staatsoper Stuttgart', 'stuttgart', 'https://example.com/sos');
  db.upsertVenue('philharmoniker-stuttgart', 'Philharmoniker Stuttgart', 'stuttgart', 'https://example.com/phs');
  db.upsertVenue('staatsoper-berlin', 'Staatsoper Berlin', 'berlin', 'https://example.com/sob');
  db.upsertVenue('wiener-staatsoper', 'Wiener Staatsoper', 'wien', 'https://example.com/ws');

  db.updateLastScraped('staatsoper-stuttgart', '2026-04-07T10:00:00.000Z');
  db.updateLastScraped('staatsoper-berlin', '2026-04-07T10:05:00.000Z');
  // philharmoniker-stuttgart and wiener-staatsoper left unscraped → null

  db.replaceVenueEvents('staatsoper-stuttgart', [
    makeEvent({ id: 'sos-1', venue_id: 'staatsoper-stuttgart', date: daysFromNow(1), title: 'Carmen' }),
    makeEvent({ id: 'sos-2', venue_id: 'staatsoper-stuttgart', date: daysFromNow(5), title: 'Tosca' }),
    makeEvent({ id: 'sos-3', venue_id: 'staatsoper-stuttgart', date: daysFromNow(60), title: 'Aida (far future)' }),
  ]);
  db.replaceVenueEvents('staatsoper-berlin', [
    makeEvent({ id: 'sob-1', venue_id: 'staatsoper-berlin', date: daysFromNow(2), title: 'Fidelio' }),
  ]);
  db.replaceVenueEvents('wiener-staatsoper', [
    makeEvent({ id: 'ws-1', venue_id: 'wiener-staatsoper', date: daysFromNow(3), title: 'Die Zauberflöte' }),
  ]);
}

describe('db queries', () => {
  let db: DbModule;

  beforeEach(async () => {
    db = await freshDb();
    await seed(db);
  });

  afterEach(() => {
    db.closeDb();
    delete process.env.DB_PATH;
  });

  describe('getCountries', () => {
    it('returns countries grouped with city and venue counts', () => {
      const countries = db.getCountries();
      expect(countries).toEqual([
        { country: 'AT', city_count: 1, venue_count: 1 },
        { country: 'DE', city_count: 2, venue_count: 3 },
      ]);
    });
  });

  describe('getCities', () => {
    it('returns all cities when no filter is given', () => {
      const cities = db.getCities();
      expect(cities.map((c) => c.id).sort()).toEqual(['berlin', 'stuttgart', 'wien']);
    });

    it('filters by country', () => {
      const cities = db.getCities('DE');
      expect(cities.map((c) => c.id).sort()).toEqual(['berlin', 'stuttgart']);
    });

    it('uppercases country code (case-insensitive filter)', () => {
      const cities = db.getCities('de');
      expect(cities.map((c) => c.id).sort()).toEqual(['berlin', 'stuttgart']);
    });

    it('returns empty for unknown country', () => {
      expect(db.getCities('GB')).toEqual([]);
    });

    it('includes venue_count per city', () => {
      const stuttgart = db.getCities().find((c) => c.id === 'stuttgart');
      expect(stuttgart?.venue_count).toBe(2);
    });
  });

  describe('getVenues', () => {
    it('returns all venues when no filter', () => {
      const venues = db.getVenues();
      expect(venues).toHaveLength(4);
    });

    it('filters by country', () => {
      const venues = db.getVenues({ country: 'AT' });
      expect(venues.map((v) => v.id)).toEqual(['wiener-staatsoper']);
    });

    it('filters by city slug', () => {
      const venues = db.getVenues({ cityId: 'stuttgart' });
      expect(venues.map((v) => v.id).sort()).toEqual([
        'philharmoniker-stuttgart',
        'staatsoper-stuttgart',
      ]);
    });

    it('filters by lowercased city name', () => {
      // getVenues matches v.city_id OR LOWER(c.name) — "wien" is both slug and lowercase name here
      const venues = db.getVenues({ cityId: 'wien' });
      expect(venues.map((v) => v.id)).toEqual(['wiener-staatsoper']);
    });

    it('ANDs country and city filters', () => {
      const venues = db.getVenues({ country: 'DE', cityId: 'stuttgart' });
      expect(venues).toHaveLength(2);
    });

    it('returns empty when country+city combination does not exist', () => {
      // Stuttgart is in DE, not AT
      const venues = db.getVenues({ country: 'AT', cityId: 'stuttgart' });
      expect(venues).toEqual([]);
    });

    it('includes last_scraped and city_name/country', () => {
      const venues = db.getVenues({ cityId: 'stuttgart' });
      const sos = venues.find((v) => v.id === 'staatsoper-stuttgart')!;
      expect(sos.city_name).toBe('Stuttgart');
      expect(sos.country).toBe('DE');
      expect(sos.last_scraped).toBe('2026-04-07T10:00:00.000Z');
    });
  });

  describe('getEvents', () => {
    it('filters to date window [today, today+daysAhead]', () => {
      const events = db.getEvents({ daysAhead: 30 });
      // 4 seeded events total; the daysFromNow(60) one is outside the window
      expect(events.map((e) => e.id).sort()).toEqual(['sob-1', 'sos-1', 'sos-2', 'ws-1']);
    });

    it('includes far-future events when daysAhead is large enough', () => {
      const events = db.getEvents({ daysAhead: 90 });
      expect(events.map((e) => e.id)).toContain('sos-3');
    });

    it('filters by venue_id', () => {
      const events = db.getEvents({ daysAhead: 30, venueId: 'staatsoper-stuttgart' });
      expect(events.map((e) => e.id).sort()).toEqual(['sos-1', 'sos-2']);
    });

    it('filters by city (via city slug)', () => {
      const events = db.getEvents({ daysAhead: 30, cityId: 'stuttgart' });
      expect(events.every((e) => e.venue_id.endsWith('stuttgart'))).toBe(true);
    });

    it('filters by country', () => {
      const events = db.getEvents({ daysAhead: 30, country: 'AT' });
      expect(events.map((e) => e.id)).toEqual(['ws-1']);
    });

    it('venue_id takes precedence over city and country', () => {
      // venueId is Berlin; country=AT would exclude it if applied — precedence check
      const events = db.getEvents({
        daysAhead: 30,
        venueId: 'staatsoper-berlin',
        country: 'AT',
      });
      expect(events.map((e) => e.id)).toEqual(['sob-1']);
    });

    it('orders by date then time', () => {
      const events = db.getEvents({ daysAhead: 30 });
      const dates = events.map((e) => e.date);
      const sorted = [...dates].sort();
      expect(dates).toEqual(sorted);
    });

    it('includes venue_name on each event', () => {
      const events = db.getEvents({ daysAhead: 30, venueId: 'staatsoper-stuttgart' });
      expect(events[0].venue_name).toBe('Staatsoper Stuttgart');
    });

    it('excludes past events', () => {
      db.replaceVenueEvents('philharmoniker-stuttgart', [
        makeEvent({
          id: 'phs-past',
          venue_id: 'philharmoniker-stuttgart',
          date: daysFromNow(-5),
        }),
      ]);
      const events = db.getEvents({ daysAhead: 30 });
      expect(events.map((e) => e.id)).not.toContain('phs-past');
    });
  });

  describe('findUnmatchedFilters', () => {
    it('returns empty object when all filters match', () => {
      expect(db.findUnmatchedFilters({ country: 'DE', city: 'stuttgart' })).toEqual({});
    });

    it('returns empty object when called with no filters', () => {
      expect(db.findUnmatchedFilters({})).toEqual({});
    });

    it('reports unknown country', () => {
      expect(db.findUnmatchedFilters({ country: 'GB' })).toEqual({ country: 'GB' });
    });

    it('matches country case-insensitively', () => {
      expect(db.findUnmatchedFilters({ country: 'de' })).toEqual({});
    });

    it('matches city by slug', () => {
      expect(db.findUnmatchedFilters({ city: 'stuttgart' })).toEqual({});
    });

    it('matches city by name (case-insensitive)', () => {
      expect(db.findUnmatchedFilters({ city: 'Stuttgart' })).toEqual({});
    });

    it('reports unknown city, preserving the original input casing', () => {
      expect(db.findUnmatchedFilters({ city: 'Paris' })).toEqual({ city: 'Paris' });
    });

    it('matches venue by id', () => {
      expect(db.findUnmatchedFilters({ venueId: 'staatsoper-stuttgart' })).toEqual({});
    });

    it('reports unknown venue id', () => {
      expect(db.findUnmatchedFilters({ venueId: 'fake-venue' })).toEqual({ venue_id: 'fake-venue' });
    });

    it('reports multiple unmatched filters at once', () => {
      expect(
        db.findUnmatchedFilters({ country: 'GB', city: 'London', venueId: 'nope' }),
      ).toEqual({ country: 'GB', city: 'London', venue_id: 'nope' });
    });

    it('does not report filters that individually match (combined mismatch is not detected)', () => {
      // Both "AT" and "stuttgart" exist individually, even though Stuttgart is in DE, not AT.
      // Documenting current behavior: per-filter check, not combined.
      expect(db.findUnmatchedFilters({ country: 'AT', city: 'stuttgart' })).toEqual({});
    });
  });
});
