import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('logger (no Seq config)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.SEQ_URL;
    delete process.env.SEQ_API_KEY;
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

  it('flush() resolves immediately when Seq is disabled', async () => {
    const { flush } = await import('../logger.js');
    await expect(flush()).resolves.toBeUndefined();
  });
});

describe('logger (with Seq)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.SEQ_URL = 'https://seq.test';
    process.env.SEQ_API_KEY = 'test-key';
    process.env.SERVICE_NAME = 'web';
    vi.resetModules();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllGlobals();
    delete process.env.SEQ_URL;
    delete process.env.SEQ_API_KEY;
  });

  it('buffers events and sends CLEF to Seq on flush', async () => {
    const { log, flush } = await import('../logger.js');
    log('hello', { x: 1 });
    log('world', { y: 2 });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://seq.test/api/events/raw?clef');
    expect(opts.headers['X-Seq-ApiKey']).toBe('test-key');
    expect(opts.headers['Content-Type']).toBe('application/vnd.serilog.clef');
    const lines = (opts.body as string).split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ event: 'hello', x: 1, service: 'web', app: 'leporello' });
    expect(first['@t']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first['@mt']).toBe('hello');
  });

  it('flush() is a no-op when buffer is empty', async () => {
    await (await import('../logger.js')).flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Seq flush errors do not throw and re-queue events', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { log, flush } = await import('../logger.js');
    log('hi', {});
    await expect(flush()).resolves.toBeUndefined();
    const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrCalls).toContain('seq_flush_error');
    // Re-queued event is sent on next flush
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = fetchMock.mock.calls[1][1].body as string;
    expect(body).toContain('"hi"');
  });

  it('Seq non-2xx response re-queues events', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Internal Server Error' });
    fetchMock.mockResolvedValueOnce({ ok: true });
    const { log, flush } = await import('../logger.js');
    log('hi', {});
    await expect(flush()).resolves.toBeUndefined();
    const stderrCalls = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(stderrCalls).toContain('seq_flush_error');
    expect(stderrCalls).toContain('500');
    // Re-queued event is sent on next flush
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('hashClientIp', () => {
  beforeEach(() => {
    process.env.HASH_SALT = 'test-salt';
    vi.resetModules();
  });

  it('returns 16-char hex hash', async () => {
    const { hashClientIp } = await import('../logger.js');
    const h = hashClientIp('1.2.3.4', new Date('2026-04-07T12:00:00Z'));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same ip + same date → same hash', async () => {
    const { hashClientIp } = await import('../logger.js');
    const a = hashClientIp('1.2.3.4', new Date('2026-04-07T01:00:00Z'));
    const b = hashClientIp('1.2.3.4', new Date('2026-04-07T23:00:00Z'));
    expect(a).toBe(b);
  });

  it('same ip + different date → different hash', async () => {
    const { hashClientIp } = await import('../logger.js');
    const a = hashClientIp('1.2.3.4', new Date('2026-04-07T12:00:00Z'));
    const b = hashClientIp('1.2.3.4', new Date('2026-04-08T12:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('different ip + same date → different hash', async () => {
    const { hashClientIp } = await import('../logger.js');
    const a = hashClientIp('1.2.3.4', new Date('2026-04-07T12:00:00Z'));
    const b = hashClientIp('5.6.7.8', new Date('2026-04-07T12:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('returns null for null ip', async () => {
    const { hashClientIp } = await import('../logger.js');
    expect(hashClientIp(null, new Date())).toBeNull();
  });
});
