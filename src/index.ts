import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { startHttpServer } from './server.js';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = join(fileURLToPath(import.meta.url), '..', '..');

// Initialize DB — creates schema if needed
getDb();

// Build Astro frontend on startup
console.log(JSON.stringify({ event: 'web_build_start' }));
const buildStart = Date.now();
try {
  await execFileAsync('npm', ['run', 'build', '--prefix', 'web'], {
    cwd: PROJECT_ROOT,
    timeout: 60_000,
  });
  console.log(
    JSON.stringify({ event: 'web_build_success', duration_ms: Date.now() - buildStart }),
  );
} catch (err) {
  console.error(
    JSON.stringify({ event: 'web_build_error', error: String(err), duration_ms: Date.now() - buildStart }),
  );
}

const httpServer = startHttpServer();

function shutdown() {
  console.log(JSON.stringify({ event: 'shutdown' }));
  httpServer.close();
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
