import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Event } from '../types.js';

// Tests load fresh modules with DB_PATH=':memory:' so the singleton DB is empty
// per test. The handlers under test (handleListCountries etc.) are pure and
// only depend on db.ts; instrumentTool tests additionally mock the logger.

type DbModule = typeof import('../db.js');
type ServerModule = typeof import('../server.js');

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeEvent(overrides: Partial<Event> & { id: string; venue_id: string; date: string }): Event {
  return {
    id: overrides.id,
    venue_id: overrides.venue_id,
    title: overrides.title ?? 'Test concert',
    date: overrides.date,
    time: overrides.time ?? '19:30',
    conductor: overrides.conductor ?? null,
    cast: overrides.cast ?? null,
    location: overrides.location ?? null,
    url: overrides.url ?? 'https://example.com/event',
    scraped_at: overrides.scraped_at ?? new Date().toISOString(),
  };
}

async function freshModules(): Promise<{ db: DbModule; server: ServerModule }> {
  process.env.DB_PATH = ':memory:';
  vi.resetModules();
  const db = await import('../db.js');
  const server = await import('../server.js');
  return { db, server };
}

async function seed(db: DbModule): Promise<void> {
  db.upsertCity('stuttgart', 'Stuttgart', 'DE');
  db.upsertCity('berlin', 'Berlin', 'DE');
  db.upsertCity('wien', 'Wien', 'AT');

  db.upsertVenue('staatsoper-stuttgart', 'Staatsoper Stuttgart', 'stuttgart', 'https://example.com/sos');
  db.upsertVenue('staatsoper-berlin', 'Staatsoper Berlin', 'berlin', 'https://example.com/sob');
  db.upsertVenue('wiener-staatsoper', 'Wiener Staatsoper', 'wien', 'https://example.com/ws');

  db.updateLastScraped('staatsoper-stuttgart', '2026-04-07T10:00:00.000Z');
  db.updateLastScraped('wiener-staatsoper', '2026-04-07T11:00:00.000Z');

  db.replaceVenueEvents('staatsoper-stuttgart', [
    makeEvent({
      id: 'sos-1',
      venue_id: 'staatsoper-stuttgart',
      date: daysFromNow(1),
      title: 'Carmen',
      conductor: 'Cornelius Meister',
      cast: ['Anna Netrebko', 'Jonas Kaufmann'],
      location: 'Großes Haus',
    }),
    makeEvent({ id: 'sos-2', venue_id: 'staatsoper-stuttgart', date: daysFromNow(5), title: 'Tosca' }),
  ]);
  db.replaceVenueEvents('wiener-staatsoper', [
    makeEvent({ id: 'ws-1', venue_id: 'wiener-staatsoper', date: daysFromNow(2), title: 'Die Zauberflöte' }),
  ]);
}

function parsePayload(result: { response: { content: Array<{ type: 'text'; text: string }> } }): Record<string, unknown> {
  return JSON.parse(result.response.content[0].text) as Record<string, unknown>;
}

// ─── Pure handler tests ───────────────────────────────────────────────────────

describe('handleListCountries', () => {
  let db: DbModule;
  let server: ServerModule;

  beforeEach(async () => {
    ({ db, server } = await freshModules());
    await seed(db);
  });

  afterEach(() => {
    db.closeDb();
    delete process.env.DB_PATH;
  });

  it('returns all countries with counts', async () => {
    const result = await server.handleListCountries({});
    const payload = parsePayload(result);
    expect(payload.countries).toEqual([
      { country: 'AT', city_count: 1, venue_count: 1 },
      { country: 'DE', city_count: 2, venue_count: 2 },
    ]);
  });

  it('reports result_count in meta', async () => {
    const result = await server.handleListCountries({});
    expect(result.meta.result_count).toBe(2);
  });

  it('never sets a note (no filters)', async () => {
    const result = await server.handleListCountries({});
    expect(parsePayload(result).note).toBeUndefined();
    expect(result.meta.unmatched).toBeUndefined();
  });
});

