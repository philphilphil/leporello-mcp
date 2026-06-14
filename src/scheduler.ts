import { readdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { replaceVenueEvents, updateLastScraped, updateScrapeError, upsertCity, upsertVenue } from './db.js';
import { validateEvents } from './validate.js';
import { log, logError } from './logger.js';
import type { Scraper } from './scrapers/base.js';

// ── Scraper discovery ───────────────────────────────────────────────────────
// Scrapers are auto-discovered from the scrapers/ directory: every module there
// that has a `export default new XScraper()` is registered. Adding a venue means
// adding one file — no central registry edit — so parallel scraper PRs never
// conflict on this file. See CONTRIBUTING.md §5.

const here = fileURLToPath(import.meta.url); // src/scheduler.ts (dev) or dist/scheduler.js (prod)
const SCRAPER_EXT = extname(here); // '.ts' under tsx, '.js' after build
const SCRAPERS_DIR = join(dirname(here), 'scrapers');

// Files in scrapers/ that are not themselves venue scrapers.
const NON_SCRAPER_MODULES = new Set(['base']);

function isScraper(x: unknown): x is Scraper {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as Scraper).scrape === 'function' &&
    typeof (x as Scraper).venueId === 'string' &&
    typeof (x as Scraper).venue === 'object'
  );
}

/**
 * Discover and instantiate every scraper in scrapers/. Returns them sorted by
 * filename for deterministic run/log order. A module that fails to import or
 * lacks a valid default export is logged and skipped — one bad scraper never
 * blocks the rest of the batch.
 */
export async function loadScrapers(): Promise<Scraper[]> {
  const moduleNames = readdirSync(SCRAPERS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(SCRAPER_EXT) && !e.name.endsWith(`.d${SCRAPER_EXT}`))
    .map((e) => e.name.slice(0, -SCRAPER_EXT.length))
    .filter((name) => !NON_SCRAPER_MODULES.has(name))
    .sort();

  const scrapers: Scraper[] = [];
  for (const name of moduleNames) {
    const url = pathToFileURL(join(SCRAPERS_DIR, name + SCRAPER_EXT)).href;
    let mod: { default?: unknown };
    try {
      mod = (await import(url)) as { default?: unknown };
    } catch (err) {
      logError('scraper_load_error', { file: name, error: String(err) });
      continue;
    }
    if (!isScraper(mod.default)) {
      logError('scraper_load_error', {
        file: name,
        error: 'no valid default export (expected `export default new XScraper()`)',
      });
      continue;
    }
    scrapers.push(mod.default);
  }
  return scrapers;
}

export async function runScrapers(list: Scraper[]): Promise<void> {
  for (const scraper of list) {
    const { venueId, venueName, cityId, cityName, country, lat, lng, scheduleUrl } = scraper.venue;
    upsertCity(cityId, cityName, country, lat, lng);
    upsertVenue(venueId, venueName, cityId, scheduleUrl);

    log('scrape_start', { venue: scraper.venueId });

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 5_000));
      const start = Date.now();
      try {
        const events = await scraper.scrape();
        const validation = validateEvents(scraper.venueId, events);
        if (!validation.valid) {
          const msg = validation.errors.join('; ');
          if (attempt === 2) updateScrapeError(scraper.venueId, msg);
          logError('scrape_validation_error', {
            venue: scraper.venueId,
            errors: validation.errors,
            duration_ms: Date.now() - start,
            attempt,
            final: attempt === 2,
          });
          continue;
        }
        replaceVenueEvents(scraper.venueId, events);
        const ts = new Date().toISOString();
        updateLastScraped(scraper.venueId, ts);
        log('scrape_success', {
          venue: scraper.venueId,
          count: events.length,
          duration_ms: Date.now() - start,
          ...(attempt > 1 && { attempt }),
        });
        break;
      } catch (err) {
        if (attempt === 2) updateScrapeError(scraper.venueId, String(err));
        logError('scrape_error', {
          venue: scraper.venueId,
          error: String(err),
          duration_ms: Date.now() - start,
          attempt,
          final: attempt === 2,
        });
      }
    }
  }

}
