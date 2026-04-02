import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { getCities, getVenues, getEvents } from './db.js';

function parseCast(raw: unknown): string[] | undefined {
  try {
    return JSON.parse(raw as string) as string[];
  } catch {
    return undefined;
  }
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'erda', version: '1.0.0' });

  server.tool(
    'list_cities',
    'List all cities that have classical music or opera venues in the database.',
    {},
    async () => {
      const cities = getCities();
      return {
        content: [{ type: 'text', text: JSON.stringify({ cities }) }],
      };
    },
  );

  server.tool(
    'list_venues',
    'List all classical music and opera venues. Optionally filter by city name.',
    {
      city: z
        .string()
        .optional()
        .describe('City name to filter by, e.g. "Stuttgart"'),
    },
    async ({ city }) => {
      const venues = getVenues(city?.toLowerCase()).map((v) => ({
        id: v.id,
        name: v.name,
        city: v.city_name,
        country: v.country,
        last_scraped: v.last_scraped,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify({ venues }) }],
      };
    },
  );

  server.tool(
    'get_events',
    'Get upcoming classical music and opera events. Filter by city or venue. Returns data_age so the caller knows how fresh the data is.',
    {
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
    async ({ city, venue_id, days_ahead }) => {
      const rows = getEvents({
        cityId: city?.toLowerCase(),
        venueId: venue_id,
        daysAhead: days_ahead ?? 30,
      });

      const venueRows = getVenues(city?.toLowerCase());
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
        url: e.url,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ events, data_age }) }],
      };
    },
  );

  return server;
}

export function startHttpServer(): void {
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
        const server = buildMcpServer();
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
          console.error(JSON.stringify({ event: 'mcp_request_error', error: String(err) }));
          if (!res.headersSent) {
            res.writeHead(500).end();
          }
        }
        return;
      }

      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      res.writeHead(404).end();
    },
  );

  httpServer.listen(port, () => {
    console.log(JSON.stringify({ event: 'server_start', port }));
  });
}
