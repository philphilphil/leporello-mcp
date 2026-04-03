import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.teatrolafenice.it';

export class TeatroLaFeniceScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'teatro-la-fenice',
    venueName: 'Teatro La Fenice',
    cityId: 'venezia',
    cityName: 'Venezia',
    country: 'IT',
    scheduleUrl: 'https://www.teatrolafenice.it/calendario/',
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

    $('div.sn_calendar_block_list_row').each((_, row) => {
      try {
        const $row = $(row);

        // Parse date from data attributes: data-list-id="MM-DD-YYYY"
        const listId = $row.attr('data-list-id') ?? '';
        const dateMatch = listId.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (!dateMatch) return;
        const [, mm, dd, yyyy] = dateMatch;
        const date = `${yyyy}-${mm}-${dd}`;

        // Each row can contain multiple events (group items)
        $row.find('div.sn_calendar_block_list_row_group_i').each((_, el) => {
          try {
            const $el = $(el);

            const title = $el.find('div.title').text().trim();
            if (!title) return;

            const timeText = $el.find('div.time').text().trim();
            const time = /^\d{2}:\d{2}$/.test(timeText) ? timeText : null;

            const location = $el.find('div.place').text().trim() || null;

            const href = $el.find('div.link a').attr('href') ?? '';
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
        // skip malformed rows silently
      }
    });

    return events;
  }
}
