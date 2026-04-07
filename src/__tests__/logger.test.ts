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
    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    const line = calls.find((l) => l.includes('test_event'));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!.trim());
    expect(parsed.event).toBe('test_event');
    expect(parsed.foo).toBe('bar');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('writes a JSON line to stderr for logError()', async () => {
    const { logError } = await import('../logger.js');
    logError('boom', { error: 'nope' });
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const line = calls.find((l) => l.includes('boom'));
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
