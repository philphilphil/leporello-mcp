import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<JsonApiResponse>;

const BASE_URL = 'https://www.rbo.org.uk';

interface JsonApiResponse {
  data: {
    type: string;
    id: string;
    attributes: Record<string, unknown>;
    relationships?: {
      activities?: { data: { type: string; id: string }[] };
    };
  };
  included: JsonApiResource[];
}

interface JsonApiResource {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: { type: string; id: string } | { type: string; id: string }[] }>;
}

interface CalendarActivity {
  date: string;       // ISO 8601 e.g. "2026-04-01T19:30:00+01:00"
  subtitle: string | null;
  type: string;       // "discrete-activity"
}

interface CalendarEvent {
  sourceType: string;
  title: string;
  slug: string;
  link: string | null;
  location: string | null;
}

export class RoyalOperaHouseLondonScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'royal-opera-house-london',
    venueName: 'Royal Opera House',
    cityId: 'london',
    cityName: 'London',
    country: 'GB',
    scheduleUrl: 'https://www.rbo.org.uk/calendar',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchJson?: FetchJson } = {}) {}

  async scrape(): Promise<Event[]> {
    if (this.opts.fetchJson) {
      const data = await this.opts.fetchJson();
      return this.parse(data);
    }

    // Fetch current month + next 2 months
    const allEvents: Event[] = [];
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const url = `${BASE_URL}/api/calendar?date=${year}-${month}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const data = (await res.json()) as JsonApiResponse;
      allEvents.push(...this.parse(data));
    }

    return allEvents;
  }

  parse(data: JsonApiResponse): Event[] {
    const events: Event[] = [];
    const now = new Date().toISOString();
    const included = data.included ?? [];

    // Build lookup maps from JSON:API included resources
    const eventsMap = new Map<string, CalendarEvent>();
    const locationsMap = new Map<string, string>();

    for (const resource of included) {
      if (resource.type === 'calendarEvent') {
        eventsMap.set(resource.id, resource.attributes as unknown as CalendarEvent);
      } else if (resource.type === 'locations') {
        locationsMap.set(resource.id, (resource.attributes as { title: string }).title);
      }
    }

    // Process each calendarActivity
    for (const resource of included) {
      if (resource.type !== 'calendarActivity') continue;

      try {
        const activity = resource.attributes as unknown as CalendarActivity;
        const eventRef = (resource.relationships?.event as { data: { id: string } })?.data?.id;
        if (!eventRef) continue;

        const calEvent = eventsMap.get(eventRef);
        if (!calEvent) continue;

        const title = calEvent.title;
        if (!title) continue;

        // Parse date and time from ISO 8601 string
        const dateMatch = activity.date.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        if (!dateMatch) continue;

        const date = dateMatch[1];
        const time = dateMatch[2];

        // Resolve location from relationships
        const locRefs = resource.relationships?.locations as { data: { id: string }[] } | undefined;
        const locIds = Array.isArray(locRefs?.data) ? locRefs!.data : [];
        const locationNames = locIds.map(l => locationsMap.get(l.id)).filter(Boolean);
        const location = locationNames.length > 0 ? locationNames[0]! : null;

        // Build URL from slug
        const url = calEvent.slug
          ? `${BASE_URL}/tickets-and-events/${calEvent.slug}`
          : null;

        // Build full title with subtitle if present (e.g. ballet programme details)
        const fullTitle = activity.subtitle
          ? `${title} — ${activity.subtitle}`
          : title;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title: fullTitle,
          date,
          time,
          conductor: null,  // Not available in calendar API
          cast: null,        // Not available in calendar API
          location,
          url,
          scraped_at: now,
        });
      } catch {
        // skip malformed entries silently
      }
    }

    return events;
  }
}
