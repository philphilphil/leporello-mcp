import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, type Scraper } from './base.js';

type FetchHtml = () => Promise<string>;

const SCHEDULE_URL = 'https://www.stuttgarter-philharmoniker.de/konzerte/';
const BASE_URL = 'https://www.stuttgarter-philharmoniker.de';

export class PhilharmonikerStuttgartScraper implements Scraper {
  readonly venueId = 'philharmoniker-stuttgart';

  constructor(private readonly opts: { fetchHtml?: FetchHtml } = {}) {}

  async scrape(): Promise<Event[]> {
    const html = this.opts.fetchHtml
      ? await this.opts.fetchHtml()
      : await fetch(SCHEDULE_URL).then((r) => r.text());
    return this.parse(html);
  }

  parse(html: string): Event[] {
    const $ = load(html);
    const events: Event[] = [];
    const now = new Date().toISOString();

    // Each concert is a div.item.stgtphil
    $('.item.stgtphil').each((_, el) => {
      try {
        // Date: prefer the datetime attribute on <time> for reliable parsing
        const timeEl = $(el).find('.date time').first();
        // datetime attr format is non-standard: "2026-04-10T19:30:00TCEST" (note "T" before timezone)
        // We extract only the date portion; time is parsed from text instead.
        const datetimeAttr = timeEl.attr('datetime') ?? '';
        const rawDateText = timeEl.text().trim();

        // Time: from .timelocation text, e.g. "19:30 | Gustav-Siegle-Haus"
        const rawTime = $(el).find('.timelocation').first().text().trim();

        // Title: the <a> inside .item-title h2
        const titleEl = $(el).find('.item-title h2 a').first();
        const title = titleEl.text().trim();
        const href = titleEl.attr('href') ?? '';

        if (!title || (!datetimeAttr && !rawDateText)) return;

        const date = parseDate(datetimeAttr, rawDateText);
        if (!date) return;

        const time = parseTime(rawTime);
        const url = href ? new URL(href, BASE_URL + '/').href : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
          venue_id: this.venueId,
          title,
          date,
          time,
          conductor: null,
          cast: null,
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

// Parse date from the <time datetime="..."> attribute or fallback to text like "10.04. – Freitag"
function parseDate(datetimeAttr: string, rawText: string): string | null {
  // Try datetime attribute: "2026-04-10T19:30:00TCEST" or "2026-04-10T..."
  const attrMatch = datetimeAttr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (attrMatch) return attrMatch[1];

  const currentYear = new Date().getFullYear();

  // Try DD.MM.YYYY in text
  let m = rawText.match(/(\d{1,2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1].padStart(2, '0')}`;

  // Try DD.MM. (infer year — if month already passed this year, use next year)
  m = rawText.match(/(\d{1,2})\.(\d{2})\./);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = m[2];
  const year =
    parseInt(month, 10) < new Date().getMonth() + 1 ? currentYear + 1 : currentYear;
  return `${year}-${month}-${day}`;
}

// "19:30 | Gustav-Siegle-Haus" or "19.30 Uhr" → "19:30"
function parseTime(raw: string): string | null {
  const m = raw.match(/(\d{2})[.:](\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}
