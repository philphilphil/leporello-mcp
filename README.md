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
| Concertgebouw | Amsterdam |

## How it works

Venue-specific scrapers fetch schedule pages (HTML or JSON) from opera houses and concert halls, parse them with Cheerio, and store the events in a local SQLite database. A node-cron scheduler re-scrapes all venues daily at 03:00 UTC, replacing each venue's events with the latest data. The server exposes the data via a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) endpoint, so any MCP-compatible AI assistant can query upcoming performances. A static Astro frontend reads the same database at build time and serves a filterable event listing at [leporello.app](https://leporello.app).

## MCP Tools

| Tool | Description |
|---|---|
| `list_countries` | All countries with city/venue counts |
| `list_cities` | All cities with venues, optionally filtered by country |
| `list_venues` | All venues, optionally filtered by country or city |
| `list_events` | Upcoming events filtered by country, city, or venue |

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

```bash
docker compose up -d

# Trigger a manual scrape (e.g. first run or on-demand refresh)
docker compose exec leporello node dist/scrape.js
# Scrape a single venue
docker compose exec leporello node dist/scrape.js wiener-staatsoper

# Tail logs
docker compose logs -f leporello
```

The scheduler re-scrapes all venues at 03:00 UTC and rebuilds the web frontend automatically.