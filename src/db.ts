import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { City, Venue, Event } from './types.js';

const DB_PATH =
  process.env.DB_PATH ??
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'erda.db');

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cities (
      id      TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      country TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS venues (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      city_id      TEXT NOT NULL REFERENCES cities(id),
      url          TEXT NOT NULL,
      last_scraped TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id         TEXT PRIMARY KEY,
      venue_id   TEXT NOT NULL REFERENCES venues(id),
      title      TEXT NOT NULL,
      date       TEXT NOT NULL,
      time       TEXT,
      conductor  TEXT,
      cast       TEXT,
      url        TEXT,
      scraped_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS events_venue_date ON events(venue_id, date);
  `);

  seedStaticData(db);
}

function seedStaticData(db: Database.Database): void {
  db.prepare(
    `INSERT OR IGNORE INTO cities (id, name, country) VALUES (?, ?, ?)`
  ).run('stuttgart', 'Stuttgart', 'DE');

  const ins = db.prepare(
    `INSERT OR IGNORE INTO venues (id, name, city_id, url) VALUES (?, ?, ?, ?)`
  );
  ins.run('staatsoper-stuttgart', 'Staatsoper Stuttgart', 'stuttgart',
    'https://www.staatsoper-stuttgart.de/spielplan/kalender/');
  ins.run('philharmoniker-stuttgart', 'Stuttgarter Philharmoniker', 'stuttgart',
    'https://www.stuttgarter-philharmoniker.de/konzerte/');
}

// ── Query helpers ──────────────────────────────────────────────────────────────

export function getCities(): Array<City & { venue_count: number }> {
  return getDb().prepare(`
    SELECT c.id, c.name, c.country, COUNT(v.id) AS venue_count
    FROM cities c
    LEFT JOIN venues v ON v.city_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `).all() as Array<City & { venue_count: number }>;
}

export function getVenues(
  cityId?: string,
): Array<Venue & { city_name: string; country: string }> {
  const db = getDb();
  if (cityId) {
    return db.prepare(`
      SELECT v.*, c.name AS city_name, c.country
      FROM venues v JOIN cities c ON c.id = v.city_id
      WHERE v.city_id = ?
      ORDER BY v.name
    `).all(cityId) as Array<Venue & { city_name: string; country: string }>;
  }
  return db.prepare(`
    SELECT v.*, c.name AS city_name, c.country
    FROM venues v JOIN cities c ON c.id = v.city_id
    ORDER BY v.name
  `).all() as Array<Venue & { city_name: string; country: string }>;
}

export function getEvents(opts: {
  cityId?: string;
  venueId?: string;
  daysAhead: number;
}): Array<Event & { venue_name: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + opts.daysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let sql = `
    SELECT e.*, v.name AS venue_name
    FROM events e
    JOIN venues v ON v.id = e.venue_id
    WHERE e.date >= ? AND e.date <= ?
  `;
  const params: unknown[] = [today, until];

  if (opts.venueId) {
    sql += ' AND e.venue_id = ?';
    params.push(opts.venueId);
  } else if (opts.cityId) {
    sql += ' AND v.city_id = ?';
    params.push(opts.cityId);
  }

  sql += " ORDER BY e.date, COALESCE(e.time, '')";

  return getDb().prepare(sql).all(...params) as Array<Event & { venue_name: string }>;
}

export function upsertEvents(events: Event[]): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO events
      (id, venue_id, title, date, time, conductor, cast, url, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  getDb().transaction((evts: Event[]) => {
    for (const e of evts) {
      stmt.run(
        e.id, e.venue_id, e.title, e.date, e.time,
        e.conductor,
        e.cast ? JSON.stringify(e.cast) : null,
        e.url, e.scraped_at,
      );
    }
  })(events);
}

export function updateLastScraped(venueId: string, ts: string): void {
  getDb()
    .prepare(`UPDATE venues SET last_scraped = ? WHERE id = ?`)
    .run(ts, venueId);
}
