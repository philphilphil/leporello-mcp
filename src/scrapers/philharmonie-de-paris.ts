import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://philharmoniedeparis.fr';

export class PhilharmonieDeParisScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'philharmonie-de-paris',
    venueName: 'Philharmonie de Paris',
    cityId: 'paris',
    cityName: 'Paris',
    country: 'FR',
    scheduleUrl: 'https://philharmoniedeparis.fr/fr/agenda',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    const html = this.opts.fetchHtml
      ? await this.opts.fetchHtml()
      : await fetch(`${BASE_URL}/fr/agenda-ajax?types=1&page=1`, {
          headers: { 'User-Agent': USER_AGENT },
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} from ${BASE_URL}/fr/agenda-ajax`);
          return r.json();
        }).then((data: { content: string }) => data.content);
    return this.parse(html);
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('article.EventCard').each((_, el) => {
      try {
        const $el = $(el);

        const title = $el.find('.EventCard-title').first().text().trim();
        if (!title) return;

        // Extract date and time from data-timestamp
        const timestamp = $el.attr('data-timestamp');
        if (!timestamp || timestamp === '0') return;

        const ts = parseInt(timestamp, 10);
        if (isNaN(ts) || ts === 0) return;

        const eventDate = new Date(ts * 1000);
        // Format in Europe/Paris timezone since events are local Paris times
        const dateFmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(eventDate); // "YYYY-MM-DD"
        const date = dateFmt;
        const timeFmt = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(eventDate); // "HH:MM"
        const time = timeFmt;

        // Subtitle contains ensemble/performer names
        const subtitle = $el.find('.EventCard-subtitle').first().text().trim() || null;

        // Parse cast from subtitle: "Ensemble - Conductor" or "Performer1 - Performer2"
        let conductor: string | null = null;
        let cast: string[] | null = null;
        if (subtitle) {
          // The subtitle typically lists performers/ensembles separated by " - "
          const parts = subtitle.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
          if (parts.length > 0) {
            cast = parts;
          }
        }

        // Location / hall
        const placeEl = $el.find('.EventCard-place').first();
        const location = placeEl.length
          ? placeEl.clone().children('img').remove().end().text().trim() || null
          : null;

        // URL from the detail link
        const href = $el.find('a.EventCard-button').first().attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
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

    return events;
  }
}
