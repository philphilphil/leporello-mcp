import type { Event } from '../types.js';
import { generateEventId, fetchJsonViaBrowser, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<unknown[]>;

const BASE_URL = 'https://www.lyricopera.org';
const API_URL = 'https://www.lyricopera.org/ace-api/events';

// How far ahead to request events. The calendar API ignores its startDate
// param and returns everything up to endDate (including past seasons), so we
// fetch a wide window and filter to upcoming events in parse(). 400 days
// comfortably covers the full announced season.
const HORIZON_DAYS = 400;

interface LyricApiEvent {
  id?: string;
  name?: string;
  eventDate?: string; // local Chicago wall time, e.g. "2026-10-10T19:30:00"
  location?: string;
  viewDetailCtaUrl?: string; // site-relative, e.g. "/shows/upcoming/2026-27/don-giovanni/"
  hideFromCalendar?: boolean;
  hidePerfFromCal?: boolean;
}

export class LyricOperaChicagoScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'lyric-opera-chicago',
    venueName: 'Lyric Opera of Chicago',
    cityId: 'chicago',
    cityName: 'Chicago',
    country: 'US',
    scheduleUrl: 'https://www.lyricopera.org/calendar/',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(
    private readonly opts: { fetchJson?: FetchJson; now?: () => Date } = {},
  ) {}

  private now(): Date {
    return this.opts.now ? this.opts.now() : new Date();
  }

  async scrape(): Promise<Event[]> {
    const raw = this.opts.fetchJson
      ? await this.opts.fetchJson()
      : await this.fetchFromApi();
    return this.parse(raw);
  }

  private async fetchFromApi(): Promise<unknown[]> {
    const start = this.now();
    const end = new Date(start);
    end.setDate(end.getDate() + HORIZON_DAYS);
    const params = new URLSearchParams({
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
    // The site is behind Cloudflare; plain fetch() 403s, so the JSON endpoint
    // is requested through a headless browser that clears the challenge.
    const json = await fetchJsonViaBrowser(
      this.venue.scheduleUrl,
      `${API_URL}?${params}`,
    );
    return Array.isArray(json) ? json : [];
  }

  parse(data: unknown[]): Event[] {
    const events: Event[] = [];
    const scrapedAt = this.now().toISOString();
    const todayStr = this.now().toISOString().slice(0, 10);
    const seen = new Set<string>();

    for (const item of data) {
      try {
        const e = item as LyricApiEvent;

        // Respect the site's own calendar-hiding flags.
        if (e.hideFromCalendar || e.hidePerfFromCal) continue;

        const title = e.name?.trim();
        if (!title || !e.eventDate) continue;

        const date = e.eventDate.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        // The API returns past seasons too; keep only upcoming events.
        if (date < todayStr) continue;

        const time = parseTime(e.eventDate);
        const location = e.location?.trim() || null;
        const url = e.viewDetailCtaUrl
          ? new URL(e.viewDetailCtaUrl, BASE_URL + '/').href
          : null;

        const id = generateEventId(this.venueId, date, time, title);
        if (seen.has(id)) continue; // dedupe within a single scrape
        seen.add(id);

        events.push({
          id,
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor: null, // not exposed on the calendar listing
          cast: null, // not exposed on the calendar listing
          location,
          url,
          scraped_at: scrapedAt,
        });
      } catch {
        // skip malformed entries silently
      }
    }

    return events;
  }
}

/**
 * Extract "HH:MM" (local wall time) from an ISO-like datetime such as
 * "2026-10-10T19:30:00". Returns null if no time component is present.
 */
function parseTime(eventDate: string): string | null {
  const m = eventDate.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

export default new LyricOperaChicagoScraper();
