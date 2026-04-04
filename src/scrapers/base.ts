import { createHash } from 'node:crypto';
import type { Event } from '../types.js';

export const USER_AGENT = 'Leporello/0.1 (classical-music-schedule-aggregator)';

/**
 * Fetch a page using a headless browser (Playwright/Chromium).
 * Use this for JS-rendered sites where plain fetch() returns empty HTML.
 * Waits for `waitForSelector` (CSS selector) to appear before extracting HTML.
 */
export async function fetchRenderedHtml(
  url: string,
  opts: { waitForSelector?: string } = {},
): Promise<string> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: 15_000 });
    }
    return await page.content();
  } finally {
    await browser.close();
  }
}

export interface VenueMeta {
  venueId: string;
  venueName: string;
  cityId: string;
  cityName: string;
  country: string; // ISO 3166-1 alpha-2, e.g. "DE"
  scheduleUrl: string;
}

export interface Scraper {
  readonly venue: VenueMeta;
  get venueId(): string;
  scrape(): Promise<Event[]>;
}

/**
 * Derives a stable 16-char hex ID from venue + date + time + title.
 * Stable across scrape runs so upsert works correctly.
 */
export function generateEventId(
  venueId: string,
  date: string,
  time: string | null,
  title: string,
): string {
  const key = `${venueId}:${date}:${time ?? ''}:${title.toLowerCase().trim()}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
