import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = (url: string) => Promise<string>;

const BASE_URL = 'https://www.opernhaus.ch';
const CALENDAR_PATH = '/spielplan/kalendarium/';
const DAYS_AHEAD = 90; // stop paginating once events run past this window
const MAX_PAGES = 20; // safety cap; the 90-day cutoff normally stops sooner

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mär: '03', Mar: '03', Apr: '04', Mai: '05', May: '05',
  Jun: '06', Jul: '07', Aug: '08', Sep: '09', Okt: '10', Oct: '10', Nov: '11', Dez: '12', Dec: '12',
};

export class OpernhausZuerichScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'opernhaus-zuerich',
    venueName: 'Opernhaus Zürich',
    cityId: 'zuerich',
    cityName: 'Zürich',
    country: 'CH',
    scheduleUrl: 'https://www.opernhaus.ch/spielplan/kalendarium/',
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
    // The calendar paginates (page1 holds ~25 events spanning ~10 days), so we
    // walk pages until events run past the 90-day window or the list runs out.
    const cutoff = new Date(Date.now() + DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
    const events: Event[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1
        ? this.venue.scheduleUrl
        : `${BASE_URL}${CALENDAR_PATH}page${page}`;

      const pageEvents = this.parse(await this.fetchPage(url));
      if (pageEvents.length === 0) break; // no more event rows — last page reached

      let reachedCutoff = false;
      let addedFromPage = 0;
      for (const event of pageEvents) {
        if (event.date > cutoff) {
          reachedCutoff = true; // events are chronological — past the window
          continue;
        }
        if (seen.has(event.id)) continue; // page boundaries overlap by one date
        seen.add(event.id);
        events.push(event);
        addedFromPage++;
      }
      if (reachedCutoff) break;
      // If a full page yielded nothing new (e.g. the same page served twice),
      // stop rather than spinning to MAX_PAGES.
      if (addedFromPage === 0) break;
    }

    return events;
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    // Track the current date from "first" items that have day/month spans
    let currentYear = '';
    let currentMonth = '';
    let currentDay = '';

    // Extract year from the month header (e.g. "April 2026")
    const monthHeader = $('h2.new-month').first().text().trim();
    const headerYearMatch = monthHeader.match(/(\d{4})/);
    const defaultYear = headerYearMatch ? headerYearMatch[1] : String(new Date().getFullYear());

    $('div.el-eventlistitem').each((_, el) => {
      try {
        const $el = $(el);

        const title = $el.find('.details .inner h2').first().text().trim();
        if (!title) return;

        // Try to extract date/time from the preceding JSON-LD script
        let date: string | null = null;
        let time: string | null = null;

        const ldScript = $el.find('script[type="application/ld+json"]').first().text();
        if (ldScript) {
          try {
            const ld = JSON.parse(ldScript);
            if (ld.startDate) {
              // startDate format: "2026-04-02T19:00"
              const m = ld.startDate.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
              if (m) {
                date = m[1];
                time = m[2];
              }
            }
          } catch {
            // fall through to HTML parsing
          }
        }

        // Fallback: parse date from HTML
        if (!date) {
          const dateDiv = $el.find('.date').first();
          const daySpan = dateDiv.find('.day').text().trim();
          const monthSpan = dateDiv.find('.month').text().trim();

          if (daySpan && monthSpan) {
            currentDay = daySpan.padStart(2, '0');
            currentMonth = MONTH_MAP[monthSpan] ?? '';
            currentYear = defaultYear;
          }

          if (currentDay && currentMonth && currentYear) {
            date = `${currentYear}-${currentMonth}-${currentDay}`;
          }

          // Parse time from the second <p> in date div (e.g. "19.00")
          const timeParagraphs = dateDiv.find('p');
          const lastP = timeParagraphs.last().text().trim();
          const timeMatch = lastP.match(/^(\d{1,2})\.(\d{2})$/);
          if (timeMatch) {
            time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
          }
        }

        if (!date) return;

        const location = $el.find('.details .inner .location').first().text().trim() || null;

        const href = $el.find('a.link-box').attr('href') ?? '';
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        // Extract description for enrichment (e.g. "Oper von Jean-Marie Leclair")
        const description = $el.find('.details .inner .description').first().text().trim()
          .replace(/CHF\s+[\d\s/s<>]+/g, '')  // remove price info
          .replace(/\s+/g, ' ')
          .trim();

        // Build title with composer/description suffix if available
        let fullTitle = title;
        if (description) {
          // Extract meaningful description (e.g. "Oper von Jean-Marie Leclair")
          // Skip noise like "Geschlossene Vorstellung", price text, "AMAG Volksvorstellung"
          const descClean = description
            .replace(/Restkarten.*$/i, '')
            .replace(/AMAG Volksvorstellung/i, '')
            .replace(/Geschlossene Vorstellung/i, '')
            .replace(/Opernhaustag/i, '')
            .replace(/zum letzten Mal/i, '')
            .replace(/●/g, '')
            .trim();

          // Match patterns like "Oper von Name" or "Ballett von Name" or "Musiktheater von Name"
          const composerMatch = descClean.match(/(?:Oper|Ballett|Musiktheater|Requiem)\s+von\s+(.+)/i);
          if (composerMatch) {
            fullTitle = `${title} (${composerMatch[1].trim()})`;
          }
        }

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

export default new OpernhausZuerichScraper();
