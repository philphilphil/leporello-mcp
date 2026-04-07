import { getDb } from './db.js';
import { scrapers, runScrapers } from './scheduler.js';
import { logError, flush } from './logger.js';

getDb();

const venueArg = process.argv[2];

try {
  if (venueArg) {
    const matched = scrapers.filter((s) => s.venueId === venueArg);
    if (matched.length === 0) {
      const ids = scrapers.map((s) => s.venueId).join(', ');
      logError('unknown_venue', { venue: venueArg, available: ids });
      process.exit(1);
    }
    await runScrapers(matched);
  } else {
    await runScrapers(scrapers);
  }
} finally {
  await flush();
}

process.exit(0);
