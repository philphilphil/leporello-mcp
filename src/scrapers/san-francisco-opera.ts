import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<unknown[]>;

const API_BASE = 'https://www.sfopera.com/ace-api/events';
const SITE_BASE = 'https://www.sfopera.com';

interface SfOperaEvent {
  name: string;
  composerInfo: string | null;
  eventDate: string;
  eventTimeString: string | null;
  location: string | null;
  viewDetailCtaUrl: string | null;
  eventType: string | null;
  hideFromCalendar: boolean;
}

export class SanFranciscoOperaScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'san-francisco-opera',
    venueName: 'San Francisco Opera',
    cityId: 'san-francisco',
    cityName: 'San Francisco',
    country: 'US',
    scheduleUrl: 'https://www.sfopera.com/calendar/',
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
    const results: unknown[] = [];

    // Fetch current month + next 2 months
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const startDate = d.toISOString().slice(0, 10);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const endDate = end.toISOString().slice(0, 10);
      const url = `${API_BASE}?startDate=${startDate}&endDate=${endDate}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const data = await res.json();
      if (Array.isArray(data)) results.push(...data);
    }

    return results;
  }

  parse(data: unknown[]): Event[] {
    const events: Event[] = [];
    const now = new Date().toISOString();

    for (const item of data) {
      try {
        const e = item as SfOperaEvent;
        if (e.hideFromCalendar) continue;
        if (!e.name || !e.eventDate) continue;

        const date = e.eventDate.slice(0, 10);
        const timeMatch = e.eventDate.match(/T(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        const title = e.composerInfo ? `${e.name} (${e.composerInfo})` : e.name;
        const url = e.viewDetailCtaUrl ? new URL(e.viewDetailCtaUrl, SITE_BASE).href : null;

        events.push({
          id: generateEventId(this.venueId, date, time, e.name),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor: null,
          cast: null,
          location: e.location ?? null,
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
