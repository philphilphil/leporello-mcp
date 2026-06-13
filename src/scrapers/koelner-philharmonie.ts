import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<EventsResponse>;

const BASE_URL = 'https://www.koelner-philharmonie.de';
const API_URL = `${BASE_URL}/de/api/events/`;
// The feed is paginated (~10 events/page) and runs ~13 months ahead. Stop once
// events pass the ~90-day window we care about; MAX_PAGES is a hard safety cap.
const MAX_PAGES = 20;
const DAYS_AHEAD = 90;

interface ApiEvent {
  id: number;
  name: string;
  date_start: string; // ISO 8601 with offset, e.g. "2026-06-13T20:00:00+02:00"
  cast_names: string | null; // pipe-separated performers, e.g. "Ensemble | Conductor"
  room: { name: string } | null;
  slug: { de: string } | null;
  status: string | null; // "sale" | "soldout" | "past" | ...
}

interface EventsResponse {
  count: number;
  next: string | null;
  results: ApiEvent[];
}

export class KoelnerPhilharmonieScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'koelner-philharmonie',
    venueName: 'Kölner Philharmonie',
    cityId: 'koeln',
    cityName: 'Köln',
    country: 'DE',
    scheduleUrl: 'https://www.koelner-philharmonie.de/de/konzerte',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchJson?: FetchJson } = {}) {}

  async scrape(): Promise<Event[]> {
    const data = this.opts.fetchJson
      ? await this.opts.fetchJson()
      : await this.fetchFromApi();
    return this.parse(data);
  }

  private async fetchFromApi(): Promise<EventsResponse> {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + DAYS_AHEAD * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const all: ApiEvent[] = [];
    let count = 0;
    // Results are returned in ascending date order, so we can stop paging once a
    // page's last event is past the cutoff.
    let url: string | null = `${API_URL}?date=${today}&page=1`;

    for (let page = 0; page < MAX_PAGES && url; page++) {
      const res: Response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const json = (await res.json()) as EventsResponse;
      count = json.count;
      all.push(...json.results);

      const lastDate = json.results.at(-1)?.date_start?.slice(0, 10);
      if (lastDate && lastDate > cutoff) break;
      url = json.next;
    }

    return { count, next: null, results: all };
  }

  parse(data: EventsResponse): Event[] {
    const events: Event[] = [];
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const cutoffMs = nowMs + DAYS_AHEAD * 86_400_000;

    for (const ev of data.results ?? []) {
      try {
        const title = ev.name?.trim();
        if (!title || !ev.date_start) continue;

        const start = new Date(ev.date_start);
        const startMs = start.getTime();
        if (Number.isNaN(startMs)) continue;

        // Drop events in the past or beyond the ~90-day window.
        if (startMs < nowMs || startMs > cutoffMs) continue;

        // date_start carries an explicit offset; derive the local Köln wall-clock
        // date/time straight from the ISO string to avoid TZ drift.
        const m = ev.date_start.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
        if (!m) continue;
        const date = `${m[1]}-${m[2]}-${m[3]}`;
        const time = `${m[4]}:${m[5]}`;

        // cast_names is a flat pipe-separated list with no role markers, so we
        // cannot reliably tell a conductor from a soloist. Put everyone in cast
        // and leave conductor null rather than guessing (and mislabeling soloist
        // recitals).
        let cast: string[] | null = null;
        if (ev.cast_names) {
          const parts = ev.cast_names.split('|').map((s) => s.trim()).filter(Boolean);
          cast = parts.length > 0 ? parts : null;
        }

        const location = ev.room?.name?.trim() || null;

        const slug = ev.slug?.de;
        const url = slug
          ? new URL(`/de/konzerte/${slug}/${ev.id}`, BASE_URL + '/').href
          : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor: null,
          cast,
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

export default new KoelnerPhilharmonieScraper();
