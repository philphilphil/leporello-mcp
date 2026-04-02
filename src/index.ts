import { getDb } from './db.js';
import { createMcpServer, startHttpServer } from './server.js';
import { startScheduler, runAllScrapers } from './scheduler.js';

// Initialize DB — creates schema and seeds cities/venues
const db = getDb();

const mcpServer = createMcpServer();
startHttpServer(mcpServer);
startScheduler();

// On first run (empty events table), scrape immediately rather than waiting for 03:00
const { count } = db
  .prepare('SELECT COUNT(*) AS count FROM events')
  .get() as { count: number };

if (count === 0) {
  console.log(JSON.stringify({ event: 'initial_scrape_triggered' }));
  runAllScrapers().catch(console.error);
}
