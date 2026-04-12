import { createHash } from 'node:crypto';

const SERVICE_NAME = process.env.SERVICE_NAME ?? 'unknown';
const ENV_NAME = process.env.LEPORELLO_ENV ?? 'dev';
const SEQ_URL = process.env.SEQ_URL;
const SEQ_API_KEY = process.env.SEQ_API_KEY;
const HASH_SALT = process.env.HASH_SALT ?? '';

// Buffer CLEF lines and auto-flush every 5 seconds to Seq
const seqEnabled = !!(SEQ_URL && SEQ_API_KEY);
const buffer: string[] = [];
let flushing = false;

if (seqEnabled) {
  setInterval(() => { if (!flushing) flush(); }, 5_000).unref();
} else {
  process.stdout.write(
    JSON.stringify({
      event: 'seq_disabled',
      reason: SEQ_URL ? 'no_api_key' : 'no_url',
      timestamp: new Date().toISOString(),
    }) + '\n',
  );
}

function sendToSeq(event: string, fields: Record<string, unknown>): void {
  if (!seqEnabled) return;
  try {
    const clefEvent = JSON.stringify({
      '@t': new Date().toISOString(),
      '@mt': event,
      event,
      ...fields,
      app: 'leporello',
      service: SERVICE_NAME,
      env: ENV_NAME,
    });
    buffer.push(clefEvent);
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        event: 'seq_ingest_error',
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
  sendToSeq(event, fields);
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  writeLine(process.stderr, event, fields);
  sendToSeq(event, fields);
}

export async function flush(): Promise<void> {
  if (!seqEnabled || buffer.length === 0 || flushing) return;
  const batch = buffer.splice(0);
  flushing = true;
  try {
    const res = await fetch(`${SEQ_URL}/api/events/raw?clef`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.serilog.clef',
        'X-Seq-ApiKey': SEQ_API_KEY!,
      },
      body: batch.join('\n'),
    });
    if (!res.ok) {
      throw new Error(`Seq responded ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    buffer.unshift(...batch);
    process.stderr.write(
      JSON.stringify({
        event: 'seq_flush_error',
        error: String(err),
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  } finally {
    flushing = false;
  }
}

export function hashClientIp(ip: string | null, now: Date = new Date()): string | null {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return createHash('sha256').update(ip + HASH_SALT + day).digest('hex').slice(0, 16);
}