describe('handleListCities', () => {
  let db: DbModule;
  let server: ServerModule;

  beforeEach(async () => {
    ({ db, server } = await freshModules());
    await seed(db);
  });

  afterEach(() => {
    db.closeDb();
    delete process.env.DB_PATH;
  });

  it('returns all cities when no filter is given', async () => {
    const result = await server.handleListCities({});
    const payload = parsePayload(result);
    expect((payload.cities as Array<{ id: string }>).map((c) => c.id).sort()).toEqual([
      'berlin',
      'stuttgart',
      'wien',
    ]);
    expect(payload.note).toBeUndefined();
  });

  it('filters by country', async () => {
    const result = await server.handleListCities({ country: 'DE' });
    const payload = parsePayload(result);
    expect((payload.cities as Array<{ id: string }>).map((c) => c.id).sort()).toEqual([
      'berlin',
      'stuttgart',
    ]);
    expect(payload.note).toBeUndefined();
  });

  it('attaches a note when the country filter is uncovered', async () => {
    const result = await server.handleListCities({ country: 'GB' });
    const payload = parsePayload(result);
    expect(payload.cities).toEqual([]);
    expect(payload.note).toBe(
      "Leporello does not currently cover country 'GB'. Call list_countries to see what's covered.",
    );
    expect(result.meta.unmatched).toEqual({ country: 'GB' });
  });

  it('does not set a note when filter matches even if results are empty', async () => {
    // DE is covered, but if there were no cities the result would still be ok=match
    const result = await server.handleListCities({ country: 'DE' });
    expect(parsePayload(result).note).toBeUndefined();
  });
});

describe('handleListVenues', () => {
  let db: DbModule;
  let server: ServerModule;

  beforeEach(async () => {
    ({ db, server } = await freshModules());
    await seed(db);
  });

  afterEach(() => {
    db.closeDb();
    delete process.env.DB_PATH;
  });

  it('returns shaped venues with city/country/last_scraped', async () => {
    const result = await server.handleListVenues({ city: 'stuttgart' });
    const payload = parsePayload(result);
    const venues = payload.venues as Array<Record<string, unknown>>;
    expect(venues).toHaveLength(1);
    expect(venues[0]).toEqual({
      id: 'staatsoper-stuttgart',
      name: 'Staatsoper Stuttgart',
      city: 'Stuttgart',
      country: 'DE',
      last_scraped: '2026-04-07T10:00:00.000Z',
    });
    expect(payload.note).toBeUndefined();
  });

  it('filters by country and city together', async () => {
    const result = await server.handleListVenues({ country: 'AT', city: 'wien' });
    const payload = parsePayload(result);
    expect((payload.venues as unknown[]).length).toBe(1);
    expect(payload.note).toBeUndefined();
  });

  it('matches city case-insensitively', async () => {
    const result = await server.handleListVenues({ city: 'Stuttgart' });
    expect((parsePayload(result).venues as unknown[]).length).toBe(1);
  });

  it('attaches a note when city is uncovered', async () => {
    const result = await server.handleListVenues({ city: 'london' });
    const payload = parsePayload(result);
    expect(payload.venues).toEqual([]);
    expect(payload.note).toBe(
      "Leporello does not currently cover city 'london'. Call list_cities to see what's covered.",
    );
    expect(result.meta.unmatched).toEqual({ city: 'london' });
  });

  it('attaches a combined note when both filters are uncovered', async () => {
    const result = await server.handleListVenues({ country: 'GB', city: 'london' });
    const payload = parsePayload(result);
    expect(payload.note).toBe(
      "Leporello does not currently cover country 'GB' and city 'london'. Call list_countries / list_cities to see what's covered.",
    );
    expect(result.meta.unmatched).toEqual({ country: 'GB', city: 'london' });
  });
});

