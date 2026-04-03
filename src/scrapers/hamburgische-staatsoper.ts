import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.die-hamburgische-staatsoper.de';

export class HamburgischeStaatsoperScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'hamburgische-staatsoper',
    venueName: 'Hamburgische Staatsoper',
    cityId: 'hamburg',
    cityName: 'Hamburg',
    country: 'DE',
    scheduleUrl: 'https://www.die-hamburgische-staatsoper.de/de/kalender/oper',
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

    $('div.cal__day').each((_, dayEl) => {
      const date = $(dayEl).attr('data-day') ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

      $(dayEl).find('li.event-entry').each((_, entry) => {
        try {
          const $entry = $(entry);
          const $block = $entry.find('div.block--event').first();
          if (!$block.length) return;

          // Title
          const titleEl = $block.find('div.event__title a').first();
          const title = titleEl.text().trim();
          if (!title) return;

          // Composer from subtitle
          const subtitle = $block.find('div.event__subtitle span').first().text().trim();

          // Full title: "Title (Composer)" if composer is present
          const fullTitle = subtitle ? `${title} (${subtitle})` : title;

          // Time from the second span.event__datetime inside div.event__datetime
          // Structure: <div class="event__datetime">
          //   <span class="event__date">Do 2.4.26</span>
          //   <span class="event__datetime">19:00</span>
          // </div>
          const timeText = $block.find('div.event__datetime span.event__datetime').first().text().trim();
          const timeMatch = timeText.match(/^(\d{1,2}):(\d{2})$/);
          const time = timeMatch
            ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
            : null;

          // Location
          const location = $block.find('div.event__location span').first().text().trim() || null;

          // Event URL from data-href on event__main
          const href = $block.find('div.event__main').attr('data-href') ?? '';
          const url = href ? new URL(href, BASE_URL + '/').href : null;

          // Conductor from "Musikalische Leitung" in the extra details
          let conductor: string | null = null;
          $block.find('li.production-infos__item').each((_, infoEl) => {
            const label = $(infoEl).find('span.label').text().trim();
            if (label === 'Musikalische Leitung') {
              conductor = $(infoEl).find('span.content').text().trim() || null;
            }
          });

          // Cast from "Mit: ..." paragraph in extra__text
          let cast: string[] | null = null;
          $block.find('div.extra__text p').each((_, pEl) => {
            const pText = $(pEl).text().trim();
            const mitMatch = pText.match(/^Mit:\s*(.+)/);
            if (mitMatch) {
              cast = mitMatch[1]
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            }
          });

          events.push({
            id: generateEventId(this.venueId, date, time, title),
            venue_id: this.venueId,
            title: fullTitle,
            date,
            time,
            conductor,
            cast: cast && cast.length > 0 ? cast : null,
            location,
            url,
            scraped_at: now,
          });
        } catch {
          // skip malformed entries silently
        }
      });
    });

    return events;
  }
}
