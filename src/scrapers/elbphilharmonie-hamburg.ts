import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.elbphilharmonie.de';

export class ElbphilharmonieHamburgScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'elbphilharmonie-hamburg',
    venueName: 'Elbphilharmonie',
    cityId: 'hamburg',
    cityName: 'Hamburg',
    country: 'DE',
    scheduleUrl: 'https://www.elbphilharmonie.de/de/programm/',
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

        // Title from .event-title a
        const titleLink = $el.find('p.event-title a').first();
        const title = titleLink.text().trim();
        const href = titleLink.attr('href') ?? '';

        if (!title) return;

        // Date and time from <time datetime="...">
        const timeEl = $el.find('time[datetime]').first();
        const datetime = timeEl.attr('datetime') ?? '';
        if (!datetime) return;

        // Parse ISO datetime: "2026-04-02T11:00:00+02:00"
        const dtMatch = datetime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        if (!dtMatch) return;
        const date = dtMatch[1];
        const time = dtMatch[2];

        // Location: venue building + hall from .place-cell
        // e.g. "Elbphilharmonie Großer Saal" or "Laeiszhalle Kleiner Saal"
        const placeCell = $el.find('.place-cell .caption').first();
        const building = placeCell.find('strong').text().trim();
        const hallText = placeCell.text().trim();
        // hallText is "Elbphilharmonie Großer Saal" — extract the hall after the building name
        const hall = hallText.replace(building, '').trim();
        const location = hall ? `${building} ${hall}` : building || null;

        // Subtitle — used as description (performers, program info)
        const subtitle = $el.find('p.event-subtitle').first().text().trim() || null;

        // Build cast from subtitle — split performers by " / "
        let cast: string[] | null = null;
        if (subtitle && subtitle.includes(' / ')) {
          cast = subtitle.split(' / ').map(s => s.trim()).filter(Boolean);
        }

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
