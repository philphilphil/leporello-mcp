import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<unknown[]>;

const API_URL = 'https://www.salzburgerfestspiele.at/vue/calendar/de/events';

/** credit_type_id values in headerEntities */
const CREDIT_COMPOSER = 1;
const CREDIT_CONDUCTOR = 18;

interface SffEvent {
  id: number;
  title: string;
  header: string;           // composer name (or empty)
  link: string | null;
  location: string;
  start: string;            // ISO 8601
  end: string | null;       // ISO 8601
  type: string;             // OPER, KONZERT, SCHAUSPIEL, ...
  rehearsal: boolean;
  headerEntities: Array<{
    credit_type_id: number;
    full_name: string;
  }>;
}

export class SalzburgerFestspieleScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'salzburger-festspielhaus',
    venueName: 'Salzburger Festspiele',
    cityId: 'salzburg',
    cityName: 'Salzburg',
    country: 'AT',
    scheduleUrl: 'https://www.salzburgerfestspiele.at/karten/programm',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchJson?: FetchJson } = {}) {}

  async scrape(): Promise<Event[]> {
    const raw = this.opts.fetchJson
      ? await this.opts.fetchJson()
      : await this.fetchFromApi();
    return this.parse(raw);
  }

  private async fetchFromApi(): Promise<unknown[]> {
    const now = new Date();
    const start = now.toISOString().slice(0, 10) + ' 00:00';
    // Fetch ~4 months ahead (Salzburg summer festival runs Jul–Aug)
    const end = new Date(now.getFullYear(), now.getMonth() + 4, 0);
    const endStr = end.toISOString().slice(0, 10) + ' 23:59';

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ dateRange: [start, endStr], season: 0 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${API_URL}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Expected array from API');
    return data;
  }

  parse(data: unknown[]): Event[] {
    const events: Event[] = [];
    const now = new Date().toISOString();

    for (const item of data) {
      try {
        const e = item as SffEvent;
        if (!e.title || !e.start) continue;
        if (e.rehearsal) continue;

        const date = e.start.slice(0, 10);
        const timeMatch = e.start.match(/T(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        // Composer from header field or credit_type_id=1
        const composer = e.header?.trim()
          || e.headerEntities?.find(h => h.credit_type_id === CREDIT_COMPOSER)?.full_name
          || null;

        // Conductor from credit_type_id=18
        const conductor = e.headerEntities
          ?.find(h => h.credit_type_id === CREDIT_CONDUCTOR)?.full_name ?? null;

        // Clean location: strip HTML tags (some contain <br>)
        const location = e.location
          ? e.location.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
          : null;

        const title = composer ? `${e.title} (${composer})` : e.title;
        const url = e.link ? new URL(e.link, 'https://www.salzburgerfestspiele.at/').href : null;

        events.push({
          id: generateEventId(this.venueId, date, time, e.title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor,
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