describe('handleListEvents', () => {
  let db: DbModule;
  let server: ServerModule;

  beforeEach(async () => {
    ({ db, server } = await freshModules());
    await seed(db);
  });

  afterEach(() => {
    db.closeDb();
    delete process.env.DB_PATH;
  });

  it('returns events within the default 30-day window', async () => {
    const result = await server.handleListEvents({});
    const payload = parsePayload(result);
    const ids = (payload.events as Array<{ id: string }>).map((e) => e.id).sort();
    expect(ids).toEqual(['sos-1', 'sos-2', 'ws-1']);
  });

  it('parses cast JSON and includes optional fields when present', async () => {
    const result = await server.handleListEvents({ venue_id: 'staatsoper-stuttgart' });
    const payload = parsePayload(result);
    const carmen = (payload.events as Array<Record<string, unknown>>).find((e) => e.id === 'sos-1')!;
    expect(carmen.cast).toEqual(['Anna Netrebko', 'Jonas Kaufmann']);
    expect(carmen.conductor).toBe('Cornelius Meister');
    expect(carmen.location).toBe('Großes Haus');
  });

  it('omits optional fields that are null', async () => {
    const result = await server.handleListEvents({ venue_id: 'staatsoper-stuttgart' });
    const payload = parsePayload(result);
    const tosca = (payload.events as Array<Record<string, unknown>>).find((e) => e.id === 'sos-2')!;
    expect(tosca).not.toHaveProperty('cast');
    expect(tosca).not.toHaveProperty('conductor');
    expect(tosca).not.toHaveProperty('location');
  });

  it('returns data_age for venues matching the filter', async () => {
    const result = await server.handleListEvents({ country: 'DE' });
    const payload = parsePayload(result);
    expect(payload.data_age).toEqual({
      'staatsoper-stuttgart': '2026-04-07T10:00:00.000Z',
    });
  });

  it('limits data_age to a single venue when venue_id is set', async () => {
    const result = await server.handleListEvents({ venue_id: 'staatsoper-stuttgart' });
    const payload = parsePayload(result);
    expect(Object.keys(payload.data_age as object)).toEqual(['staatsoper-stuttgart']);
  });

  it('respects days_ahead', async () => {
    db.replaceVenueEvents('staatsoper-berlin', [
      makeEvent({ id: 'sob-far', venue_id: 'staatsoper-berlin', date: daysFromNow(60) }),
    ]);
    const within = await server.handleListEvents({ venue_id: 'staatsoper-berlin', days_ahead: 30 });
    const beyond = await server.handleListEvents({ venue_id: 'staatsoper-berlin', days_ahead: 90 });
    expect((parsePayload(within).events as unknown[]).length).toBe(0);
    expect((parsePayload(beyond).events as unknown[]).length).toBe(1);
  });

  it('attaches a note when venue_id is uncovered', async () => {
    const result = await server.handleListEvents({ venue_id: 'fake-venue' });
    const payload = parsePayload(result);
    expect(payload.events).toEqual([]);
    expect(payload.note).toBe(
      "Leporello does not currently cover venue 'fake-venue'. Call list_venues to see what's covered.",
    );
    expect(result.meta.unmatched).toEqual({ venue_id: 'fake-venue' });
  });

  it('attaches a triple-filter note when country + city + venue_id all miss', async () => {
    const result = await server.handleListEvents({
      country: 'GB',
      city: 'london',
      venue_id: 'royal-opera-house',
    });
    const payload = parsePayload(result);
    expect(payload.note).toBe(
      "Leporello does not currently cover country 'GB' and city 'london' and venue 'royal-opera-house'. Call list_countries / list_cities / list_venues to see what's covered.",
    );
  });

  it('does not attach a note for empty-but-covered queries', async () => {
    // No events scheduled at staatsoper-berlin in the default window
    const result = await server.handleListEvents({ venue_id: 'staatsoper-berlin' });
    const payload = parsePayload(result);
    expect(payload.events).toEqual([]);
    expect(payload.note).toBeUndefined();
  });
});

// ─── buildNote unit tests ─────────────────────────────────────────────────────

describe('buildNote', () => {
  let server: ServerModule;

  beforeEach(async () => {
    ({ server } = await freshModules());
  });

  afterEach(() => {
    delete process.env.DB_PATH;
  });

  it('returns undefined for an empty unmatched object', () => {
    expect(server.buildNote({})).toBeUndefined();
  });

  it('formats a country-only miss', () => {
    expect(server.buildNote({ country: 'GB' })).toBe(
      "Leporello does not currently cover country 'GB'. Call list_countries to see what's covered.",
    );
  });

  it('formats a city-only miss', () => {
    expect(server.buildNote({ city: 'paris' })).toBe(
      "Leporello does not currently cover city 'paris'. Call list_cities to see what's covered.",
    );
  });

  it('formats a venue-only miss', () => {
    expect(server.buildNote({ venue_id: 'royal-opera-house' })).toBe(
      "Leporello does not currently cover venue 'royal-opera-house'. Call list_venues to see what's covered.",
    );
  });

  it('joins two misses with " and " and " / "', () => {
    expect(server.buildNote({ country: 'GB', city: 'london' })).toBe(
      "Leporello does not currently cover country 'GB' and city 'london'. Call list_countries / list_cities to see what's covered.",
    );
  });

  it('joins all three misses', () => {
    expect(
      server.buildNote({ country: 'GB', city: 'london', venue_id: 'roh' }),
    ).toBe(
      "Leporello does not currently cover country 'GB' and city 'london' and venue 'roh'. Call list_countries / list_cities / list_venues to see what's covered.",
    );
  });

  it('preserves the user\'s original casing in the message', () => {
    expect(server.buildNote({ country: 'gb' })).toContain("country 'gb'");
  });
});

