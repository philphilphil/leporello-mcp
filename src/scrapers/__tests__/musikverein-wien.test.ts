import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { MusikvereinWienScraper } from '../musikverein-wien.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixturePage1 = readFileSync(new URL('../__fixtures__/musikverein-wien.html', import.meta.url), 'utf8');
const fixturePage2 = readFileSync(new URL('../__fixtures__/musikverein-wien-page2.html', import.meta.url), 'utf8');

const SCHEDULE_URL = 'https://spielplan.musikverein.at/spielplan';
const EMPTY = '<html><body></body></html>';

// The default /spielplan page is the rolling window; ?month=YYYY-MM pages cover
// later months. Serve page1 for the default URL, page2 for the first month
// page, then an empty page so pagination halts deterministically.
const pages: Record<string, string> = {
  [SCHEDULE_URL]: fixturePage1,
};
// First ?month= page (one month after "now") serves page2; later months empty.
function fetchFor(url: string): string {
  if (pages[url]) return pages[url];
  if (/\?month=/.test(url)) {
    // Serve page2 for exactly the first month page we haven't served yet.
    if (!servedPage2) { servedPage2 = true; return fixturePage2; }
    return EMPTY;
  }
  return EMPTY;
}
let servedPage2 = false;

const scraper = new MusikvereinWienScraper({
  fetchHtml: async (url: string) => fetchFor(url),
});

describe('MusikvereinWienScraper', () => {
  it('parses events from fixture', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date, time, and location', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const first = events[0];
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.time).toMatch(/^\d{2}:\d{2}$/);
    expect(first.location).toBeTruthy();
  });

  it('sets all required Event fields with valid shapes', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('musikverein-wien');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.time === null || /^\d{2}:\d{2}$/.test(e.time)).toBe(true);
      expect(e.conductor).toBeNull();
      expect(e.cast === null || Array.isArray(e.cast)).toBe(true);
      expect(e.url === null || e.url.startsWith('https://')).toBe(true);
      expect(e.scraped_at).toBeTruthy();
    }
  });

  it('extracts performers as cast', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    // Wiener Philharmoniker is the resident orchestra; its entries always carry
    // a conductor/soloist in the performers slot.
    const wienerPhil = events.find(e => e.title.includes('Wiener Philharmoniker'));
    expect(wienerPhil).toBeDefined();
    expect(wienerPhil!.cast).not.toBeNull();
    expect(wienerPhil!.cast!.length).toBeGreaterThan(0);
    expect(wienerPhil!.cast!.every(c => typeof c === 'string' && c.length > 0)).toBe(true);
  });

  it('splits multiple performers on the bullet separator', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const multi = events.find(e => e.cast && e.cast.length > 1);
    expect(multi).toBeDefined();
  });

  it('appends composers to title with an em-dash', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const withComposer = events.find(e => e.title.includes(' — '));
    expect(withComposer).toBeDefined();
  });

  it('does not mislabel composer/works or dedication lines as cast', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const byKonzertId = (id: string) => events.find(e => e.url?.includes(`id=${id}`));

    // Recital listings: the performer is in the h3 heading, so the first p.text
    // is a composer/works or dedication line — cast must be null, not those.
    const composerLine = byKonzertId('0006ba0d'); // h3: "Zoltán Despond • Vesselin Stanev"
    expect(composerLine).toBeDefined();
    expect(composerLine!.cast).toBeNull();

    const composerLine2 = byKonzertId('00117a08'); // h3: "Haydn-Quartett"
    expect(composerLine2).toBeDefined();
    expect(composerLine2!.cast).toBeNull();

    const dedication = byKonzertId('0011ea22'); // "In memoriam Tobias Stork"
    expect(dedication).toBeDefined();
    expect(dedication!.cast).toBeNull();

    const intro = byKonzertId('000e0b0f'); // "Klingende Konzerteinführung"
    expect(intro).toBeDefined();
    expect(intro!.cast).toBeNull();

    // No surviving cast entry should be a single bare composer surname list.
    for (const e of events) {
      if (!e.cast) continue;
      const allSingleWordSurnames =
        e.cast.length >= 2 && e.cast.every(c => !/\s/.test(c) && /^\p{Lu}/u.test(c));
      expect(allSingleWordSurnames).toBe(false);
    }
  });

  it('keeps real performers as cast (incl. multi-word and hyphenated names)', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const byKonzertId = (id: string) => events.find(e => e.url?.includes(`id=${id}`));

    // A genuine multi-performer recital — performers in the first p.text slot.
    const recital = byKonzertId('0006a3cb'); // "Topolina macht Pizza" → "Topolina"
    expect(recital).toBeDefined();
    expect(recital!.cast).toEqual(['Topolina']);
  });

  it('has absolute musikverein URLs for events', async () => {
    servedPage2 = false;
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const event of withUrl) {
      expect(event.url).toMatch(/^https:\/\/musikverein\.at\/konzert\//);
    }
  });

  it('paginates across month pages and dedupes overlaps', async () => {
    servedPage2 = false;
    const bothPages = await scraper.scrape();

    const singlePage = new MusikvereinWienScraper({
      fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
    });
    const onePage = await singlePage.scrape();

    expect(bothPages.length).toBeGreaterThan(onePage.length); // month page added events
    const ids = bothPages.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids across pages
  });

  it('deduplicates when the same window repeats across pages', async () => {
    const repeating = new MusikvereinWienScraper({
      fetchHtml: async () => fixturePage1, // every page returns the same window
    });
    const events = await repeating.scrape();
    expect(new Set(events.map(e => e.id)).size).toBe(events.length);

    const singlePage = new MusikvereinWienScraper({
      fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
    });
    const onePage = await singlePage.scrape();
    expect(events.length).toBe(onePage.length); // repeated window added nothing
  });

  testDbIntegration(new MusikvereinWienScraper({
    fetchHtml: async (url: string) => (url === SCHEDULE_URL ? fixturePage1 : EMPTY),
  }));
});
