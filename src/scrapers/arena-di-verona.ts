import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.arena.it';

export class ArenaDiVeronaScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'arena-di-verona',
    venueName: 'Arena di Verona',
    cityId: 'verona',
    cityName: 'Verona',
    country: 'IT',
    scheduleUrl: 'https://www.arena.it/it/calendario/',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    const html = this.opts.fetchHtml
      ? await this.opts.fetchHtml()
      : await fetch(this.venue.scheduleUrl, {
          headers: { 'User-Agent': USER_AGENT },
          redirect: 'follow',
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

    // The calendar view has div.day[data-day] elements, each containing
    // li.bh-calendarShow entries for events on that date.
    $('div.day[data-day]').each((_, dayEl) => {
      const $day = $(dayEl);
      const date = $day.attr('data-day') ?? '';

      // Skip placeholder days with malformed dates like "2026-04---"
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

      $day.find('li.bh-calendarShow').each((_, el) => {
        try {
          const $el = $(el);
          const $event = $el.find('div.event');

          // Title from h2 > a
          const $titleLink = $event.find('h2.title-base a');
          const title = $titleLink.text().trim();
          const href = $titleLink.attr('href') ?? '';

          if (!title) return;

          // Time from the icon time-secondary sibling label
          const timeLabel = $event.find('span.icon.time-secondary').parent().find('span.label').text().trim();
          const time = /^\d{2}:\d{2}$/.test(timeLabel) ? timeLabel : null;

          // Location from the icon location-secondary sibling label
          const location = $event.find('span.icon.location-secondary').parent().find('span.label').text().trim() || null;

          // URL: event detail link
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
    });

    // Deduplicate — the calendar HTML sometimes lists the same event twice on a day
    const seen = new Set<string>();
    return events.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }
}
