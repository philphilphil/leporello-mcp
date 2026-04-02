import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://auditorionacional.inaem.gob.es';

export class AuditorioNacionalMadridScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'auditorio-nacional-madrid',
    venueName: 'Auditorio Nacional de Música',
    cityId: 'madrid',
    cityName: 'Madrid',
    country: 'ES',
    scheduleUrl: 'https://auditorionacional.inaem.gob.es/es/programacion',
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

    $('article.eventitem').each((_, el) => {
      try {
        const $el = $(el);

        // Title from the event title link
        const titleEl = $el.find('h3.eventitem__title a');
        const title = titleEl.text().trim();

        // URL — already absolute on this site
        const href = titleEl.attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        // Date and time from the pat-localmoment spans.
        // The span text content contains the raw ISO datetime, e.g. "2026-04-07T19:30:00+02:00"
        const isoText = $el.find('span.pat-localmoment').first().text().trim();
        const isoMatch = isoText.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

        let date: string | null = null;
        let time: string | null = null;

        if (isoMatch) {
          date = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
          time = `${isoMatch[4]}:${isoMatch[5]}`;
        }

        // Location (hall name) from the .location span
        const location = $el.find('.location span').text().trim() || null;

        // No conductor or cast available on the listing page
        const conductor: string | null = null;
        const cast: string[] | null = null;

        if (!title || !date) return;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor,
          cast,
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
