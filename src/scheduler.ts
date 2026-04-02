import cron from 'node-cron';
import { upsertEvents, updateLastScraped } from './db.js';
import type { Scraper } from './scrapers/base.js';
import { PhilharmonikerStuttgartScraper } from './scrapers/philharmoniker-stuttgart.js';
import { StaatsoperStuttgartScraper } from './scrapers/staatsoper-stuttgart.js';

const scrapers: Scraper[] = [
  new PhilharmonikerStuttgartScraper(),
  new StaatsoperStuttgartScraper(),
];

export async function runAllScrapers(): Promise<void> {
  for (const scraper of scrapers) {
    const start = Date.now();
    console.log(JSON.stringify({ event: 'scrape_start', venue: scraper.venueId }));
    try {
      const events = await scraper.scrape();
      upsertEvents(events);
      const ts = new Date().toISOString();
      updateLastScraped(scraper.venueId, ts);
      console.log(
        JSON.stringify({
          event: 'scrape_success',
          venue: scraper.venueId,
          count: events.length,
          duration_ms: Date.now() - start,
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'scrape_error',
          venue: scraper.venueId,
          error: String(err),
          duration_ms: Date.now() - start,
        }),
      );
    }
  }
}

export function startScheduler(): void {
  const expr = process.env.SCRAPE_CRON ?? '0 3 * * *';
  console.log(JSON.stringify({ event: 'scheduler_start', cron: expr }));
  cron.schedule(expr, () => {
    runAllScrapers().catch(console.error);
  });
}
