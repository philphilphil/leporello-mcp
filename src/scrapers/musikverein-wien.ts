import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const SPIELPLAN_URL = 'https://spielplan.musikverein.at/spielplan';

export class MusikvereinWienScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'musikverein-wien',
    venueName: 'Musikverein',
    cityId: 'wien',
    cityName: 'Wien',
    country: 'AT',
    scheduleUrl: 'https://musikverein.at/spielplan',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    const html = this.opts.fetchHtml
      ? await this.opts.fetchHtml()
      : await fetch(SPIELPLAN_URL, {
          headers: { 'User-Agent': USER_AGENT },
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} from ${SPIELPLAN_URL}`);
          return r.text();
        });
    return this.parse(html);
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('div.event').each((_, el) => {
      try {
        const $el = $(el);

        // --- Date & time from .event--date-time ---
        const dateTimeLink = $el.find('.event--date-time a').first();
        const paragraphs = dateTimeLink.find('p');

        // First <p>: date like "02.04.2026 "
        const rawDate = paragraphs.eq(0).text().trim();
        const dateMatch = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (!dateMatch) return;
        const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

        // Second <p>: time like "20:00 Uhr  - 22:00 Uhr"
        const rawTime = paragraphs.eq(1).text().trim();
        const timeMatch = rawTime.match(/^(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        // Location: first <p class="text"> inside the date-time link (hall name)
        const locationParagraphs = dateTimeLink.find('p.text');
        const location = locationParagraphs.eq(0).text().trim() || null;

        // --- Title and performers from .event--main ---
        const mainLink = $el.find('.event--main a').first();
        const title = mainLink.find('h3.event--heading').text().trim();
        if (!title) return;

        // Collect non-veranstalter text paragraphs from .event--main
        const textParagraphs = mainLink.find('p.text').not('.veranstalter');

        // First text paragraph: performers/conductor (e.g. "Sir Simon Rattle" or "Hans Graf • Ziyu He")
        const performersText = textParagraphs.eq(0).text().trim();

        // Second text paragraph: composers (e.g. "Gustav Mahler" or "Rachmaninow • Hindemith")
        const composersText = textParagraphs.eq(1).text().trim();

        // Parse performers into cast array (split by bullet separator)
        let cast: string[] | null = null;
        if (performersText) {
          cast = performersText
            .split(/\s*[•|]\s*/)
            .map(s => s.trim())
            .filter(Boolean);
          if (cast.length === 0) cast = null;
        }

        // Build full title: append composers if present
        const fullTitle = composersText ? `${title} — ${composersText}` : title;

        // URL
        const href = mainLink.attr('href') ?? '';
        const url = href || null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title: fullTitle,
          date,
          time,
          conductor: null,
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
