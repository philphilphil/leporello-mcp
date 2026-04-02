import { getDb, closeDb } from './db.js';
import { startHttpServer } from './server.js';
import { startScheduler, runAllScrapers } from './scheduler.js';

// Initialize DB — creates schema and seeds cities/venues
const db = getDb();

const httpServer = startHttpServer();
startScheduler();

function shutdown() {
  console.log(JSON.stringify({ event: 'shutdown' }));
  httpServer.close();
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// On first run (empty events table), scrape immediately rather than waiting for 03:00
const { count } = db
  .prepare('SELECT COUNT(*) AS count FROM events')
  .get() as { count: number };

if (count === 0) {
  console.log(JSON.stringify({ event: 'initial_scrape_triggered' }));
  runAllScrapers().catch(console.error);
}
