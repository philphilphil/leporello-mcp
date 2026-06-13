import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = (url: string) => Promise<string>;

const BASE_URL = 'https://www.concertgebouw.nl';
const DAYS_AHEAD = 90; // stop paginating once events run past this window
const MAX_PAGES = 15; // safety cap; the 90-day cutoff normally stops sooner

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

  private async fetchPage(url: string): Promise<string> {
    if (this.opts.fetchHtml) return this.opts.fetchHtml(url);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.text();
  }

  async scrape(): Promise<Event[]> {
    const cutoff = new Date(Date.now() + DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
    const events: Event[] = [];
    const seen = new Set<string>();

    // The schedule is a server-rendered Nuxt list paginated via ?page=N
    // (~15 events per page, chronological). Walk pages until events run past
    // the 90-day window, a page yields nothing new, or the safety cap is hit.
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1
        ? this.venue.scheduleUrl
        : `${this.venue.scheduleUrl}?page=${page}`;

      const pageEvents = this.parse(await this.fetchPage(url));
      if (pageEvents.length === 0) break; // no more event rows

      let reachedCutoff = false;
      let addedNew = false;
      for (const event of pageEvents) {
        if (event.date > cutoff) {
          reachedCutoff = true; // events are chronological — past the window
          continue;
        }
        if (seen.has(event.id)) continue; // guard against duplicate/overlap
        seen.add(event.id);
        events.push(event);
        addedNew = true;
      }
      if (reachedCutoff) break;
      if (!addedNew) break; // page repeated previous content — stop paging
    }

    return events;
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

        // Location (hall name). The metadata <ul> lists, in order: the <time>
        // (inside li.py-1.inline-flex), a presentation separator, then the hall
        // name (li.py-1 > span), another separator, then a price (li.py-1 >
        // span starting with "v.a." / "€"). Pick the first plain li.py-1 span
        // that isn't the time and isn't a price.
        let location: string | null = null;
        $el.find('li.py-1').each((_, li) => {
          if (location) return;
          const $li = $(li);
          if ($li.find('time').length > 0) return; // the time cell
          const text = $li.find('span').first().text().trim();
          if (!text) return;
          if (/^v\.a\.|€|gratis/i.test(text)) return; // price cell
          location = text;
        });

        // No cast on the listing. The "met onder andere" content list
        // (li.c-content-list-item) holds the PROGRAM — composer + work
        // (e.g. "Beethoven: Pianoconcert nr. 3") — not performers. The real
        // performers/soloists live under a separate "Musici" label that only
        // appears on detail pages, which we don't fetch. Leave cast null rather
        // than mislabel works as cast.
        const cast = null;

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

export default new ConcertgebouwAmsterdamScraper();
