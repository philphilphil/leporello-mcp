const SERVICE_NAME = process.env.SERVICE_NAME ?? 'unknown';

function writeLine(stream: NodeJS.WriteStream, event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ event, ...fields, timestamp: new Date().toISOString() }) + '\n';
  stream.write(line);
}

export function log(event: string, fields: Record<string, unknown> = {}): void {
  writeLine(process.stdout, event, fields);
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  writeLine(process.stderr, event, fields);
}

export async function flush(): Promise<void> {
  // No Axiom yet — nothing to flush
}

// Silence unused-var warning until Axiom wiring lands in Task 3
void SERVICE_NAME;
