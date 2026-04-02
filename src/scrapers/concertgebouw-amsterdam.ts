import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.concertgebouw.nl';

export class ConcertgebouwAmsterdamScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'concertgebouw-amsterdam',
    venueName: 'Concertgebouw',
    cityId: 'amsterdam',
    cityName: 'Amsterdam',
    country: 'NL',
    scheduleUrl: 'https://www.concertgebouw.nl/concerten-en-tickets',
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

    $('article[data-component="CardEventAndSeries"]').each((_, el) => {
      try {
        const $el = $(el);

        // Title
        const title = $el.find('h3.c-content__title').first().text().trim();
        if (!title) return;

        // Date and time from <time> element's datetime attribute (ISO 8601 UTC)
        const timeEl = $el.find('time.c-card-event-and-series__time').first();
        const datetimeAttr = timeEl.attr('datetime');
        if (!datetimeAttr) return;

        const dt = new Date(datetimeAttr);
        if (isNaN(dt.getTime())) return;

        const date = datetimeAttr.slice(0, 10); // "YYYY-MM-DD"

        // Extract display time (local Amsterdam time) from the time element text
        // Text is like "13:30–16:15" or "20:15–22:00"
        const timeText = timeEl.text().trim();
        const timeMatch = timeText.match(/(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        // Location (hall name) — second metadata <li> after the time separator
        const metaItems = $el.find('ul.flex.flex-wrap li.py-1 span').toArray();
        const location = metaItems.length > 0
          ? $(metaItems[0]).text().trim() || null
          : null;

        // Program — composer and work from content list items
        const programParts: string[] = [];
        $el.find('li.c-content-list-item').each((_, li) => {
          const composer = $(li).find('span.font-medium').text().trim();
          const work = $(li).find('span.italic').text().trim();
          if (composer && work) {
            programParts.push(`${composer}: ${work}`);
          } else if (composer) {
            programParts.push(composer);
          } else if (work) {
            programParts.push(work);
          }
        });
        const cast = programParts.length > 0 ? programParts : null;

        // URL from the main link
        const href = $el.find('a[data-component="Link[NuxtLink]"]').first().attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
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
