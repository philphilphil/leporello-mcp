import { getDb } from './db.js';
import { scrapers, runScrapers } from './scheduler.js';

getDb();

const venueArg = process.argv[2];

if (venueArg) {
  const matched = scrapers.filter((s) => s.venueId === venueArg);
  if (matched.length === 0) {
    const ids = scrapers.map((s) => s.venueId).join(', ');
    console.error(`Unknown venue: "${venueArg}"\nAvailable: ${ids}`);
    process.exit(1);
  }
  await runScrapers(matched);
} else {
  await runScrapers(scrapers);
}

process.exit(0);
