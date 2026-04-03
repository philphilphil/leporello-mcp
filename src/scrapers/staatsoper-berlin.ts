import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.staatsoper-berlin.de';

export class StaatsoperBerlinScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'staatsoper-berlin',
    venueName: 'Staatsoper Unter den Linden',
    cityId: 'berlin',
    cityName: 'Berlin',
    country: 'DE',
    scheduleUrl: 'https://www.staatsoper-berlin.de/de/spielplan/',
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

    $('article.termin-list__item').each((_, el) => {
      try {
        const $el = $(el);

        // Title
        const title = $el.find('h3.termin__title a span').first().text().trim();
        if (!title) return;

        // Date and time from <time datetime="2026-04-04 19:00:00">
        const datetimeAttr = $el.find('time[datetime]').attr('datetime') ?? '';
        const dtMatch = datetimeAttr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (!dtMatch) return;

        const date = `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}`;
        const time = `${dtMatch[4]}:${dtMatch[5]}`;

        // Location (venue/hall)
        const location = $el.find('.termin__spielstaette a').text().trim() || null;

        // Event detail URL
        const href = $el.find('h3.termin__title a').attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        // Composer from werkinfo
        const werkinfo = $el.find('.termin__werkinfo').text().trim() || null;
        const fullTitle = werkinfo ? `${title} (${werkinfo})` : title;

        // Conductor — look for "Dirigent:" or "Musikalische Leitung:" roles
        let conductor: string | null = null;
        const cast: string[] = [];

        $el.find('.besetzung__item').each((_, item) => {
          const $item = $(item);
          const role = $item.find('.besetzung__rolle').text().trim().replace(/:$/, '');
          const names = $item.find('.besetzung__beteiligte-liste-item span')
            .map((_, s) => $(s).text().trim())
            .get()
            .filter(Boolean);

          if (!role || names.length === 0) return;

          if (role === 'Dirigent' || role === 'Musikalische Leitung') {
            conductor = names[0] ?? null;
          } else if (role === 'Inszenierung' || role === 'Bühnenbild' || role === 'Kostüme'
            || role === 'Licht' || role === 'Dramaturgie' || role === 'Choreografie'
            || role === 'Video' || role === 'Regie') {
            // Skip production/technical roles — not cast
          } else {
            // Performer roles (character names like "Riccardo", "Amelia", etc.)
            cast.push(...names);
          }
        });

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title: fullTitle,
          date,
          time,
          conductor,
          cast: cast.length > 0 ? cast : null,
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
