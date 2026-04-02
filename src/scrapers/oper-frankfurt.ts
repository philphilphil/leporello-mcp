import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://oper-frankfurt.de/de';

export class OperFrankfurtScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'oper-frankfurt',
    venueName: 'Oper Frankfurt',
    cityId: 'frankfurt',
    cityName: 'Frankfurt',
    country: 'DE',
    scheduleUrl: 'https://oper-frankfurt.de/de/spielplan/',
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
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const url = `${this.venue.scheduleUrl}?datum=${yyyy}-${mm}`;
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

    // Extract year from #year1 div
    const year = $('#year1').text().trim();

    // Extract active month from the month slider link containing datum=YYYY-MM
    let month: string | null = null;
    $('li.active a').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      const m = href.match(/datum=\d{4}-(\d{2})/);
      if (m) month = m[1];
    });

    if (!year || !month) return events;

    $('div.repertoire-element').each((_, el) => {
      try {
        const $el = $(el);

        // Get day from .col-date span text
        const day = $el.find('.col-date span').first().text().trim();
        if (!day) return;
        const date = `${year}-${month}-${day.padStart(2, '0')}`;

        // Get title from h3 (clean up <br> tags)
        const title = $el.find('h3').first().text().trim().replace(/\s+/g, ' ');
        if (!title) return;

        // Get composer from h4 (optional)
        const composer = $el.find('h4').first().text().trim() || null;

        // Parse time and location from .meta span
        const metaText = $el.find('.meta').first().text().trim();
        const time = parseTime(metaText);
        const location = parseLocation(metaText);

        // Get URL from the <a> href
        const href = $el.find('a').first().attr('href') ?? '';
        const url = href ? new URL(href, this.venue.scheduleUrl + '/').href : null;

        // Full title: if composer exists, format as "title (composer)"
        const fullTitle = composer ? `${title} (${composer})` : title;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title: fullTitle,
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

// Parse "17.00 Uhr" or "19.30 Uhr" from meta text → "17:00" or "19:30"
function parseTime(meta: string): string | null {
  const m = meta.match(/(\d{1,2})\.(\d{2})\s*Uhr/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// Parse location from meta text: everything after first comma, trimmed
function parseLocation(meta: string): string | null {
  const idx = meta.indexOf(',');
  if (idx === -1) return null;
  const loc = meta.slice(idx + 1).trim();
  return loc || null;
}
