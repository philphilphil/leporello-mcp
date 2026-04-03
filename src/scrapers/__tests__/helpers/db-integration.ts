import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import type { Scraper } from '../../base.js';
import type { Event } from '../../../types.js';

/**
 * Shared integration test: parses the fixture, checks for duplicate IDs,
 * and inserts all events into an in-memory SQLite DB to catch PK/FK violations.
 *
 * Usage inside a scraper test's describe() block:
 *   testDbIntegration(scraper);
 */
export function testDbIntegration(scraper: Scraper): void {
  describe('db integration', () => {
    let events: Event[];

    it('has no duplicate event IDs', async () => {
      events = await scraper.scrape();
      const ids = events.map(e => e.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `duplicate IDs: ${[...new Set(dupes)].join(', ')}`).toHaveLength(0);
    });

    it('inserts all events into SQLite without errors', () => {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');

      db.exec(`
        CREATE TABLE cities (
          id      TEXT PRIMARY KEY,
          name    TEXT NOT NULL,
          country TEXT NOT NULL
        );
        CREATE TABLE venues (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          city_id      TEXT NOT NULL REFERENCES cities(id),
          url          TEXT NOT NULL,
          last_scraped TEXT
        );
        CREATE TABLE events (
          id         TEXT PRIMARY KEY,
          venue_id   TEXT NOT NULL REFERENCES venues(id),
          title      TEXT NOT NULL,
          date       TEXT NOT NULL,
          time       TEXT,
          conductor  TEXT,
          cast       TEXT,
          location   TEXT,
          url        TEXT,
          scraped_at TEXT NOT NULL
        );
      `);

      const { venueId, venueName, cityId, cityName, country, scheduleUrl } = scraper.venue;

      db.prepare('INSERT INTO cities (id, name, country) VALUES (?, ?, ?)').run(cityId, cityName, country);
      db.prepare('INSERT INTO venues (id, name, city_id, url) VALUES (?, ?, ?, ?)').run(venueId, venueName, cityId, scheduleUrl);

      const ins = db.prepare(`
        INSERT INTO events (id, venue_id, title, date, time, conductor, cast, location, url, scraped_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      db.transaction((evts: Event[]) => {
        for (const e of evts) {
          ins.run(
            e.id, e.venue_id, e.title, e.date, e.time,
            e.conductor,
            e.cast ? JSON.stringify(e.cast) : null,
            e.location, e.url, e.scraped_at,
          );
        }
      })(events);

      const count = db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
      expect(count.n).toBe(events.length);

      db.close();
    });
  });
}
