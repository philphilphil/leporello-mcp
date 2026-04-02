import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.sydneyoperahouse.com';

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * Parse a SOH date string into a YYYY-MM-DD start date.
 *
 * Formats seen on the site:
 *   "4 Apr 2026"               → single date
 *   "1 – 5 Apr 2026"           → range within one month
 *   "30 Mar – 16 May 2026"     → range across months
 *   "5 & 6 Apr 2026"           → two specific dates (use first)
 */
function parseStartDate(raw: string): string | null {
  // Normalise whitespace and decode HTML entities
  const text = raw.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  // "30 Mar – 16 May 2026"  (cross-month range)
  const crossMonth = text.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s*[–—-]\s*\d{1,2}\s+[A-Za-z]+\s+(\d{4})$/,
  );
  if (crossMonth) {
    const mm = MONTHS[crossMonth[2]];
    if (mm) return `${crossMonth[3]}-${mm}-${crossMonth[1].padStart(2, '0')}`;
  }

  // "1 – 5 Apr 2026"  (same-month range)
  const sameMonth = text.match(
    /^(\d{1,2})\s*[–—-]\s*\d{1,2}\s+([A-Za-z]+)\s+(\d{4})$/,
  );
  if (sameMonth) {
    const mm = MONTHS[sameMonth[2]];
    if (mm) return `${sameMonth[3]}-${mm}-${sameMonth[1].padStart(2, '0')}`;
  }

  // "5 & 6 Apr 2026"  (two specific dates)
  const ampersand = text.match(
    /^(\d{1,2})\s*&\s*\d{1,2}\s+([A-Za-z]+)\s+(\d{4})$/,
  );
  if (ampersand) {
    const mm = MONTHS[ampersand[2]];
    if (mm) return `${ampersand[3]}-${mm}-${ampersand[1].padStart(2, '0')}`;
  }

  // "4 Apr 2026"  (single date)
  const single = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (single) {
    const mm = MONTHS[single[2]];
    if (mm) return `${single[3]}-${mm}-${single[1].padStart(2, '0')}`;
  }

  return null;
}

export class SydneyOperaHouseScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'sydney-opera-house',
    venueName: 'Sydney Opera House',
    cityId: 'sydney',
    cityName: 'Sydney',
    country: 'AU',
    scheduleUrl: 'https://www.sydneyoperahouse.com/whats-on',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    if (this.opts.fetchHtml) {
      const html = await this.opts.fetchHtml();
      return this.parse(html);
    }

    // Fetch multiple pages to get broader coverage
    const allEvents: Event[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < 5; page++) {
      const url = page === 0
        ? this.venue.scheduleUrl
        : `${this.venue.scheduleUrl}?page=${page}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const html = await res.text();
      const events = this.parse(html);

      // Deduplicate across pages
      for (const e of events) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          allEvents.push(e);
        }
      }

      // Stop if page had no events (we've reached the end)
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
        const date = parseStartDate(dateRaw);

        if (!title || !date) return;

        const location = $card.find('.card__venue').text().trim() || null;
        const href = $card.find('a.card__link').attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

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
      } catch {
        // skip malformed entries silently
      }
    });

    return events;
  }
}
