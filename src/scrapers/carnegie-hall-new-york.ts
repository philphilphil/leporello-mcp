import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<unknown[]>;

const ALGOLIA_URL = 'https://q0tmlopf1j-dsn.algolia.net/1/indexes/*/queries';
const ALGOLIA_APP_ID = 'Q0TMLOPF1J';
const ALGOLIA_API_KEY = 'd2d2b382f2659c44ef8927aad7a24172';
const SITE_BASE = 'https://www.carnegiehall.org';

interface CarnegieHallEvent {
  title: string;
  date: string;
  time: string;
  startdate: number;
  url: string | null;
  facility: string | null;
  webdisplayperformers: string | null;
  subtitle: string | null;
}

/**
 * Parse the "time" field from Carnegie Hall (e.g. "7 PM", "7:30 PM", "10 AM")
 * into 24-hour "HH:MM" format.
 */
function parseTime(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ?? '00';
  const period = m[3].toUpperCase();
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

/**
 * Extract date from the event URL path, e.g.
 * "/calendar/2026/04/02/..." -> "2026-04-02"
 */
function parseDateFromUrl(url: string): string | null {
  const m = url.match(/\/calendar\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Parse the webdisplayperformers HTML to extract conductor and cast.
 *
 * The field contains HTML like:
 *   "Boston Symphony Orchestra<br/>Andris Nelsons, Music Director and Conductor<br/>Lang Lang, Piano"
 *   "<div>Name, Violin</div><div>Name, Conductor</div>"
 *
 * We use cheerio to strip HTML and split by line-break elements,
 * then look for entries containing "Conductor" for the conductor field
 * and collect the rest as cast.
 */
function parsePerformers(html: string): { conductor: string | null; cast: string[] | null } {
  if (!html) return { conductor: null, cast: null };

  const $ = load(`<div>${html}</div>`, { xml: false });
  // Replace <br>, <br/>, <br /> with newlines before extracting text
  $('br').replaceWith('\n');
  $('div').each((_, el) => {
    $(el).append('\n');
  });
  const text = $.root().text();

  const lines = text
    .split('\n')
    .map(l => l.replace(/\u00a0/g, ' ').replace(/\u200B/g, '').trim())
    .filter(Boolean);

  let conductor: string | null = null;
  const cast: string[] = [];

  for (const line of lines) {
    if (/\bconductor\b/i.test(line)) {
      if (!conductor) {
        const name = line.replace(/,.*$/, '').trim();
        if (name) conductor = name;
      }
    } else {
      cast.push(line);
    }
  }

  return {
    conductor,
    cast: cast.length > 0 ? cast : null,
  };
}

export class CarnegieHallNewYorkScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'carnegie-hall-new-york',
    venueName: 'Carnegie Hall',
    cityId: 'new-york',
    cityName: 'New York',
    country: 'US',
    scheduleUrl: 'https://www.carnegiehall.org/Events',
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
    const now = Date.now();
    const results: unknown[] = [];

    // Fetch up to 3 pages of 100 events each (300 events covers ~2-3 months)
    for (let page = 0; page < 3; page++) {
      const params = new URLSearchParams({
        query: '',
        hitsPerPage: '100',
        page: String(page),
        numericFilters: JSON.stringify([`startdate>${now}`]),
      });

      const res = await fetch(ALGOLIA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'x-algolia-application-id': ALGOLIA_APP_ID,
          'x-algolia-api-key': ALGOLIA_API_KEY,
        },
        body: JSON.stringify({
          requests: [{ indexName: 'prod_Events', params: params.toString() }],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} from Algolia API`);

      const data = await res.json() as { results: { hits: unknown[]; nbPages: number }[] };
      const firstResult = data.results[0];
      if (firstResult && Array.isArray(firstResult.hits)) {
        results.push(...firstResult.hits);
      }
      // Stop if we've reached the last page
      if (!firstResult || page >= firstResult.nbPages - 1) break;
    }

    return results;
  }

  parse(data: unknown[]): Event[] {
    const events: Event[] = [];
    const now = new Date().toISOString();

    for (const item of data) {
      try {
        const e = item as CarnegieHallEvent;
        if (!e.title || !e.url) continue;

        const date = parseDateFromUrl(e.url);
        if (!date) continue;

        const time = e.time ? parseTime(e.time) : null;

        const { conductor, cast } = parsePerformers(e.webdisplayperformers ?? '');

        const location = e.facility ?? null;
        const url = e.url ? new URL(e.url, SITE_BASE + '/').href : null;

        // Include subtitle in the title if present
        const title = e.subtitle ? `${e.title} — ${e.subtitle}` : e.title;

        events.push({
          id: generateEventId(this.venueId, date, time, e.title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor,
          cast: cast && cast.length > 0 ? cast : null,
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
