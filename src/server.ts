import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getCountries, getCities, getVenues, getEvents, findUnmatchedFilters } from './db.js';
import { log, logError, hashClientIp } from './logger.js';

function parseCast(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === 'string')) return undefined;
    return parsed as string[];
  } catch {
    return undefined;
  }
}

export type ReqContext = {
  ua: string | null;
  ipHash: string | null;
};

export type Unmatched = { country?: string; city?: string; venue_id?: string };

export type McpResponse = { content: Array<{ type: 'text'; text: string }> };

export type HandlerResult = {
  response: McpResponse;
  meta: { result_count: number; unmatched?: Unmatched };
};

export type ToolHandler<Args> = (args: Args) => Promise<HandlerResult>;

export function buildNote(unmatched: Unmatched): string | undefined {
  const parts: string[] = [];
  const tools: string[] = [];
  if (unmatched.country) {
    parts.push(`country '${unmatched.country}'`);
    tools.push('list_countries');
  }
  if (unmatched.city) {
    parts.push(`city '${unmatched.city}'`);
    tools.push('list_cities');
  }
  if (unmatched.venue_id) {
    parts.push(`venue '${unmatched.venue_id}'`);
    tools.push('list_venues');
  }
  if (parts.length === 0) return undefined;
  return `Leporello does not currently cover ${parts.join(' and ')}. Call ${tools.join(' / ')} to see what's covered.`;
}

export function instrumentTool<Args>(
  toolName: string,
  reqContext: ReqContext,
  handler: ToolHandler<Args>,
): (args: Args) => Promise<McpResponse> {
  return async (args: Args) => {
    const start = performance.now();
    try {
      const { response, meta } = await handler(args);
      const hasUnmatched = meta.unmatched && Object.keys(meta.unmatched).length > 0;
      log('mcp_tool_call', {
        tool: toolName,
        duration_ms: Math.round(performance.now() - start),
        result_count: meta.result_count,
        ...(hasUnmatched ? { unmatched: meta.unmatched } : {}),
        args: args as Record<string, unknown>,
        client_ua: reqContext.ua,
        client_ip_hash: reqContext.ipHash,
      });
      return response;
    } catch (err) {
      logError('mcp_tool_error', {
        tool: toolName,
        duration_ms: Math.round(performance.now() - start),
        args: args as Record<string, unknown>,
        client_ua: reqContext.ua,
        client_ip_hash: reqContext.ipHash,
        error: String(err),
      });
      throw err;
    }
  };
}

// ── MCP tool handlers ─────────────────────────────────────────────────────────
// Pure handlers (no instrumentation, no req context). Exported for testability.

export type ListCountriesArgs = Record<string, never>;
export type ListCitiesArgs = { country?: string };
export type ListVenuesArgs = { country?: string; city?: string };
export type ListEventsArgs = {
  country?: string;
  city?: string;
  venue_id?: string;
  days_ahead?: number;
};

export const handleListCountries: ToolHandler<ListCountriesArgs> = async () => {
  const countries = getCountries();
  return {
    response: {
      content: [{ type: 'text', text: JSON.stringify({ countries }) }],
    },
    meta: { result_count: countries.length },
  };
};

export const handleListCities: ToolHandler<ListCitiesArgs> = async ({ country }) => {
  const cities = getCities(country);
  const unmatched = findUnmatchedFilters({ country });
  const note = buildNote(unmatched);
  const payload: Record<string, unknown> = { cities };
  if (note) payload.note = note;
  return {
    response: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    meta: { result_count: cities.length, unmatched },
  };
};

export const handleListVenues: ToolHandler<ListVenuesArgs> = async ({ country, city }) => {
  const venues = getVenues({
    cityId: city?.toLowerCase(),
    country,
  }).map((v) => ({
    id: v.id,
    name: v.name,
    city: v.city_name,
    country: v.country,
    last_scraped: v.last_scraped,
  }));
  const unmatched = findUnmatchedFilters({ country, city });
  const note = buildNote(unmatched);
  const payload: Record<string, unknown> = { venues };
  if (note) payload.note = note;
  return {
    response: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    meta: { result_count: venues.length, unmatched },
  };
};

