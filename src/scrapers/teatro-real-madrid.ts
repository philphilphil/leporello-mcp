import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.teatroreal.es';

export class TeatroRealMadridScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'teatro-real-madrid',
    venueName: 'Teatro Real',
    cityId: 'madrid',
    cityName: 'Madrid',
    country: 'ES',
    scheduleUrl: 'https://www.teatroreal.es/es/calendario',
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

    // Each day is a div.item-box with id like "box04-2026-14" (boxMM-YYYY-DD)
    $('div.item-box[id]').each((_, dayEl) => {
      try {
        const dayId = $(dayEl).attr('id') ?? '';
        // Parse date from item-box id: "box{MM}-{YYYY}-{DD}"
        const idMatch = dayId.match(/^box(\d{2})-(\d{4})-(\d{2})$/);
        if (!idMatch) return;

        const [, mm, yyyy, dd] = idMatch;
        const date = `${yyyy}-${mm}-${dd}`;

        // Each event within this day is a div.contentbox
        $(dayEl).find('div.contentbox').each((_, eventEl) => {
          try {
            const $event = $(eventEl);

            // Cheerio re-parents the nested <a><h3><a> into <a></a><h3><a></a></h3>
            // so we need to find the <a> with actual text inside the h3
            const h3 = $event.find('.item-box--premiere__text--title h3').first();
            const titleLink = h3.find('a').filter((_, el) => $(el).text().trim() !== '').first();
            const rawTitle = titleLink.text().trim()
              .replace(/\s+/g, ' '); // normalize whitespace
            if (!rawTitle) return;

            // URL — prefer the a with text, fall back to the first a with href
            const href = titleLink.attr('href')
              ?? h3.find('a[href]').first().attr('href')
              ?? '';
            const url = href ? new URL(href, BASE_URL + '/').href : null;

            // Category/genre from span inside the text--title div (before the h3)
            const category = $event.find('.item-box--premiere__text--title > a > span').first().text().trim() || null;

            // Build title — include category as suffix if present
            const title = category ? `${rawTitle} (${category})` : rawTitle;

            // Collect all time slots — filter to those with non-empty text and valid href
            const times: string[] = [];
            $event.find('.item-box--premiere__text--btn a').each((_, btnEl) => {
              const btnText = $(btnEl).text().trim();
              const btnHref = $(btnEl).attr('href') ?? '';
              if (btnText && /^\d{2}:\d{2}$/.test(btnText) && btnHref) {
                times.push(btnText);
              }
            });

            if (times.length === 0) {
              // No time slots — create one event with null time
              events.push({
                id: generateEventId(this.venueId, date, null, rawTitle),
                venue_id: this.venueId,
                title,
                date,
                time: null,
                conductor: null,
                cast: null,
                location: null,
                url,
                scraped_at: now,
              });
            } else {
              // Create one event per time slot
              for (const time of times) {
                events.push({
                  id: generateEventId(this.venueId, date, time, rawTitle),
                  venue_id: this.venueId,
                  title,
                  date,
                  time,
                  conductor: null,
                  cast: null,
                  location: null,
                  url,
                  scraped_at: now,
                });
              }
            }
          } catch {
            // skip malformed entries silently
          }
        });
      } catch {
        // skip malformed day entries silently
      }
    });

    return events;
  }
}
