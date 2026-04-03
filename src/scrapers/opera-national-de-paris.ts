import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://www.operadeparis.fr';

/**
 * French month abbreviations used in date strings on operadeparis.fr.
 * Full months ("janvier") and abbreviated months ("janv.") both appear.
 */
const FRENCH_MONTHS: Record<string, string> = {
  'janvier': '01', 'janv.': '01', 'janv': '01', 'jan.': '01', 'jan': '01',
  'février': '02', 'févr.': '02', 'févr': '02', 'fév.': '02', 'fév': '02',
  'mars': '03', 'mar.': '03', 'mar': '03',
  'avril': '04', 'avr.': '04', 'avr': '04',
  'mai': '05',
  'juin': '06',
  'juillet': '07', 'juil.': '07', 'juil': '07',
  'août': '08',
  'septembre': '09', 'sept.': '09', 'sept': '09',
  'octobre': '10', 'oct.': '10', 'oct': '10',
  'novembre': '11', 'nov.': '11', 'nov': '11',
  'décembre': '12', 'déc.': '12', 'déc': '12',
};

/**
 * Parse a French date string from operadeparis.fr.
 *
 * Examples:
 *   "du 12 mars  au 18 avr. 2026"  → { date: "2026-03-12", time: null }
 *   "le 06 avr. 2026 à 18h30"      → { date: "2026-04-06", time: "18:30" }
 *   "du 07  au 12 avr. 2026"        → { date: "2026-04-07", time: null }
 *   "du 28 mai  au 14 juin 2026"    → { date: "2026-05-28", time: null }
 */
function parseFrenchDate(text: string): { date: string; time: string | null } | null {
  // Normalize whitespace
  const s = text.replace(/\s+/g, ' ').trim();

  // Single date: "le DD month YYYY à HHhMM"
  const singleMatch = s.match(
    /le\s+(\d{1,2})\s+(\S+)\s+(\d{4})(?:\s+à\s+(\d{1,2})h(\d{2}))?/i,
  );
  if (singleMatch) {
    const day = singleMatch[1].padStart(2, '0');
    const mm = FRENCH_MONTHS[singleMatch[2].toLowerCase()];
    const year = singleMatch[3];
    if (!mm) return null;
    const time = singleMatch[4]
      ? `${singleMatch[4].padStart(2, '0')}:${singleMatch[5]}`
      : null;
    return { date: `${year}-${mm}-${day}`, time };
  }

  // Range with different months: "du DD month au DD month YYYY"
  const rangeFullMatch = s.match(
    /du\s+(\d{1,2})\s+(\S+)\s+au\s+(\d{1,2})\s+(\S+)\s+(\d{4})/i,
  );
  if (rangeFullMatch) {
    const day = rangeFullMatch[1].padStart(2, '0');
    const mm = FRENCH_MONTHS[rangeFullMatch[2].toLowerCase()];
    const year = rangeFullMatch[5];
    if (!mm) return null;
    return { date: `${year}-${mm}-${day}`, time: null };
  }

  // Range within same month: "du DD au DD month YYYY"
  const rangeSameMonthMatch = s.match(
    /du\s+(\d{1,2})\s+au\s+(\d{1,2})\s+(\S+)\s+(\d{4})/i,
  );
  if (rangeSameMonthMatch) {
    const day = rangeSameMonthMatch[1].padStart(2, '0');
    const mm = FRENCH_MONTHS[rangeSameMonthMatch[3].toLowerCase()];
    const year = rangeSameMonthMatch[4];
    if (!mm) return null;
    return { date: `${year}-${mm}-${day}`, time: null };
  }

  return null;
}

export class OperaNationalDeParisScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'opera-national-de-paris',
    venueName: 'Opéra National de Paris',
    cityId: 'paris',
    cityName: 'Paris',
    country: 'FR',
    scheduleUrl: 'https://www.operadeparis.fr/programmation/saison-25-26',
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

    $('.FeaturedList__card').each((_, el) => {
      try {
        const $card = $(el);

        const title = $card.find('.show__title').first().text().trim();
        const author = $card.find('.show__author').first().text().trim();
        const genre = $card.find('.show__genre').first().text().trim();
        const location = $card.find('.show__place span').first().text().trim() || null;
        const dateText = $card.find('.show__date span').first().text().trim();

        if (!title || !dateText) return;

        const parsed = parseFrenchDate(dateText);
        if (!parsed) return;

        const { date, time } = parsed;

        const fullTitle = author ? `${title} — ${author}` : title;
        if (genre) {
          // prefix with genre for clarity
        }

        const href = $card.find('a').first().attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title: fullTitle,
          date,
          time,
          conductor: null,
          cast: null,
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
