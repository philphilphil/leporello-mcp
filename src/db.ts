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
      location   TEXT,
      url        TEXT,
      scraped_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS events_venue_date ON events(venue_id, date);
  `);

  // Migration: add location column to existing databases
  try {
    db.exec(`ALTER TABLE events ADD COLUMN location TEXT`);
  } catch {
    // column already exists — safe to ignore
  }

}

// ── Query helpers ──────────────────────────────────────────────────────────────

export function getCountries(): Array<{ country: string; city_count: number; venue_count: number }> {
  return getDb().prepare(`
    SELECT c.country, COUNT(DISTINCT c.id) AS city_count, COUNT(v.id) AS venue_count
    FROM cities c
    LEFT JOIN venues v ON v.city_id = c.id
    GROUP BY c.country
    ORDER BY c.country
  `).all() as Array<{ country: string; city_count: number; venue_count: number }>;
}

export function getCities(country?: string): Array<City & { venue_count: number }> {
  const db = getDb();
  if (country) {
    return db.prepare(`
      SELECT c.id, c.name, c.country, COUNT(v.id) AS venue_count
      FROM cities c
      LEFT JOIN venues v ON v.city_id = c.id
      WHERE c.country = ?
      GROUP BY c.id
      ORDER BY c.name
    `).all(country.toUpperCase()) as Array<City & { venue_count: number }>;
  }
  return db.prepare(`
    SELECT c.id, c.name, c.country, COUNT(v.id) AS venue_count
    FROM cities c
    LEFT JOIN venues v ON v.city_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `).all() as Array<City & { venue_count: number }>;
}

export function getVenues(opts?: {
  cityId?: string;
  country?: string;
}): Array<Venue & { city_name: string; country: string }> {
  const db = getDb();
  let sql = `
    SELECT v.*, c.name AS city_name, c.country
    FROM venues v JOIN cities c ON c.id = v.city_id
  `;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.cityId) {
    conditions.push('(v.city_id = ? OR LOWER(c.name) = ?)');
    params.push(opts.cityId, opts.cityId);
  }
  if (opts?.country) {
    conditions.push('c.country = ?');
    params.push(opts.country.toUpperCase());
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY v.name';

  return db.prepare(sql).all(...params) as Array<Venue & { city_name: string; country: string }>;
}

export function getEvents(opts: {
  cityId?: string;
  country?: string;
  venueId?: string;
  daysAhead: number;
}): Array<Event & { venue_name: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const untilDate = new Date();
  untilDate.setDate(untilDate.getDate() + opts.daysAhead);
  const until = untilDate.toISOString().slice(0, 10);

  let sql = `
    SELECT e.*, v.name AS venue_name
    FROM events e
    JOIN venues v ON v.id = e.venue_id
    JOIN cities c ON c.id = v.city_id
    WHERE e.date >= ? AND e.date <= ?
  `;
  const params: unknown[] = [today, until];

  if (opts.venueId) {
    sql += ' AND e.venue_id = ?';
    params.push(opts.venueId);
  } else if (opts.cityId) {
    sql += ' AND (v.city_id = ? OR LOWER(c.name) = ?)';
    params.push(opts.cityId, opts.cityId);
  } else if (opts.country) {
    sql += ' AND c.country = ?';
    params.push(opts.country.toUpperCase());
  }

  sql += " ORDER BY e.date, COALESCE(e.time, '')";

  return getDb().prepare(sql).all(...params) as Array<Event & { venue_name: string }>;
}

export function upsertEvents(events: Event[]): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO events
      (id, venue_id, title, date, time, conductor, cast, location, url, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  getDb().transaction((evts: Event[]) => {
    for (const e of evts) {
      stmt.run(
        e.id, e.venue_id, e.title, e.date, e.time,
        e.conductor,
        e.cast ? JSON.stringify(e.cast) : null,
        e.location,
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

export function upsertCity(id: string, name: string, country: string): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO cities (id, name, country) VALUES (?, ?, ?)`)
    .run(sanitizeId(id), sanitizeText(name), sanitizeCountry(country));
}

export function upsertVenue(
  id: string,
  name: string,
  cityId: string,
  url: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO venues (id, name, city_id, url)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url`,
    )
    .run(sanitizeId(id), sanitizeText(name), sanitizeId(cityId), sanitizeUrl(url));
}

// ── Sanitization helpers ──────────────────────────────────────────────────────

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

function sanitizeId(value: string): string {
  const s = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  if (!s) throw new Error(`Invalid ID: "${value}"`);
  return s;
}

function sanitizeText(value: string): string {
  const s = value.trim().replace(/[\x00-\x1f]/g, '');
  if (!s) throw new Error(`Text must not be empty`);
  return s;
}

function sanitizeCountry(value: string): string {
  const s = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) throw new Error(`Country must be ISO 3166-1 alpha-2, got: "${value}"`);
  return s;
}

function sanitizeUrl(value: string): string {
  const url = new URL(value); // throws on invalid URL
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`URL must be http/https: "${value}"`);
  return url.href;
}
