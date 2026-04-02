import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.staatsoper.de';

export class BayerischeStaatsoperScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'bayerische-staatsoper',
    venueName: 'Bayerische Staatsoper',
    cityId: 'muenchen',
    cityName: 'München',
    country: 'DE',
    scheduleUrl: 'https://www.staatsoper.de/spielplan',
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

    $('div.activity-list__row').each((_, el) => {
      try {
        const $row = $(el);
        const date = $row.attr('data-date') ?? '';
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

        const $content = $row.find('a.activity-list__content');
        if (!$content.length) return;

        const title = $content.find('span.h3').text().trim();
        if (!title) return;

        // Time and location from the first span in activity-list__text
        // Format: "19.30 Uhr | Nationaltheater"
        const timeLocationText = $content.find('div.activity-list__text > span').first().text().trim();
        let time: string | null = null;
        let location: string | null = null;

        const tlMatch = timeLocationText.match(/^(\d{1,2})\.(\d{2})\s*Uhr\s*\|\s*(.+)$/);
        if (tlMatch) {
          time = `${tlMatch[1].padStart(2, '0')}:${tlMatch[2]}`;
          location = tlMatch[3].trim() || null;
        } else {
          // Try to extract just the time
          const timeOnly = timeLocationText.match(/(\d{1,2})\.(\d{2})\s*Uhr/);
          if (timeOnly) {
            time = `${timeOnly[1].padStart(2, '0')}:${timeOnly[2]}`;
          }
        }

        // Composer from toggle content (first <p> that is NOT price info)
        const toggleContent = $content.find('div.activity-list--toggle__content');
        let composer: string | null = null;
        if (toggleContent.length) {
          const firstP = toggleContent.find('p').first();
          if (firstP.length && !firstP.hasClass('activity-list-price-info')) {
            composer = firstP.text().replace(/<br\s*\/?>/g, '').trim() || null;
          }
        }

        // Build title with composer
        const fullTitle = composer ? `${title} (${composer})` : title;

        // Event detail URL
        const href = $content.attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

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
