import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.staatsoper-stuttgart.de';

export class StaatsoperStuttgartScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'staatsoper-stuttgart',
    venueName: 'Staatsoper Stuttgart',
    cityId: 'stuttgart',
    cityName: 'Stuttgart',
    country: 'DE',
    scheduleUrl: 'https://www.staatsoper-stuttgart.de/spielplan/kalender/',
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

    // Each performance is a div.performance with id like "2026-04-05-p8817"
    $('div.performance[id]').each((_, el) => {
      try {
        // Date and time from <meta itemprop="startDate" content="2026-04-05T15:00:00">
        // Falls back to the id attribute (e.g. "2026-05-14-p9444") when content is empty
        const startDateContent = $(el).find('meta[itemprop="startDate"]').attr('content') ?? '';
        const performanceId = $(el).attr('id') ?? '';

        // Title from <span itemprop="name"> inside .performance__title h2 a
        const titleEl = $(el).find('.performance__title h2 a span[itemprop="name"]').first();
        const title = titleEl.text().trim();

        // URL from <a itemprop="url"> href
        const href = $(el).find('.performance__title h2 a[itemprop="url"]').attr('href') ?? '';

        if (!title) return;

        const date = parseDate(startDateContent) ?? parseDateFromId(performanceId);
        if (!date) return;

        const time = parseTime(startDateContent);
        const locationText = $(el).find('[itemprop="location"] [itemprop="name"]').first().text().trim();
        const location = locationText || null;
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

    return events;
  }
}

// Parse date from ISO datetime string "2026-04-05T15:00:00" → "2026-04-05"
function parseDate(isoString: string): string | null {
  const m = isoString.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Fallback: extract date from performance id "2026-05-14-p9444" → "2026-05-14"
function parseDateFromId(id: string): string | null {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Parse time from ISO datetime string "2026-04-05T15:00:00" → "15:00"
function parseTime(isoString: string): string | null {
  const m = isoString.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}
