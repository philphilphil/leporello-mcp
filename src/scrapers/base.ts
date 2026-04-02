import { createHash } from 'node:crypto';
import type { Event } from '../types.js';

export const USER_AGENT = 'Erda/0.1 (classical-music-schedule-aggregator)';

export interface VenueMeta {
  venueId: string;
  venueName: string;
  cityId: string;
  cityName: string;
  country: string; // ISO 3166-1 alpha-2, e.g. "DE"
  scheduleUrl: string;
}

export interface Scraper {
  readonly venue: VenueMeta;
  get venueId(): string;
  scrape(): Promise<Event[]>;
}

/**
 * Derives a stable 16-char hex ID from venue + date + time + title.
 * Stable across scrape runs so upsert works correctly.
 */
export function generateEventId(
  venueId: string,
  date: string,
  time: string | null,
  title: string,
): string {
  const key = `${venueId}:${date}:${time ?? ''}:${title.toLowerCase().trim()}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
