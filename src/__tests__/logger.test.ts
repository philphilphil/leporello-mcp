import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('logger (no Axiom token)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.AXIOM_TOKEN;
    delete process.env.AXIOM_DATASET;
    process.env.SERVICE_NAME = 'test';
    vi.resetModules();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('writes a JSON line to stdout for log()', async () => {
    const { log } = await import('../logger.js');
    log('test_event', { foo: 'bar' });
    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const line = calls.find((l: string) => l.includes('test_event'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!.trim());
    expect(parsed.event).toBe('test_event');
    expect(parsed.foo).toBe('bar');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('writes a JSON line to stderr for logError()', async () => {
    const { logError } = await import('../logger.js');
    logError('boom', { error: 'nope' });
    const calls = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const line = calls.find((l: string) => l.includes('boom'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!.trim());
    expect(parsed.event).toBe('boom');
    expect(parsed.error).toBe('nope');
  });

  it('flush() resolves immediately when Axiom is disabled', async () => {
    const { flush } = await import('../logger.js');
    await expect(flush()).resolves.toBeUndefined();
  });
});

describe('logger (with Axiom)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const ingestMock = vi.fn();
  const flushMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    process.env.AXIOM_TOKEN = 'test-token';
    process.env.AXIOM_DATASET = 'test-dataset';
    process.env.SERVICE_NAME = 'web';
    ingestMock.mockReset();
    flushMock.mockClear();
    vi.resetModules();
    vi.doMock('@axiomhq/js', () => ({
      Axiom: vi.fn().mockImplementation(function () {
        return { ingest: ingestMock, flush: flushMock };
      }),
    }));
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.doUnmock('@axiomhq/js');
    delete process.env.AXIOM_TOKEN;
    delete process.env.AXIOM_DATASET;
  });

  it('forwards events to Axiom with service tag and _time', async () => {
    const { log } = await import('../logger.js');
    log('hello', { x: 1 });
    expect(ingestMock).toHaveBeenCalledTimes(1);
    const [dataset, events] = ingestMock.mock.calls[0];
    expect(dataset).toBe('test-dataset');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'hello', x: 1, service: 'web' });
    expect(events[0]._time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('flush() awaits Axiom flush', async () => {
    const { flush } = await import('../logger.js');
    await flush();
    expect(flushMock).toHaveBeenCalledTimes(1);
  });

  it('Axiom ingest errors do not throw to caller', async () => {
    ingestMock.mockImplementation(() => {
      throw new Error('axiom down');
    });
    const { log } = await import('../logger.js');
    expect(() => log('hi', {})).not.toThrow();
    // Error reported to stderr
    const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrCalls).toContain('axiom_ingest_error');
  });
});
