import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = (url: string) => Promise<string>;

const BASE_URL = 'https://spielplan.musikverein.at';
const SPIELPLAN_URL = `${BASE_URL}/spielplan`;
const DAYS_AHEAD = 90; // stop paginating once events run past this window
const MAX_PAGES = 6; // safety cap; the 90-day cutoff normally stops sooner

/** Returns "YYYY-MM" for the month `offset` months after `from`. */
function monthKey(from: Date, offset: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Dedication / intro lines that sometimes occupy the first p.text slot instead
// of performers (e.g. "In memoriam …", concert-introduction blurbs).
const NON_PERFORMER_PREFIX = /^(in memoriam|klingende konzerteinf[üu]hrung|konzerteinf[üu]hrung|passwort)/i;

/**
 * True when `text` is a composer/works line rather than performers. On recital
 * listings the performer lives in the h3 heading and the first p.text holds a
 * list of bare composer surnames ("Beethoven • Schumann • Strauss",
 * "Haydn • Mozart • Dvořák"). Heuristic: >=2 tokens split on "•"/"," where every
 * token is a single capitalized word (no internal whitespace). This leaves real
 * performer lists intact — multi-word names ("Zoltán Despond • Vesselin Stanev")
 * and ensembles ("Wiener Philharmoniker", "Haydn-Quartett") all fail the test.
 */
function isComposerList(text: string): boolean {
  const tokens = text.split(/\s*[•,]\s*/).map(s => s.trim()).filter(Boolean);
  if (tokens.length < 2) return false;
  return tokens.every(t => !/\s/.test(t) && /^\p{Lu}/u.test(t));
}

export class MusikvereinWienScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'musikverein-wien',
    venueName: 'Musikverein',
    cityId: 'wien',
    cityName: 'Wien',
    country: 'AT',
    lat: 48.2082,
    lng: 16.3738,
    scheduleUrl: 'https://musikverein.at/spielplan',
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
    const now = new Date();
    const cutoff = new Date(now.getTime() + DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);

    // The default /spielplan page returns a rolling ~30-day window starting
    // today. Each subsequent month is reachable via ?month=YYYY-MM. We walk
    // forward month by month, deduping by id (pages overlap), until events run
    // past the 90-day cutoff or a page adds nothing new.
    const urls = [SPIELPLAN_URL];
    for (let i = 0; i < MAX_PAGES - 1; i++) {
      urls.push(`${SPIELPLAN_URL}?month=${monthKey(now, i + 1)}`);
    }

    const events: Event[] = [];
    const seen = new Set<string>();

    for (const url of urls) {
      const pageEvents = this.parse(await this.fetchPage(url));
      if (pageEvents.length === 0) break; // no more events published

      let added = 0;
      let reachedCutoff = false;
      for (const event of pageEvents) {
        if (event.date > cutoff) { reachedCutoff = true; continue; }
        if (seen.has(event.id)) continue; // overlap between window pages
        seen.add(event.id);
        events.push(event);
        added++;
      }
      // Same fixture served for every page (tests/analyze) or fully-overlapping
      // months add nothing new — stop rather than spin to MAX_PAGES.
      if (reachedCutoff) break;
      if (added === 0) break;
    }

    return events;
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    $('div.event').each((_, el) => {
      try {
        const $el = $(el);

        // --- Date & time from .event--date-time ---
        const dateTimeLink = $el.find('.event--date-time a').first();
        const paragraphs = dateTimeLink.find('p');

        // First <p>: date like "02.04.2026 "
        const rawDate = paragraphs.eq(0).text().trim();
        const dateMatch = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (!dateMatch) return;
        const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;

        // Second <p>: time like "20:00 Uhr  - 22:00 Uhr"
        const rawTime = paragraphs.eq(1).text().trim();
        const timeMatch = rawTime.match(/^(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : null;

        // Location: first <p class="text"> inside the date-time link (hall name)
        const locationParagraphs = dateTimeLink.find('p.text');
        const location = locationParagraphs.eq(0).text().trim() || null;

        // --- Title and performers from .event--main ---
        const mainLink = $el.find('.event--main a').first();
        const title = mainLink.find('h3.event--heading').text().trim();
        if (!title) return;

        // Collect non-veranstalter text paragraphs from .event--main
        const textParagraphs = mainLink.find('p.text').not('.veranstalter');

        // First text paragraph: performers/conductor (e.g. "Sir Simon Rattle" or "Hans Graf • Ziyu He")
        const performersText = textParagraphs.eq(0).text().trim();

        // Second text paragraph: composers (e.g. "Gustav Mahler" or "Rachmaninow • Hindemith")
        const composersText = textParagraphs.eq(1).text().trim();

        // Parse performers into cast array (split by bullet separator).
        // Guard: on recital listings the performer is in the h3 heading and this
        // first p.text is actually a composer/works line or a dedication/intro
        // line — never assign those to cast (keep cast null rather than mislabel).
        let cast: string[] | null = null;
        if (
          performersText &&
          !NON_PERFORMER_PREFIX.test(performersText) &&
          !isComposerList(performersText)
        ) {
          cast = performersText
            .split(/\s*[•|]\s*/)
            .map(s => s.trim())
            .filter(Boolean);
          if (cast.length === 0) cast = null;
        }

        // Build full title: append composers if present
        const fullTitle = composersText ? `${title} — ${composersText}` : title;

        // URL — hrefs in the markup are already absolute; resolve defensively.
        const href = mainLink.attr('href') ?? '';
        let url: string | null = null;
        if (href) {
          try { url = new URL(href, BASE_URL).href; } catch { url = null; }
        }

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title: fullTitle,
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

export default new MusikvereinWienScraper();
