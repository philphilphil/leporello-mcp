<p align="center">
  <img src="web/public/leporello-logo.svg" alt="Leporello" width="200" />
</p>

<h1 align="center">Leporello</h1>

<p align="center">Opera & classical music event schedule remote MCP.<br>Also available as a web app at <a href="https://leporello.app">leporello.app</a>.</p>

## Supported Venues
Missing your favorite venue? PRs welcome! Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for step-by-step instructions on adding a new venue scraper.

| Venue | City |
|---|---|
| Staatsoper Stuttgart | Stuttgart |
| Stuttgarter Philharmoniker | Stuttgart |
| Wiener Staatsoper | Vienna |
| Metropolitan Opera | New York |
| Oper Frankfurt | Frankfurt |
| San Francisco Opera | San Francisco |
| Gran Teatre del Liceu | Barcelona |
| Semperoper | Dresden |
| Opéra National de Paris | Paris |
| Carnegie Hall | New York |
| Teatro Real | Madrid |
| Staatsoper Unter den Linden | Berlin |
| Sydney Opera House | Sydney |
| Philharmonie de Paris | Paris |
| Bayerische Staatsoper | München |

## How it works

Venue-specific scrapers fetch schedule pages (HTML or JSON) from opera houses and concert halls, parse them with Cheerio, and store the events in a local SQLite database. A node-cron scheduler re-scrapes all venues daily at 03:00 UTC, replacing each venue's events with the latest data. The server exposes the data via a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) endpoint, so any MCP-compatible AI assistant can query upcoming performances. A static Astro frontend reads the same database at build time and serves a filterable event listing at [leporello.app](https://leporello.app).

## MCP Tools

| Tool | Description |
|---|---|
| `list_countries` | All countries with city/venue counts |
| `list_cities` | All cities with venues, optionally filtered by country |
| `list_venues` | All venues, optionally filtered by country or city |
| `list_events` | Upcoming events filtered by country, city, or venue |

## Privacy

The hosted instance at [leporello.app](https://leporello.app) logs aggregate MCP usage (tool name, arguments, response time, User-Agent, and a daily-rotating salted hash of the client IP) so I can see what's working and what isn't. No raw IPs, no personal data, no auth tokens. If you'd rather not be counted, run your own instance — it's a single `docker compose up`.

## Run locally

```bash
npm install
npm test          # run scraper tests

npm run scrape                       # one-off scrape all venues
#or
npm run scrape -- wiener-staatsoper  # scrape a single venue

npm run dev       # start server on http://localhost:3000
# or
npm run dev:fresh # scrape, then serve
```

Scrapes daily at 03:00 UTC. Run `npm run scrape` to populate the database on first use.

## Docker

Two containers: **web** (HTTP server + MCP + static frontend) and **scraper** (fetches venue data into SQLite). They share a data volume. The scraper runs once and exits — schedule it with a host cron job.

```bash
# Start the web server
docker compose up -d

# Run all scrapers (one-off, container stops when done)
docker compose run --rm scraper

# Scrape a single venue
docker compose run --rm scraper node dist/scrape.js wiener-staatsoper

# Rebuild the Astro frontend (e.g. after a manual scrape)
docker compose exec web node -e "
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await promisify(execFile)('npm', ['run', 'build', '--prefix', 'web'], { cwd: '/app', timeout: 60000 });
console.log('done');
"

# Tail logs
docker compose logs -f web
```

The web container rebuilds the Astro frontend on every start. To run scrapers on a schedule, add a host cron job that scrapes then restarts web:

```cron
0 3 * * * cd /home/phil/docker/lep && docker compose run --rm scraper && docker compose restart web
```