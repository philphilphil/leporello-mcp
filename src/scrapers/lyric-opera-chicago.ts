import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.lyricopera.org';

const MONTH_MAP: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};

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
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('li.ace-cal-list-day').each((_, dayEl) => {
      try {
        const $day = $(dayEl);

        // Extract year from aria-labelledby="List-Day-{unix_timestamp}"
        // Timestamps represent local midnight in Chicago (CDT/CST), so add
        // 12 h before converting to UTC to land on the correct calendar day.
        const labelledBy = $day.attr('aria-labelledby') ?? '';
        const tsMatch = labelledBy.match(/List-Day-(\d+)/);
        if (!tsMatch) return;
        const timestamp = parseInt(tsMatch[1], 10);
        const dateObj = new Date((timestamp + 43200) * 1000); // +12 h
        const year = dateObj.getUTCFullYear();

        // Parse month and day from the heading text: "Wednesday, April 1"
        const heading = $day.find('.ace-cal-list-day-date').first().text().trim();
        const dateMatch = heading.match(/(\w+),\s+(\w+)\s+(\d{1,2})/);
        if (!dateMatch) return;
        const mm = MONTH_MAP[dateMatch[2]];
        if (!mm) return;
        const dd = dateMatch[3].padStart(2, '0');
        const date = `${year}-${mm}-${dd}`;

        $day.find('li.ace-cal-list-event').each((_, eventEl) => {
          try {
            const $event = $(eventEl);

            const title = $event.find('.ace-cal-list-event-name a').first().text().trim();
            if (!title) return;

            // Parse time: "7:00 PM" → "19:00"
            const timeText = $event.find('.ace-cal-list-event-time').first().text().trim();
            const time = parseTime(timeText);

            const location = $event.find('.ace-cal-list-event-venue').first().text().trim() || null;

            const href = $event.find('.ace-cal-list-event-name a').first().attr('href') ?? '';
            const url = href ? new URL(href, BASE_URL + '/').href : null;

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
        });
      } catch {
        // skip malformed day entries silently
      }
    });

    return events;
  }
}

/**
 * Convert "7:00 PM" or "2:00 PM" to "19:00" or "14:00".
 * Returns null if the format is unrecognised.
 */
function parseTime(text: string): string | null {
  const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2];
  const meridian = m[3].toUpperCase();
  if (meridian === 'PM' && hours < 12) hours += 12;
  if (meridian === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}
