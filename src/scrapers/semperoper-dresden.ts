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

/** Included venues considered part of Semperoper operations. */
const INCLUDED_VENUES = new Set(Object.keys(VENUE_LOCATIONS));

/**
 * Derives a URL slug from a title using the same rules as the Semperoper website:
 * strip leading articles, transliterate German umlauts, remove punctuation, spaces → hyphens.
 * Used as a fallback for productions not yet rendered in the page's anchor links.
 */
function titleToSlug(title: string): string {
  return title
    .replace(/^(Die|Der|Das|Ein|Eine|La|Le|Les|L'|Il|Lo|Gli|I|The|A|An)\s+/i, '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

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

    // Build sostuid → slug map from rendered anchor links (authoritative)
    const $ = load(html);
    const slugBySostuid = new Map<number, string>();
    $('a[href*="/spielplan/stuecke/stid/"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const m = href.match(/\/spielplan\/stuecke\/stid\/([^/]+)\/(\d+)\.html/);
      if (m) slugBySostuid.set(Number(m[2]), m[1]);
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

        const slug = slugBySostuid.get(entry.sostuid ?? -1)
          ?? titleToSlug(entry.st_title ?? '');
        const url = slug && entry.sostuid && entry.sospuid
          ? `https://www.semperoper.de/spielplan/stuecke/stid/${slug}/${entry.sostuid}.html#a_${entry.sospuid}`
          : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
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
