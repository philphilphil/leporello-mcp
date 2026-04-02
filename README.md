<p align="center">
  <img src="web/public/leporello-logo.svg" alt="Leporello" width="200" />
</p>

<h1 align="center">Leporello</h1>

<p align="center">Opera & classical music event schedule remote MCP.<br>Also available as a web app at <a href="https://leporello.app">leporello.app</a>.</p>

## Supported Venues

| Venue | City |
|---|---|
| Staatsoper Stuttgart | Stuttgart |
| Stuttgarter Philharmoniker | Stuttgart |
| Wiener Staatsoper | Vienna |
| Metropolitan Opera | New York |
| Oper Frankfurt | Frankfurt |
| San Francisco Opera | San Francisco |

Missing your favorite venue? PRs welcome — see [Contribute a Venue-Scraper](#contribute-a-venue-scraper) below.

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
npm run dev       # start server on http://localhost:3000
npm run scrape    # one-off scrape, no server
npm test          # run scraper tests
```

Scrapes on startup if the database is empty, then daily at 03:00 UTC.

---

## Contribute a Venue-Scraper

PRs welcome! Read **[CONTRIBUTING.md](CONTRIBUTING.md)** for step-by-step instructions on adding a new venue scraper.