export const handleListEvents: ToolHandler<ListEventsArgs> = async ({
  country,
  city,
  venue_id,
  days_ahead,
}) => {
  const rows = getEvents({
    cityId: city?.toLowerCase(),
    country,
    venueId: venue_id,
    daysAhead: days_ahead ?? 30,
  });

  const venueRows = getVenues({
    cityId: city?.toLowerCase(),
    country,
  });
  const data_age: Record<string, string> = {};
  for (const v of venueRows) {
    if (venue_id && v.id !== venue_id) continue;
    if (v.last_scraped) data_age[v.id] = v.last_scraped;
  }

  const events = rows.map((e) => ({
    id: e.id,
    venue_id: e.venue_id,
    venue_name: e.venue_name,
    title: e.title,
    date: e.date,
    time: e.time,
    ...(e.conductor ? { conductor: e.conductor } : {}),
    ...(e.cast ? { cast: parseCast(e.cast) } : {}),
    ...(e.location ? { location: e.location } : {}),
    url: e.url,
  }));

  const unmatched = findUnmatchedFilters({ country, city, venueId: venue_id });
  const note = buildNote(unmatched);
  const payload: Record<string, unknown> = { events, data_age };
  if (note) payload.note = note;

  return {
    response: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    meta: { result_count: events.length, unmatched },
  };
};

function buildMcpServer(reqContext: ReqContext): McpServer {
  const server = new McpServer({
    name: 'leporello',
    version: '1.0.0',
    icons: [{ src: 'https://leporello.app/concert_note.svg', mimeType: 'image/svg+xml' }],
  });

  server.tool(
    'list_countries',
    'List all countries that have classical music or opera venues.',
    {},
    instrumentTool('list_countries', reqContext, handleListCountries),
  );

  server.tool(
    'list_cities',
    'List cities with classical music or opera venues. Optionally filter by country.',
    {
      country: z
        .string()
        .optional()
        .describe('ISO 3166-1 alpha-2 country code, e.g. "DE", "AT", "US"'),
    },
    instrumentTool('list_cities', reqContext, handleListCities),
  );

  server.tool(
    'list_venues',
    'List classical music and opera venues. Filter by country or city.',
    {
      country: z
        .string()
        .optional()
        .describe('ISO 3166-1 alpha-2 country code, e.g. "DE", "AT", "US"'),
      city: z
        .string()
        .optional()
        .describe('City name to filter by, e.g. "Stuttgart"'),
    },
    instrumentTool('list_venues', reqContext, handleListVenues),
  );

  server.tool(
    'list_events',
    'List upcoming classical music and opera events. Filter by country, city, or venue. Returns data_age so the caller knows how fresh the data is.',
    {
      country: z
        .string()
        .optional()
        .describe('ISO 3166-1 alpha-2 country code, e.g. "DE", "AT", "US"'),
      city: z.string().optional().describe('City name, e.g. "Stuttgart"'),
      venue_id: z
        .string()
        .optional()
        .describe('Venue ID, e.g. "staatsoper-stuttgart"'),
      days_ahead: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe('How many days ahead to look (default: 30, max: 90)'),
    },
    instrumentTool('list_events', reqContext, handleListEvents),
  );

  return server;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const WEB_DIST = join(
  fileURLToPath(import.meta.url), '..', '..', 'web', 'dist'
);

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  // Resolve path and prevent directory traversal
  let filePath = join(WEB_DIST, pathname);
  if (!filePath.startsWith(WEB_DIST)) {
    res.writeHead(403).end();
    return;
  }

  // Try exact file, then append index.html for directories
  try {
    let content: Buffer;
    try {
      content = await readFile(filePath);
    } catch {
      filePath = join(filePath, 'index.html');
      content = await readFile(filePath);
    }

    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }).end(content);
  } catch {
    res.writeHead(404).end();
  }
}

export function startHttpServer() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const pathname = req.url?.split('?')[0];

      if (pathname === '/mcp') {
        // Reject non-POST — GET would open a persistent SSE stream (DoS risk in stateless mode)
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' }).end();
          return;
        }
        const xff = req.headers['x-forwarded-for'];
        const xffStr = Array.isArray(xff) ? xff[0] : xff;
        const ip = xffStr?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
        const ua = req.headers['user-agent'] ?? null;
        const reqContext: ReqContext = { ua, ipHash: hashClientIp(ip) };
        const server = buildMcpServer(reqContext);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        // Clean up on response close to prevent resource leaks
        res.on('close', () => {
          transport.close().catch(() => undefined);
          server.close().catch(() => undefined);
        });
        try {
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (err) {
          logError('mcp_request_error', { error: String(err) });
          if (!res.headersSent) {
            res.writeHead(500).end();
          }
        }
        return;
      }

      if (pathname === '/health') {
        const venues = getVenues();
        const failed = venues.filter((v) => v.last_scrape_status === 'error');
        // Always return 200 so Docker/Traefik keep routing traffic.
        // Individual scraper failures are informational, not service-breaking.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: failed.length === 0 ? 'ok' : 'degraded',
          ...(failed.length > 0 && {
            failed_venues: failed.map((v) => ({
              id: v.id,
              last_scraped: v.last_scraped,
              error: v.last_scrape_error,
            })),
          }),
        }));
        return;
      }

      await serveStatic(req, res, pathname ?? '/');
      return;
    },
  );

  httpServer.listen(port, () => {
    log('server_start', { port });
  });

  return httpServer;
}
