import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { startHttpServer } from './server.js';
import { startScheduler, rebuildWeb } from './scheduler.js';

// Initialize DB — creates schema if needed
getDb();

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

// Build frontend immediately if missing, so the page isn't blank on startup
const webIndex = join(fileURLToPath(import.meta.url), '..', '..', 'web', 'dist', 'index.html');
if (!existsSync(webIndex)) {
  await rebuildWeb();
}
