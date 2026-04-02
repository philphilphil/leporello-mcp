import { createHash } from 'node:crypto';
import type { Event } from '../types.js';

export interface Scraper {
  readonly venueId: string;
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
