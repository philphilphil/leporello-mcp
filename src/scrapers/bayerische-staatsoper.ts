import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, fetchRenderedHtml, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.staatsoper.de';
const ALLOWED_GENRES = ['Oper', 'Ballett', 'Konzert', 'Liederabend'];

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
      : await fetchRenderedHtml(this.venue.scheduleUrl, {
          waitForSelector: '.activity-list__row',
        });
    return this.parse(html);
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('.activity-list__row').each((_, el) => {
      try {
        const $row = $(el);

        const date = $row.attr('data-date') ?? '';
        if (!date) return;

        const title = $row.find('.activity-list__text .h3').first().text().trim();
        if (!title) return;

        // Filter by genre — skip tours, community events, etc.
        const genre = $row.find('.activity-list__col--genre').text().trim();
        if (!ALLOWED_GENRES.includes(genre)) return;

        // Info line: "HH.MM Uhr | Location"
        const infoSpan = $row.find('.activity-list__text > span').first().text().trim();
        const timeMatch = infoSpan.match(/^(\d{1,2})\.(\d{2})\s*Uhr/);
        const time = timeMatch
          ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
          : null;

        // Location after the pipe separator
        const locMatch = infoSpan.match(/Uhr\s*\|\s*(.+)/);
        const location = locMatch ? locMatch[1].trim() : null;

        // Composer / subtitle from first non-price paragraph in toggle content
        const composerP = $row
          .find('.activity-list--toggle__content p:not(.activity-list-price-info)')
          .first();
        const composerText = composerP.text().trim().replace(/\s+/g, ' ');
        const composer = composerText || null;

        // Build full title with composer when available (e.g. "PARSIFAL (Richard Wagner)")
        const fullTitle = composer ? `${title} (${composer})` : title;

        // Event detail URL
        const href = $row.find('.activity-list__content').attr('href') ?? '';
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
