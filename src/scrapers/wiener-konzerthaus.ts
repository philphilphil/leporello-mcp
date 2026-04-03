import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<ApiResponse>;

const BASE_URL = 'https://konzerthaus.at';
const API_URL = `${BASE_URL}/de/api/events/`;
const PAGE_SIZE = 50;
const MAX_PAGES = 6; // 300 events max

interface ApiEvent {
  id: number;
  name: string;
  pretitle: string | null;
  subtitle: string | null;
  date_start: string;
  date_end: string | null;
  room: { id: number; name: string } | null;
  slug: { de: string; en: string };
  has_casts: boolean;
}

interface ApiResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: ApiEvent[];
}

export class WienerKonzerthausScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'wiener-konzerthaus',
    venueName: 'Wiener Konzerthaus',
    cityId: 'wien',
    cityName: 'Wien',
    country: 'AT',
    scheduleUrl: 'https://konzerthaus.at/de/programm-und-karten',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchJson?: FetchJson } = {}) {}

  async scrape(): Promise<Event[]> {
    if (this.opts.fetchJson) {
      const data = await this.opts.fetchJson();
      return this.parse(data);
    }

    const allEvents: Event[] = [];
    const today = new Date().toISOString().slice(0, 10);
    let url: string | null = `${API_URL}?date=${today}&page=1&page_size=${PAGE_SIZE}`;

    for (let page = 0; page < MAX_PAGES && url; page++) {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const data: ApiResponse = await res.json();
      allEvents.push(...this.parse(data));
      url = data.next;
    }

    return allEvents;
  }

  parse(data: ApiResponse): Event[] {
    const events: Event[] = [];
    const now = new Date().toISOString();

    for (const item of data.results) {
      try {
        const title = item.name?.trim();
        if (!title) continue;

        // date_start is ISO 8601 with timezone, e.g. "2026-04-07T19:30:00+02:00"
        const date = item.date_start.slice(0, 10);
        const timeMatch = item.date_start.match(/T(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        const location = item.room?.name ?? null;

        // Build event detail URL from slug
        const slug = item.slug?.de;
        const url = slug && item.id
          ? `${BASE_URL}/de/programm-und-karten/${slug}/${item.id}`
          : null;

        events.push({
          id: generateEventId(this.venueId, date, time, `${title}-${item.id}`),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor: null,
          cast: null,
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