// ─── instrumentTool tests (logger mocked) ─────────────────────────────────────

describe('instrumentTool', () => {
  const logSpy = vi.fn();
  const logErrorSpy = vi.fn();

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    logSpy.mockReset();
    logErrorSpy.mockReset();
    vi.resetModules();
    vi.doMock('../logger.js', () => ({
      log: logSpy,
      logError: logErrorSpy,
      hashClientIp: vi.fn(() => null),
      flush: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../logger.js');
    delete process.env.DB_PATH;
  });

  it('emits an mcp_tool_call log event with result_count and args', async () => {
    const server = await import('../server.js');
    const wrapped = server.instrumentTool(
      'list_countries',
      { ua: 'TestAgent/1.0', ipHash: 'abc123' },
      async () => ({
        response: { content: [{ type: 'text', text: '{}' }] },
        meta: { result_count: 5 },
      }),
    );

    await wrapped({ foo: 'bar' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [event, fields] = logSpy.mock.calls[0];
    expect(event).toBe('mcp_tool_call');
    expect(fields).toMatchObject({
      tool: 'list_countries',
      result_count: 5,
      args: { foo: 'bar' },
      client_ua: 'TestAgent/1.0',
      client_ip_hash: 'abc123',
    });
    expect(fields).toHaveProperty('duration_ms');
    expect(typeof fields.duration_ms).toBe('number');
    expect(fields).not.toHaveProperty('unmatched');
  });

  it('forwards unmatched filters to the log event when present', async () => {
    const server = await import('../server.js');
    const wrapped = server.instrumentTool(
      'list_events',
      { ua: null, ipHash: null },
      async () => ({
        response: { content: [{ type: 'text', text: '{}' }] },
        meta: { result_count: 0, unmatched: { city: 'london' } },
      }),
    );

    await wrapped({});

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [, fields] = logSpy.mock.calls[0];
    expect(fields.unmatched).toEqual({ city: 'london' });
    expect(fields.result_count).toBe(0);
  });

  it('omits unmatched from the log event when meta.unmatched is empty', async () => {
    const server = await import('../server.js');
    const wrapped = server.instrumentTool(
      'list_cities',
      { ua: null, ipHash: null },
      async () => ({
        response: { content: [{ type: 'text', text: '{}' }] },
        meta: { result_count: 3, unmatched: {} },
      }),
    );

    await wrapped({});

    const [, fields] = logSpy.mock.calls[0];
    expect(fields).not.toHaveProperty('unmatched');
  });

  it('returns the response untouched (does not include meta in the MCP response)', async () => {
    const server = await import('../server.js');
    const wrapped = server.instrumentTool(
      'list_cities',
      { ua: null, ipHash: null },
      async () => ({
        response: { content: [{ type: 'text', text: '{"cities":[]}' }] },
        meta: { result_count: 0 },
      }),
    );

    const result = await wrapped({});
    expect(result).toEqual({ content: [{ type: 'text', text: '{"cities":[]}' }] });
    expect(result).not.toHaveProperty('meta');
  });

  it('emits mcp_tool_error and rethrows when the handler throws', async () => {
    const server = await import('../server.js');
    const wrapped = server.instrumentTool(
      'list_events',
      { ua: 'X', ipHash: 'h' },
      async () => {
        throw new Error('boom');
      },
    );

    await expect(wrapped({ city: 'paris' })).rejects.toThrow('boom');

    expect(logSpy).not.toHaveBeenCalled();
    expect(logErrorSpy).toHaveBeenCalledTimes(1);
    const [event, fields] = logErrorSpy.mock.calls[0];
    expect(event).toBe('mcp_tool_error');
    expect(fields).toMatchObject({
      tool: 'list_events',
      args: { city: 'paris' },
      client_ua: 'X',
      client_ip_hash: 'h',
      error: 'Error: boom',
    });
  });
});
