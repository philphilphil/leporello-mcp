import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_PATH =
  process.env.DB_PATH ??
  path.join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'data', 'erda.db');

function openDb(): Database.Database | null {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

export interface City {
  id: string;
  name: string;
  country: string;
  venue_count: number;
}

export interface Venue {
  id: string;
  name: string;
  city_id: string;
  url: string;
  city_name: string;
  country: string;
  last_scraped: string | null;
}

export interface Event {
  id: string;
  venue_id: string;
  venue_name: string;
  title: string;
  date: string;
  time: string | null;
  conductor: string | null;
  cast: string[] | null;
  location: string | null;
  url: string | null;
}

export function getCities(): City[] {
  const db = openDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT c.id, c.name, c.country, COUNT(v.id) AS venue_count
      FROM cities c
      LEFT JOIN venues v ON v.city_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `).all() as City[];
  } finally {
    db.close();
  }
}

export function getVenues(): Venue[] {
  const db = openDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT v.id, v.name, v.city_id, v.url, c.name AS city_name, c.country, v.last_scraped
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      ORDER BY v.name
    `).all() as Venue[];
  } finally {
    db.close();
  }
}

export function getEvents(daysAhead: number = 90): Event[] {
  const db = openDb();
  if (!db) return [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date();
    until.setDate(until.getDate() + daysAhead);
    const untilStr = until.toISOString().slice(0, 10);

    const rows = db.prepare(`
      SELECT e.id, e.venue_id, v.name AS venue_name,
             e.title, e.date, e.time, e.conductor, e.cast, e.location, e.url
      FROM events e
      JOIN venues v ON v.id = e.venue_id
      WHERE e.date >= ? AND e.date <= ?
      ORDER BY e.date, COALESCE(e.time, '')
    `).all(today, untilStr) as Array<Event & { cast: string | null }>;

    return rows.map((r) => ({
      ...r,
      cast: typeof r.cast === 'string' ? JSON.parse(r.cast) : null,
    }));
  } finally {
    db.close();
  }
}
