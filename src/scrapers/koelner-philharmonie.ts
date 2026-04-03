import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.koelner-philharmonie.de';

export class KoelnerPhilharmonieScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'koelner-philharmonie',
    venueName: 'Kölner Philharmonie',
    cityId: 'koeln',
    cityName: 'Köln',
    country: 'DE',
    scheduleUrl: 'https://www.koelner-philharmonie.de/de/konzerte',
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

    $('li.event-item').each((_, el) => {
      try {
        const $el = $(el);

        // Title from .event-item__title
        const title = $el.find('.event-item__title').first().text().trim();
        if (!title) return;

        // Date from .event-item__date-full — format "DD.MM.YYYY"
        const dateRaw = $el.find('.event-item__date-full').first().text().trim();
        const dateMatch = dateRaw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (!dateMatch) return;
        const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

        // Time from .event-item__date-time — format "HH:MM"
        const timeRaw = $el.find('.event-item__date-time').first().text().trim();
        const timeMatch = timeRaw.match(/(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        // Subtitle contains performers separated by " | "
        const subtitle = $el.find('.event-item__subtitle').first().text().trim() || null;

        // Parse conductor and cast from subtitle
        // Pattern: "Ensemble | Orchestra | Conductor" (pipe-separated)
        let conductor: string | null = null;
        let cast: string[] | null = null;

        if (subtitle) {
          const parts = subtitle.split('|').map(s => s.trim()).filter(Boolean);
          if (parts.length > 1) {
            // Last part is typically the conductor/director
            conductor = parts[parts.length - 1];
            // Remaining parts are ensembles/performers
            cast = parts.slice(0, -1);
          } else if (parts.length === 1) {
            // Single entry — could be an ensemble or a description, put in cast
            cast = parts;
          }
        }

        // URL from .event-item__title href
        const href = $el.find('.event-item__title').first().attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor,
          cast: cast && cast.length > 0 ? cast : null,
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
