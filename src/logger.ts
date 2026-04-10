import { createHash } from 'node:crypto';
import { Axiom } from '@axiomhq/js';

const SERVICE_NAME = process.env.SERVICE_NAME ?? 'unknown';
const ENV_NAME = process.env.LEPORELLO_ENV ?? 'dev';
const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_DATASET = process.env.AXIOM_DATASET;
const HASH_SALT = process.env.HASH_SALT ?? '';

const axiom: Axiom | null =
  AXIOM_TOKEN && AXIOM_DATASET ? new Axiom({ token: AXIOM_TOKEN }) : null;

if (!axiom) {
  process.stdout.write(
    JSON.stringify({
      event: 'axiom_disabled',
      reason: AXIOM_TOKEN ? 'no_dataset' : 'no_token',
      timestamp: new Date().toISOString(),
    }) + '\n',
  );
}

function sendToAxiom(event: string, fields: Record<string, unknown>): void {
  if (!axiom) return;
  try {
    axiom.ingest(AXIOM_DATASET!, [
      { event, ...fields, _time: new Date().toISOString(), app: 'leporello', service: SERVICE_NAME, env: ENV_NAME },
    ]);
  } catch (err) {
    // Never re-throw, never re-send to Axiom (avoid loops)
    process.stderr.write(
      JSON.stringify({
        event: 'axiom_ingest_error',
        error: String(err),
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }
}

function writeLine(stream: NodeJS.WriteStream, event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ event, ...fields, timestamp: new Date().toISOString() }) + '\n';
  stream.write(line);
}

export function log(event: string, fields: Record<string, unknown> = {}): void {
  writeLine(process.stdout, event, fields);
  sendToAxiom(event, fields);
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  writeLine(process.stderr, event, fields);
  sendToAxiom(event, fields);
}

export async function flush(): Promise<void> {
  if (!axiom) return;
  try {
    await axiom.flush();
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        event: 'axiom_flush_error',
        error: String(err),
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }
}

export function hashClientIp(ip: string | null, now: Date = new Date()): string | null {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return createHash('sha256').update(ip + HASH_SALT + day).digest('hex').slice(0, 16);
}
