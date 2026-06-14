import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = (url: string) => Promise<string>;

const BASE_URL = 'https://auditorionacional.inaem.gob.es';
const DAYS_AHEAD = 90; // stop paginating once a page runs entirely past this window
const PAGE_SIZE = 12; // events per listing page (?b_start:int=N steps by 12)
const MAX_PAGES = 16; // safety cap; the site currently has 16 pages of upcoming events

export class AuditorioNacionalMadridScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'auditorio-nacional-madrid',
    venueName: 'Auditorio Nacional de Música',
    cityId: 'madrid',
    cityName: 'Madrid',
    country: 'ES',
    lat: 40.4168,
    lng: -3.7038,
    scheduleUrl: 'https://auditorionacional.inaem.gob.es/es/programacion',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  private async fetchPage(url: string): Promise<string> {
    if (this.opts.fetchHtml) return this.opts.fetchHtml(url);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.text();
  }

  async scrape(): Promise<Event[]> {
    const cutoff = new Date(Date.now() + DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
    const events: Event[] = [];
    const seen = new Set<string>();

    // The /es/programacion listing paginates 12 events per page via ?b_start:int=N.
    // Events are ordered chronologically, so we keep fetching pages until a page
    // is empty or every event on it falls past the 90-day cutoff window.
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = page === 0
        ? this.venue.scheduleUrl
        : `${this.venue.scheduleUrl}?b_start:int=${page * PAGE_SIZE}`;

      const pageEvents = this.parse(await this.fetchPage(url));
      if (pageEvents.length === 0) break; // ran past the last page

      let anyWithinWindow = false;
      let anyNew = false;
      for (const event of pageEvents) {
        if (event.date > cutoff) continue; // beyond the window — skip
        anyWithinWindow = true;
        if (seen.has(event.id)) continue; // page boundaries can overlap
        seen.add(event.id);
        events.push(event);
        anyNew = true;
      }
      // Stop if an entire page is past the cutoff (later pages will be too),
      // or if a page yields no new events (e.g. an out-of-range offset that the
      // site silently serves as page 1, or a single-page fixture in tests).
      if (!anyWithinWindow || !anyNew) break;
    }

    return events;
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('article.eventitem').each((_, el) => {
      try {
        const $el = $(el);

        // Title from the event title link
        const titleEl = $el.find('h3.eventitem__title a');
        const title = titleEl.text().trim();

        // URL — already absolute on this site
        const href = titleEl.attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        // Date and time from the pat-localmoment spans.
        // The span text content contains the raw ISO datetime, e.g. "2026-04-07T19:30:00+02:00"
        const isoText = $el.find('span.pat-localmoment').first().text().trim();
        const isoMatch = isoText.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

        let date: string | null = null;
        let time: string | null = null;

        if (isoMatch) {
          date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
          time = `${isoMatch[4]}:${isoMatch[5]}`;
        }

        // Location (hall name) from the .location span
        const location = $el.find('.location span').text().trim() || null;

        // No conductor or cast available on the listing page
        const conductor: string | null = null;
        const cast: string[] | null = null;

        if (!title || !date) return;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor,
          cast,
          location,
          url,
          scraped_at: now,
        });
      } catch {
        // skip malformed entries silently
      }
    });

    return events;
  }
}

export default new AuditorioNacionalMadridScraper();
