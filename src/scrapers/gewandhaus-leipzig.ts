import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.gewandhausorchester.de';

export class GewandhausLeipzigScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'gewandhaus-leipzig',
    venueName: 'Gewandhaus',
    cityId: 'leipzig',
    cityName: 'Leipzig',
    country: 'DE',
    scheduleUrl: 'https://www.gewandhausorchester.de/',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    if (this.opts.fetchHtml) {
      const html = await this.opts.fetchHtml();
      return this.parse(html);
    }

    // The homepage shows the first batch; AJAX endpoint loads more with offset
    const allEvents: Event[] = [];

    // Fetch the homepage (first batch of events)
    const res = await fetch(this.venue.scheduleUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.venue.scheduleUrl}`);
    const homeHtml = await res.text();
    allEvents.push(...this.parse(homeHtml));

    // Extract AJAX URL for additional pages and fetch them
    const $ = load(homeHtml);
    let nextUrl = $('[data-ajax-url]').last().attr('data-ajax-url') ?? '';

    while (nextUrl) {
      const url = new URL(nextUrl, BASE_URL).href;
      const ajaxRes = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!ajaxRes.ok) break;
      const ajaxHtml = await ajaxRes.text();
      const parsed = this.parse(ajaxHtml);
      if (parsed.length === 0) break;
      allEvents.push(...parsed);

      // Look for the next "load more" AJAX URL
      const $ajax = load(ajaxHtml);
      const candidateUrl = $ajax('[data-ajax-url]').last().attr('data-ajax-url') ?? '';
      nextUrl = candidateUrl !== nextUrl ? candidateUrl : '';
    }

    return allEvents;
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('div.event-list__item').each((_, el) => {
      try {
        const $item = $(el);
        const $teaser = $item.find('.event-teaser').first();
        if (!$teaser.length) return;

        // Date from <time datetime="YYYY-MM-DD">
        const dateEl = $teaser.find('time[datetime]').first();
        const date = dateEl.attr('datetime') ?? '';
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

        // Time from .event-teaser__time text, e.g. " 15 Uhr" or " 19.30 Uhr"
        const timeRaw = $teaser.find('.event-teaser__time').first().text().trim();
        let time: string | null = null;
        const timeMatch = timeRaw.match(/(\d{1,2})(?:\.(\d{2}))?\s*Uhr/);
        if (timeMatch) {
          const hh = timeMatch[1].padStart(2, '0');
          const mm = timeMatch[2] ?? '00';
          time = `${hh}:${mm}`;
        }

        // Location: text after the time span in the same <p>, e.g. "Großer Saal"
        const timeParent = $teaser.find('.event-teaser__time').first().parent();
        const locationText = timeParent.contents().filter(function () {
          return this.type === 'text';
        }).text().trim();
        const location = locationText || null;

        // Title from h2 inside .event-teaser__short-description-link
        const $link = $teaser.find('.event-teaser__short-description-link').first();
        const title = $link.find('h2').first().text().trim();
        if (!title) return;

        // Subtitle (genre / description above the title)
        const subtitle = $link.find('p.h-color-highlight-primary').first().text().trim();

        // Full title: include subtitle if present
        const fullTitle = subtitle ? `${title} — ${subtitle}` : title;

        // Cast and conductor from the performers paragraph (after h2)
        // The paragraph contains names with <i> role descriptions
        let conductor: string | null = null;
        const cast: string[] = [];

        const $castP = $link.find('h2').first().nextAll('p').first();
        if ($castP.length) {
          // Parse each name/role pair from the HTML
          // Format: "Name1 <i>Role1</i>, Name2 <i>Role2</i>"
          const castHtml = $castP.html() ?? '';
          const parts = castHtml.split(',').map(s => s.trim()).filter(Boolean);

          for (const part of parts) {
            const $part = load(part);
            const role = $part('i').text().trim();
            $part('i').remove();
            const name = $part.root().text().trim();

            if (!name) continue;

            if (role && /Dirigent|Musikalische Leitung/i.test(role)) {
              conductor = name;
            } else if (name) {
              cast.push(role ? `${name} (${role})` : name);
            }
          }
        }

        // Detail URL
        const href = $link.attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title: fullTitle,
          date,
          time,
          conductor,
          cast: cast.length > 0 ? cast : null,
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
