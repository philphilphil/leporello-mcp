import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.teatroallascala.org';

/**
 * Subscription-type labels that appear in `address.mcl-evt-author` elements.
 * When the first (or only) author matches one of these patterns, it is not a
 * composer/choreographer name — skip it.
 */
const SUB_TYPE_PATTERNS = [
  /\bAbb\b/i,
  /\bTurno\b/i,
  /\bStagione\b/i,
  /\bAbbonamento\b/i,
  /\bFuori Abb\b/i,
  /\bInvito alla Scala\b/i,
];

function isSubscriptionLabel(text: string): boolean {
  return SUB_TYPE_PATTERNS.some((re) => re.test(text));
}

export class TeatroAllaScalaScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'teatro-alla-scala',
    venueName: 'Teatro alla Scala',
    cityId: 'milano',
    cityName: 'Milano',
    country: 'IT',
    scheduleUrl: 'https://www.teatroallascala.org/it/calendario.html',
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
    const seen = new Set<string>();

    $('article.mcl-evt').each((_, el) => {
      try {
        const $el = $(el);

        const title = $el.find('h2.mcl-evt-title').text().trim();
        if (!title) return;

        // Date and time from <time datetime="YYYY-MM-DDTHH:MM:SS">
        const datetime = $el.find('time.mcl-time').attr('datetime') ?? '';
        if (!datetime) return;

        const dtMatch = datetime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        if (!dtMatch) return;
        const date = dtMatch[1];
        const time = dtMatch[2];

        // Composer / choreographer from first address.mcl-evt-author
        // (second is subscription type — skip it)
        const authors = $el.find('address.mcl-evt-author').toArray();
        let composer: string | null = null;
        if (authors.length > 0) {
          const first = $(authors[0]).text().trim();
          if (!isSubscriptionLabel(first)) {
            composer = first;
          }
        }

        // Build display title: "Title (Composer)" like Wiener Staatsoper does
        const displayTitle = composer ? `${title} (${composer})` : title;

        // URL from parent <a> element
        const href = $el.parent('a').attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        // Deduplicate — same event appears multiple times for different subscription types
        const id = generateEventId(this.venueId, date, time, title);
        if (seen.has(id)) return;
        seen.add(id);

        events.push({
          id,
          venue_id: this.venueId,
          title: displayTitle,
          date,
          time,
          conductor: null,
          cast: null,
          location: null,
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
