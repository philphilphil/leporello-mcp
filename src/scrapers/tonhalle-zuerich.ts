import { load, type CheerioAPI, type Element } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchHtml = () => Promise<string>;

const BASE_URL = 'https://tonhalle-orchester.ch';

const MONTH_ABBR: Record<string, string> = {
  Jan: '01', Feb: '02', Mär: '03', Mar: '03', Apr: '04', Mai: '05', May: '05',
  Jun: '06', Jul: '07', Aug: '08', Sep: '09', Okt: '10', Oct: '10', Nov: '11', Dez: '12', Dec: '12',
};

export class TonhalleZuerichScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'tonhalle-zuerich',
    venueName: 'Tonhalle-Orchester Zürich',
    cityId: 'zuerich',
    cityName: 'Zürich',
    country: 'CH',
    scheduleUrl: 'https://tonhalle-orchester.ch/konzerte/kalender/',
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

    // The calendar list contains interleaved month headers and event rows.
    // Month headers: <div data-month="04" class="row month">April 2026</div>
    // Event rows:    <div class="row data ...">...</div>
    let currentYear = String(new Date().getFullYear());
    let currentMonth = '';

    const allRows = $('div.js-calendarlist-list').children().toArray();

    for (const row of allRows) {
      const $row = $(row);

      // Month header
      if ($row.hasClass('month') && $row.attr('data-month')) {
        currentMonth = $row.attr('data-month')!;
        const monthText = $row.text().trim(); // "April 2026"
        const yearMatch = monthText.match(/(\d{4})/);
        if (yearMatch) currentYear = yearMatch[1];
        continue;
      }

      // Event row
      if (!$row.hasClass('data')) continue;

      try {
        const event = this.parseRow($, row, currentYear, currentMonth, now);
        if (event) events.push(event);
      } catch {
        // skip malformed entries silently
      }
    }

    return events;
  }

  private parseRow(
    $: CheerioAPI,
    el: Element,
    year: string,
    month: string,
    now: string,
  ): Event | null {
    const $el = $(el);

    // Title
    const title = $el.find('.event h3').first().text().trim();
    if (!title) return null;

    // Date: "Fr 03. Apr" — extract day number
    const dateText = $el.find('.date').first().text().trim();
    const dayMatch = dateText.match(/(\d{1,2})\./);
    if (!dayMatch) return null;
    const day = dayMatch[1].padStart(2, '0');

    // Use month from date text abbreviation if available, fall back to header month
    const monthAbbrMatch = dateText.match(/\.\s*(\w{3})/);
    let mm = month.padStart(2, '0');
    if (monthAbbrMatch) {
      const resolved = MONTH_ABBR[monthAbbrMatch[1]];
      if (resolved) mm = resolved;
    }

    const date = `${year}-${mm}-${day}`;

    // Time: "16.00 Uhr" → "16:00"
    const hourText = $el.find('.hour').first().text().trim();
    const timeMatch = hourText.match(/(\d{1,2})\.(\d{2})/);
    const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null;

    // Members: conductor ("Leitung") and cast
    let conductor: string | null = null;
    const cast: string[] = [];

    $el.find('.member .member-name').each((_, nameEl) => {
      const name = $(nameEl).text().trim();
      if (!name) return;
      // The function/role follows as a sibling .member-function
      const funcEl = $(nameEl).next('.member-function');
      const func = funcEl.text().trim().replace(/,\s*$/, '').replace(/,$/, '');

      if (func === 'Leitung') {
        conductor = name;
      } else if (name) {
        // Include performers with named roles, skip bare comma separators
        if (func && func !== ',') {
          cast.push(name);
        }
      }
    });

    // URL from the detail link
    const href = $el.find('a.desktop-linkoverlay').first().attr('href')
      ?? $el.find('a.mobile-linkoverlay').first().attr('href')
      ?? '';
    const url = href ? new URL(href, BASE_URL + '/').href : null;

    return {
      id: generateEventId(this.venueId, date, time, title),
      venue_id: this.venueId,
      title,
      date,
      time,
      conductor,
      cast: cast.length > 0 ? cast : null,
      location: null,
      url,
      scraped_at: now,
    };
  }
}
