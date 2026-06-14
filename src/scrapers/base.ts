import { createHash } from 'node:crypto';
import type { Event } from '../types.js';

export const USER_AGENT = 'Leporello/0.1 (classical-music-schedule-aggregator)';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Optional override for the Chromium binary Playwright launches. Unset in
// production (Playwright uses its bundled build); handy locally or in CI to
// point at an already-installed browser of a different build.
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;

/**
 * Fetch a page using a headless browser (Playwright/Chromium).
 * Use this for JS-rendered sites where plain fetch() returns empty HTML.
 * Waits for `waitForSelector` (CSS selector) to appear before extracting HTML.
 *
 * Uses `domcontentloaded` rather than `networkidle`: sites with persistent
 * connections (analytics beacons, websockets, long-polling) never go idle, so
 * `networkidle` would hang until the 30s navigation timeout. The
 * `waitForSelector` is what actually proves the content we want has rendered.
 */
export async function fetchRenderedHtml(
  url: string,
  opts: { waitForSelector?: string } = {},
): Promise<string> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH });
  try {
    const ctx = await browser.newContext({ userAgent: BROWSER_UA });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { timeout: 30_000 });
    }
    return await page.content();
  } finally {
    await browser.close();
  }
}

/**
 * Fetch one or more JSON endpoints that sit behind a bot-protection challenge
 * (e.g. Cloudflare) which 403s plain fetch() but lets a real browser through.
 * For each URL it opens a fresh browser context, navigates to `warmupUrl` so
 * the browser clears the challenge, then performs the JSON request from the
 * page context (same origin, so the clearance cookie is sent). Returns the
 * parsed JSON per URL, in order. Throws on a non-2xx response.
 *
 * Why a fresh context per request: Cloudflare mints a clearance on navigation
 * that only lets a single same-origin XHR through — the *second* fetch on the
 * same page load gets a "Just a moment..." JS challenge (403) that a background
 * fetch() can't solve. A new context per URL gives each request its own clean
 * clearance, so batches of monthly calls all succeed.
 */
export async function fetchJsonBatchViaBrowser(
  warmupUrl: string,
  apiUrls: string[],
): Promise<unknown[]> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH });
  try {
    const results: unknown[] = [];
    for (const apiUrl of apiUrls) {
      results.push(await fetchClearedJson(browser, warmupUrl, apiUrl));
    }
    return results;
  } finally {
    await browser.close();
  }
}

/**
 * One cleared JSON fetch: a fresh context + warm-up navigation + a single
 * same-origin fetch, retried (each attempt in its own context) until a 2xx.
 */
async function fetchClearedJson(
  browser: import('playwright').Browser,
  warmupUrl: string,
  apiUrl: string,
): Promise<unknown> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctx = await browser.newContext({ userAgent: BROWSER_UA });
    try {
      const page = await ctx.newPage();
      await page.goto(warmupUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const result = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
      }, apiUrl);
      if (result.ok) return result.body;
      lastStatus = result.status;
    } finally {
      await ctx.close();
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(`HTTP ${lastStatus} from ${apiUrl}`);
}

/** Single-URL convenience wrapper around {@link fetchJsonBatchViaBrowser}. */
export async function fetchJsonViaBrowser(
  warmupUrl: string,
  apiUrl: string,
): Promise<unknown> {
  const [result] = await fetchJsonBatchViaBrowser(warmupUrl, [apiUrl]);
  return result;
}

export interface VenueMeta {
  venueId: string;
  venueName: string;
  cityId: string;
  cityName: string;
  country: string; // ISO 3166-1 alpha-2, e.g. "DE"
  lat: number; // city-center latitude, decimal degrees
  lng: number; // city-center longitude, decimal degrees
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
