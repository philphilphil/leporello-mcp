import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.wiener-staatsoper.at';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const MONTH_ABBR: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

export class WienerStaatsoperScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'wiener-staatsoper',
    venueName: 'Wiener Staatsoper',
    cityId: 'wien',
    cityName: 'Wien',
    country: 'AT',
    scheduleUrl: 'https://www.wiener-staatsoper.at/en/calendar/',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    if (this.opts.fetchHtml) {
      const html = await this.opts.fetchHtml();
      return this.parse(html);
    }

    // Fetch current month + next 2 months
    const allEvents: Event[] = [];
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const month = MONTHS[d.getMonth()];
      const year = d.getFullYear();
      const url = `${BASE_URL}/en/calendar/${year}/${month}/`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const html = await res.text();
      allEvents.push(...this.parse(html));
    }

    return allEvents;
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    // Extract year from canonical URL or page URL
    const canonical = $('link[rel="canonical"]').attr('href') ?? '';
    const yearMatch = canonical.match(/\/(\d{4})\//);
    const pageYear = yearMatch ? yearMatch[1] : String(new Date().getFullYear());

    $('div.event-group').each((_, group) => {
      const $group = $(group);

      // Each event-group has a date-col with sticky-date entries,
      // and an event-col with matching event-list-item entries.
      const stickyDates = $group.find('.date-col .sticky-date').toArray();
      const eventItems = $group.find('.event-col > .event-list-item').toArray();

      // sticky-dates and event-items are paired by their data-event / id attributes
      const dateMap = new Map<string, { day: string; month: string; time: string | null }>();
      for (const sd of stickyDates) {
        const eventRef = $(sd).attr('data-event') ?? '';
        const day = $(sd).find('.production-date-day').text().trim();
        const monthAbbr = $(sd).find('.production-date-month').text().trim();
        const timeText = $(sd).find('.production-time').text().trim();
        // Parse time: "19:00—21:30" or "17:00" → take start time
        const timeMatch = timeText.match(/(\d{2}:\d{2})/);
        dateMap.set(eventRef, {
          day,
          month: monthAbbr,
          time: timeMatch ? timeMatch[1] : null,
        });
      }

      for (const item of eventItems) {
        try {
          const $item = $(item);
          const itemId = $item.attr('id') ?? '';
          const dateInfo = dateMap.get(itemId);

          const title = $item.find('h2.event-title').first().text().trim();
          if (!title) continue;

          // Get URL from the event title link — extract date from it
          const href = $item.find('a[href*="/calendar/detail/"]').first().attr('href') ?? '';
          let date: string | null = null;

          // URL pattern: /en/calendar/detail/parsifal/2026-04-02/
          const urlDateMatch = href.match(/\/(\d{4}-\d{2}-\d{2})\//);
          if (urlDateMatch) {
            date = urlDateMatch[1];
          } else if (dateInfo) {
            const mm = MONTH_ABBR[dateInfo.month];
            if (mm) {
              date = `${pageYear}-${mm}-${dateInfo.day.padStart(2, '0')}`;
            }
          }

          if (!date) continue;

          const time = dateInfo?.time ?? null;

          // Genre and location
          const location = $item.find('.event-room').first().text().trim() || null;

          // Composer from event-lead
          const lead = $item.find('.event-lead').first().text().trim()
            .replace(/\s+/g, ' ')
            .replace(/,\s*$/, '');

          // Cast and conductor from event-subtitle
          let conductor: string | null = null;
          let cast: string[] | null = null;

          const subtitleEl = $item.find('.event-subtitle').first();
          if (subtitleEl.length) {
            const conductorEl = subtitleEl.find('span').last();
            const conductorText = conductorEl.text().trim();
            const condMatch = conductorText.match(/Conductor:\s*(.+)/);
            if (condMatch) {
              conductor = condMatch[1].replace(/\u00a0/g, ' ').trim().replace(/,\s*$/, '');
            }

            // Full subtitle text minus conductor span
            const fullText = subtitleEl.clone().find('span').remove().end().text().trim();
            // "with Name1, Name2, Name3,"
            const withMatch = fullText.match(/with\s+(.+)/i);
            if (withMatch) {
              cast = withMatch[1]
                .replace(/\u00a0/g, ' ')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            }
          }

          const fullTitle = lead ? `${title} (${lead})` : title;
          const url = href ? new URL(href, BASE_URL).href : null;

          events.push({
            id: generateEventId(this.venueId, date, time, title),
            venue_id: this.venueId,
            title: fullTitle,
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
    });

    return events;
  }
}
