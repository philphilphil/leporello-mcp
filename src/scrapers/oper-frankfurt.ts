import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://oper-frankfurt.de/en';

export class OperFrankfurtScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'oper-frankfurt',
    venueName: 'Oper Frankfurt',
    cityId: 'frankfurt',
    cityName: 'Frankfurt',
    country: 'DE',
    scheduleUrl: 'https://oper-frankfurt.de/en/season-calendar/',
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
      const url = `${this.venue.scheduleUrl}?datum=${yyyy}-${mm}&lang=101`;
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

    // Extract active month from li.active a href containing datum=YYYY-MM
    const activeHref = $('li.active a').attr('href') ?? '';
    const monthMatch = activeHref.match(/datum=\d{4}-(\d{2})/);
    const month = monthMatch ? monthMatch[1] : null;

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
        const url = href ? new URL(href, BASE_URL + '/').href : null;

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

// Parse "5:00 pm" or "7:30 pm" or "11:00 am" from start of meta text → "17:00" or "19:30" or "11:00"
function parseTime(meta: string): string | null {
  const m = meta.match(/^(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2];
  const period = m[3].toLowerCase();
  if (period === 'pm' && hours !== 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

// Parse location from meta text: everything after first comma, trimmed
function parseLocation(meta: string): string | null {
  const idx = meta.indexOf(',');
  if (idx === -1) return null;
  const loc = meta.slice(idx + 1).trim();
  return loc || null;
}
