import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

/** Map venue codes from the schedule JSON to readable location names. */
const VENUE_LOCATIONS: Record<string, string> = {
  'SSO,SSO2': 'Semperoper',
  'SEMPER2': 'Semper Zwei',
  'Rundfoyer,FOYER': 'Rundfoyer',
  'Opernkeller': 'Opernkeller',
  'Kleiner_Ballettsaal': 'Kleiner Ballettsaal',
};

/** Venues considered part of Semperoper operations. */
const INCLUDED_VENUES = new Set(Object.keys(VENUE_LOCATIONS));

interface ScheduleEntry {
  sostuid?: number;
  sospuid?: number;
  st_title?: string;
  datum_uhrzeit?: number;
  venue?: string | null;
  hausclass?: string | null;
  premiere?: number;
  genre?: number;
}

export class SemperoperDresdenScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'semperoper-dresden',
    venueName: 'Semperoper',
    cityId: 'dresden',
    cityName: 'Dresden',
    country: 'DE',
    scheduleUrl: 'https://www.semperoper.de/spielplan.html',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    const html = this.opts.fetchHtml
      ? await this.opts.fetchHtml()
      : await fetch(this.venue.scheduleUrl, {
          headers: { 'User-Agent': USER_AGENT },
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} from ${this.venue.scheduleUrl}`);
          return r.text();
        });
    return this.parse(html);
  }

  parse(html: string): Event[] {
    const match = html.match(/document\.NIS__SCHEDULE\s*=\s*(\[.*?\]);/s);
    if (!match) return [];

    let schedule: ScheduleEntry[];
    try {
      schedule = JSON.parse(match[1]);
    } catch {
      return [];
    }

    // Build sospuid → detail URL map from the rendered anchor links
    const $ = load(html);
    const urlBySospuid = new Map<number, string>();
    $('a[href*="#a_"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const m = href.match(/#a_(\d+)$/);
      if (m) urlBySospuid.set(Number(m[1]), href);
    });

    const events: Event[] = [];
    const now = new Date().toISOString();

    for (const entry of schedule) {
      try {
        const title = entry.st_title;
        const timestamp = entry.datum_uhrzeit;
        if (!title || !timestamp) continue;

        // Filter to Semperoper venues only
        const venueCode = entry.venue ?? '';
        if (!INCLUDED_VENUES.has(venueCode)) continue;

        const dt = new Date(timestamp * 1000);
        // Convert UTC timestamp to Europe/Berlin local time
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Berlin',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
          hour12: false,
        }).formatToParts(dt);
        const p = (type: string) => parts.find(x => x.type === type)?.value ?? '';
        const date = `${p('year')}-${p('month')}-${p('day')}`;
        const time = `${p('hour')}:${p('minute')}`;

        const location = VENUE_LOCATIONS[venueCode] ?? null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor: null,
          cast: null,
          location,
          url: urlBySospuid.get(entry.sospuid ?? -1) ?? null,
          scraped_at: now,
        });
      } catch {
        // skip malformed entries silently
      }
    }

    return events;
  }
}
