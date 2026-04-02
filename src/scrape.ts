import { getDb } from './db.js';
import { runAllScrapers } from './scheduler.js';

getDb();
await runAllScrapers();
process.exit(0);
