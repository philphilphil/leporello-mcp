import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb } from './db.js';
import { startHttpServer } from './server.js';
import { log, logError, flush } from './logger.js';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = join(fileURLToPath(import.meta.url), '..', '..');

// Initialize DB — creates schema if needed
getDb();

// Build Astro frontend on startup
log('web_build_start');
const buildStart = Date.now();
try {
  await execFileAsync('npm', ['run', 'build', '--prefix', 'web'], {
    cwd: PROJECT_ROOT,
    timeout: 60_000,
  });
  log('web_build_success', { duration_ms: Date.now() - buildStart });
} catch (err) {
  logError('web_build_error', { error: String(err), duration_ms: Date.now() - buildStart });
}

const httpServer = startHttpServer();

async function shutdown(): Promise<void> {
  log('shutdown');
  httpServer.close();
  closeDb();
  // Flush logs with a 3-second timeout — don't hang the container
  try {
    await Promise.race([
      flush(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('flush timeout')), 3000)),
    ]);
  } catch (err) {
    process.stderr.write(`flush on shutdown failed: ${String(err)}\n`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
