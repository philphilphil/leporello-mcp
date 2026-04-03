import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.sydneyoperahouse.com';

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Parse a SOH date string into one or more YYYY-MM-DD dates.
 *
 * Formats seen on the site:
 *   "4 Apr 2026"               → ["2026-04-04"]
 *   "9 & 11 Apr 2026"          → ["2026-04-09", "2026-04-11"]
 *   "15 – 18 Apr 2026"         → ["2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18"]
 *   "2 Apr – 3 May 2026"       → ["2026-04-02"] (start date only — cross-month range)
 */
function parseDates(raw: string): string[] {
  const text = raw.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  // "9 & 11 Apr 2026" — two specific dates
  const ampersand = text.match(
    /^(\d{1,2})\s*&\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
  );
  if (ampersand) {
    const mm = MONTHS[ampersand[3]];
    if (mm) return [
      `${ampersand[4]}-${mm}-${pad(+ampersand[1])}`,
      `${ampersand[4]}-${mm}-${pad(+ampersand[2])}`,
    ];
  }

  // "15 – 18 Apr 2026" — same-month range, expand each day
  const sameMonth = text.match(
    /^(\d{1,2})\s*[–—-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
  );
  if (sameMonth) {
    const mm = MONTHS[sameMonth[3]];
    if (mm) {
      const start = +sameMonth[1];
      const end = +sameMonth[2];
      const dates: string[] = [];
      for (let d = start; d <= end; d++) {
        dates.push(`${sameMonth[4]}-${mm}-${pad(d)}`);
      }
      return dates;
    }
  }

  // "2 Apr – 3 May 2026" — cross-month range, return start date only
  const crossMonth = text.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s*[–—-]\s*\d{1,2}\s+[A-Za-z]+\s+(\d{4})$/,
  );
  if (crossMonth) {
    const mm = MONTHS[crossMonth[2]];
    if (mm) return [`${crossMonth[3]}-${mm}-${pad(+crossMonth[1])}`];
  }

  // "4 Apr 2026" — single date
  const single = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (single) {
    const mm = MONTHS[single[2]];
    if (mm) return [`${single[3]}-${mm}-${pad(+single[1])}`];
  }

  return [];
}

export class SydneyOperaHouseScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'sydney-opera-house',
    venueName: 'Sydney Opera House',
    cityId: 'sydney',
    cityName: 'Sydney',
    country: 'AU',
    scheduleUrl: 'https://www.sydneyoperahouse.com/whats-on?genre[]=1436&genre[]=1441',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    if (this.opts.fetchHtml) {
      const html = await this.opts.fetchHtml();
      return this.parse(html);
    }

    const allEvents: Event[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < 8; page++) {
      const url = page === 0
        ? this.venue.scheduleUrl
        : `${this.venue.scheduleUrl}&page=${page}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const html = await res.text();
      const events = this.parse(html);

      for (const e of events) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          allEvents.push(e);
        }
      }

      if (events.length === 0) break;
    }

    return allEvents;
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('div.card.card--whats-on.card--event').each((_, el) => {
      try {
        const $card = $(el);

        const title = $card.find('.card__heading span').first().text().trim();
        const dateRaw = $card.find('.card__dates').text().trim();
        const dates = parseDates(dateRaw);

        if (!title || dates.length === 0) return;

        const location = $card.find('.card__venue').text().trim() || null;
        const href = $card.find('a.card__link').attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        for (const date of dates) {
          events.push({
            id: generateEventId(this.venueId, date, null, title),
            venue_id: this.venueId,
            title,
            date,
            time: null,
            conductor: null,
            cast: null,
            location,
            url,
            scraped_at: now,
          });
        }
      } catch {
        // skip malformed entries silently
      }
    });

    return events;
  }
}
