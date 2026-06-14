import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.gewandhausorchester.de';

// Full schedule lives behind the site's Apache Solr search (`/suche/`), not the
// homepage teaser (which only shows the next few events). `q=*` with a
// server-side `concert_dateS` date filter returns every concert in the window,
// in the same event-teaser markup the homepage uses. Results paginate via
// `groupPage` (10 per page); an out-of-range page returns zero events.
const HORIZON_DAYS = 365;
// Pagination normally ends when a page returns zero events (~62 pages for a
// full year). MAX_PAGES is only a runaway guard for the case where the date
// filter stops working — set well above the expected page count so it never
// truncates real results.
const MAX_PAGES = 120;

// Solr expects a `YYYYMMDDHHMM` timestamp for the concert_dateS filter.
function solrTimestamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}0000`;
}

export class GewandhausLeipzigScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'gewandhaus-leipzig',
    venueName: 'Gewandhaus',
    cityId: 'leipzig',
    cityName: 'Leipzig',
    country: 'DE',
    lat: 51.3397,
    lng: 12.3731,
    scheduleUrl: 'https://www.gewandhausorchester.de/',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    if (this.opts.fetchHtml) {
      const html = await this.opts.fetchHtml();
      return this.parse(html);
    }

    const events: Event[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = this.searchUrl(page);
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) {
        // The first page must succeed; tolerate a mid-pagination hiccup.
        if (page === 1) throw new Error(`HTTP ${res.status} from ${url}`);
        break;
      }

      const parsed = this.parse(await res.text());
      if (parsed.length === 0) break; // past the last page

      let added = 0;
      for (const ev of parsed) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        events.push(ev);
        added++;
      }
      if (added === 0) break; // page yielded only duplicates → stop
    }

    return events;
  }

  // Builds the Solr search URL for one result page, bounded to the next
  // HORIZON_DAYS so the crawl terminates instead of walking years of future
  // seasons.
  private searchUrl(page: number): string {
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + HORIZON_DAYS);
    const params = new URLSearchParams({
      'tx_solr[q]': '*',
      'tx_solr[filter][concert_dateS]': `concert_dateS:${solrTimestamp(now)}-${solrTimestamp(end)}`,
      'tx_solr[groupPage][concert][altTypestringSconcert]': String(page),
    });
    return `${BASE_URL}/suche/?${params.toString()}`;
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

        // Title from h2 inside .event-teaser__short-description-link.
        // The h2 leads with a screen-reader-only "Veranstaltung:" label
        // (<span class="h-only-screenreader-text">) that must be removed so it
        // doesn't leak into the stored title.
        const $link = $teaser.find('.event-teaser__short-description-link').first();
        const $title = $link.find('h2').first().clone();
        $title.find('.h-only-screenreader-text').remove();
        const title = $title.text().trim();
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

export default new GewandhausLeipzigScraper();
