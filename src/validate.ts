import type { Event } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9a-f]{16}$/;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateEvents(venueId: string, events: Event[]): ValidationResult {
  const errors: string[] = [];

  if (events.length === 0) {
    errors.push('scraper returned 0 events');
    return { valid: false, errors };
  }

  for (const e of events) {
    if (!ID_RE.test(e.id)) errors.push(`invalid id: "${e.id}"`);
    if (e.venue_id !== venueId) errors.push(`venue_id mismatch: "${e.venue_id}" (expected "${venueId}")`);
    if (!e.title) errors.push(`empty title for event ${e.id}`);
    if (!DATE_RE.test(e.date)) errors.push(`invalid date: "${e.date}" for event ${e.id}`);
  }

  return { valid: errors.length === 0, errors };
}
