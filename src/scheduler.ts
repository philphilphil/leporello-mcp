import cron from 'node-cron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceVenueEvents, updateLastScraped, updateScrapeError, upsertCity, upsertVenue } from './db.js';
import { validateEvents } from './validate.js';
import type { Scraper } from './scrapers/base.js';
import { PhilharmonikerStuttgartScraper } from './scrapers/philharmoniker-stuttgart.js';
import { StaatsoperStuttgartScraper } from './scrapers/staatsoper-stuttgart.js';
import { MetropolitanOperaScraper } from './scrapers/metropolitan-opera.js';
import { WienerStaatsoperScraper } from './scrapers/wiener-staatsoper.js';
import { OperFrankfurtScraper } from './scrapers/oper-frankfurt.js';
import { SanFranciscoOperaScraper } from './scrapers/san-francisco-opera.js';
import { LiceuBarcelonaScraper } from './scrapers/liceu-barcelona.js';
import { SemperoperDresdenScraper } from './scrapers/semperoper-dresden.js';
import { ArenaDiVeronaScraper } from './scrapers/arena-di-verona.js';

const execFileAsync = promisify(execFile);

export async function rebuildWeb(): Promise<void> {
  console.log(JSON.stringify({ event: 'web_build_start' }));
  const start = Date.now();
  try {
    await execFileAsync('npm', ['run', 'build', '--prefix', 'web'], {
      cwd: path.join(fileURLToPath(import.meta.url), '..', '..'),
      timeout: 60_000,
    });
    console.log(
      JSON.stringify({ event: 'web_build_success', duration_ms: Date.now() - start })
    );
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'web_build_error', error: String(err), duration_ms: Date.now() - start })
    );
  }
}

export const scrapers: Scraper[] = [
  new PhilharmonikerStuttgartScraper(),
  new StaatsoperStuttgartScraper(),
  new MetropolitanOperaScraper(),
  new WienerStaatsoperScraper(),
  new OperFrankfurtScraper(),
  new SanFranciscoOperaScraper(),
  new LiceuBarcelonaScraper(),
  new SemperoperDresdenScraper(),
  new ArenaDiVeronaScraper(),
];

export async function runScrapers(list: Scraper[]): Promise<void> {
  for (const scraper of list) {
    const { venueId, venueName, cityId, cityName, country, scheduleUrl } = scraper.venue;
    upsertCity(cityId, cityName, country);
    upsertVenue(venueId, venueName, cityId, scheduleUrl);

    console.log(JSON.stringify({ event: 'scrape_start', venue: scraper.venueId }));

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 5_000));
      const start = Date.now();
      try {
        const events = await scraper.scrape();
        const validation = validateEvents(scraper.venueId, events);
        if (!validation.valid) {
          const msg = validation.errors.join('; ');
          if (attempt === 2) updateScrapeError(scraper.venueId, msg);
          console.error(
            JSON.stringify({
              event: 'scrape_validation_error',
              venue: scraper.venueId,
              errors: validation.errors,
              duration_ms: Date.now() - start,
              attempt,
              final: attempt === 2,
            }),
          );
          continue;
        }
        replaceVenueEvents(scraper.venueId, events);
        const ts = new Date().toISOString();
        updateLastScraped(scraper.venueId, ts);
        console.log(
          JSON.stringify({
            event: 'scrape_success',
            venue: scraper.venueId,
            count: events.length,
            duration_ms: Date.now() - start,
            ...(attempt > 1 && { attempt }),
          }),
        );
        break;
      } catch (err) {
        if (attempt === 2) updateScrapeError(scraper.venueId, String(err));
        console.error(
          JSON.stringify({
            event: 'scrape_error',
            venue: scraper.venueId,
            error: String(err),
            duration_ms: Date.now() - start,
            attempt,
            final: attempt === 2,
          }),
        );
      }
    }
  }

  await rebuildWeb();
}

export async function runAllScrapers(): Promise<void> {
  await runScrapers(scrapers);
}

export function startScheduler(): void {
  const expr = process.env.SCRAPE_CRON ?? '0 3 * * *';
  console.log(JSON.stringify({ event: 'scheduler_start', cron: expr }));
  cron.schedule(expr, () => {
    runAllScrapers().catch(console.error);
  });
}
