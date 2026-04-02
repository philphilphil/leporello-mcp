import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.barbican.org.uk';

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

export class BarbicanHallLondonScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'barbican-hall-london',
    venueName: 'Barbican Hall',
    cityId: 'london',
    cityName: 'London',
    country: 'GB',
    scheduleUrl: 'https://www.barbican.org.uk/whats-on/classical-music',
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

    $('article.listing--event').each((_, el) => {
      try {
        const $el = $(el);

        // Title
        const title = $el.find('h2.listing-title').text().trim();
        if (!title) return;

        // Date and time from the first <time> element's datetime attribute (ISO/UTC)
        const timeEl = $el.find('p.listing-date time').first();
        const datetimeAttr = timeEl.attr('datetime');
        if (!datetimeAttr) return;

        const dt = new Date(datetimeAttr);
        if (isNaN(dt.getTime())) return;

        // The datetime attribute is in UTC, but the displayed text shows London local time.
        // Extract the displayed time from the text (e.g. "Sat 4 Apr 2026, 19:30")
        const displayText = timeEl.text().trim();
        const displayTimeMatch = displayText.match(/(\d{1,2}):(\d{2})\s*$/);

        let date: string;
        let time: string | null;

        if (displayTimeMatch) {
          // Use the displayed local time for the time field
          const hh = displayTimeMatch[1].padStart(2, '0');
          const mm = displayTimeMatch[2];
          time = `${hh}:${mm}`;

          // Parse local date from display text: "Thu 16 Apr 2026, 19:00"
          const dateMatch = displayText.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/);
          if (dateMatch) {
            const day = dateMatch[1].padStart(2, '0');
            const month = MONTH_MAP[dateMatch[2]] ?? '01';
            const year = dateMatch[3];
            date = `${year}-${month}-${day}`;
          } else {
            // Fallback: derive date from UTC datetime
            date = datetimeAttr.slice(0, 10);
          }
        } else {
          // No time in display text (date range events like "Sun 19 – Tue 21 Apr 2026")
          // Use the start date from the datetime attribute
          date = datetimeAttr.slice(0, 10);
          time = null;
        }

        // URL from the main event link or the detail CTA link
        const detailHref = $el.find('a.search-listing__link').attr('href')
          ?? $el.find('.search-listing__cta a').attr('href')
          ?? '';
        const url = detailHref ? new URL(detailHref, BASE_URL + '/').href : null;

        // Performers: the last .related-people-listing typically has performers,
        // the first has the programme/works
        let conductor: string | null = null;
        const cast: string[] = [];

        const peopleSections = $el.find('.related-people-listing').toArray();
        const performerSection = peopleSections.length > 1
          ? peopleSections[peopleSections.length - 1]
          : peopleSections[0];

        if (performerSection) {
          $(performerSection).find('.person.person--listing').each((_, person) => {
            const name = $(person).find('.person__name').text().trim();
            const role = $(person).find('.person__role').text().trim().toLowerCase();
            if (!name) return;

            if (role === 'conductor') {
              conductor = name;
            } else {
              cast.push(name);
            }
          });
        }

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor,
          cast: cast.length > 0 ? cast : null,
          location: null,
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
