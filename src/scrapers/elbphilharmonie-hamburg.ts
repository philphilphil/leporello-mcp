import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = (url: string) => Promise<string>;

const BASE_URL = 'https://www.elbphilharmonie.de';
const MAX_PAGES = 40; // safety cap; pagination also stops at the date cutoff
const DAYS_AHEAD = 90; // stop following next-day pages beyond ~90 days

export class ElbphilharmonieHamburgScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'elbphilharmonie-hamburg',
    venueName: 'Elbphilharmonie',
    cityId: 'hamburg',
    cityName: 'Hamburg',
    country: 'DE',
    lat: 53.5511,
    lng: 9.9937,
    scheduleUrl: 'https://www.elbphilharmonie.de/de/programm/',
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
    const events: Event[] = [];

    // The program page paginates via a trailing `<li data-url="/de/programm/DD-MM-YYYY/">`
    // loader that returns the next chunk of days. Follow it until we pass the date
    // cutoff, hit the page cap, revisit a URL, or run out of next links.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + DAYS_AHEAD);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const visited = new Set<string>();
    let url: string | null = this.venue.scheduleUrl;

    for (let page = 0; page < MAX_PAGES && url; page++) {
      if (visited.has(url)) break;
      visited.add(url);

      const html = await this.fetchPage(url);
      const { parsed, nextUrl } = this.parsePage(html);
      events.push(...parsed);

      // Stop once the latest event on this page is past the cutoff.
      const maxDate = parsed.reduce<string>((m, e) => (e.date > m ? e.date : m), '');
      if (maxDate && maxDate >= cutoffStr) break;

      url = nextUrl;
    }

    // Deduplicate by id — pages can overlap on day boundaries.
    const byId = new Map<string, Event>();
    for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()];
  }

  parsePage(html: string): { parsed: Event[]; nextUrl: string | null } {
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

        // No real cast on the listing page. The `p.event-subtitle` line is a
        // program/works summary (program title + composer surnames, e.g.
        // "»Unter Wasser«: Dvořák / Zemlinsky"), NOT performers. The actual
        // BESETZUNG lives only on per-event detail pages, which are out of
        // scope here, so we leave cast null rather than mislabel program text.
        const cast: string[] | null = null;

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

    // The next chunk is referenced by a trailing loader element.
    const nextFragment = $('li[data-url]').last().attr('data-url') ?? null;
    const nextUrl = nextFragment ? new URL(nextFragment, BASE_URL + '/').href : null;

    return { parsed: events, nextUrl };
  }

  /** Back-compat: parse a single page of HTML into events. */
  parse(html: string): Event[] {
    return this.parsePage(html).parsed;
  }
}

export default new ElbphilharmonieHamburgScraper();
