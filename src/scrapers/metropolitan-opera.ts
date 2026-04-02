import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<unknown[]>;

const API_BASE = 'https://www.metopera.org/api/v1/calendar/events';
const SITE_BASE = 'https://www.metopera.org';

interface MetOperaEvent {
  title: string;
  composer: string | null;
  cast: string | null;
  eventDateTime: string;
  eventUrl: string | null;
  eventType: string;
}

export class MetropolitanOperaScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'metropolitan-opera',
    venueName: 'Metropolitan Opera',
    cityId: 'new-york',
    cityName: 'New York',
    country: 'US',
    scheduleUrl: 'https://www.metopera.org/calendar/',
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
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      const url = `${API_BASE}?month=${month}&year=${year}&eventType=on-stage`;
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
        const e = item as MetOperaEvent;
        if (!e.title || !e.eventDateTime) continue;
        if (e.eventType !== 'performance') continue;

        const date = e.eventDateTime.slice(0, 10);
        const timeMatch = e.eventDateTime.match(/T(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        // Cast string: "Conductor; Singer1, Singer2, ..."
        let conductor: string | null = null;
        let cast: string[] | null = null;
        if (e.cast) {
          const parts = e.cast.split(';').map(s => s.trim());
          if (parts.length >= 2) {
            conductor = parts[0];
            cast = parts[1].split(',').map(s => s.trim()).filter(Boolean);
          } else {
            cast = e.cast.split(',').map(s => s.trim()).filter(Boolean);
          }
        }

        const url = e.eventUrl ? new URL(e.eventUrl, SITE_BASE).href : null;

        const title = e.composer ? `${e.title} (${e.composer})` : e.title;

        events.push({
          id: generateEventId(this.venueId, date, time, e.title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor,
          cast: cast && cast.length > 0 ? cast : null,
          location: null,
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
