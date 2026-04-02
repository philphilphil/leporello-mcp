# Classical Music Calendar MCP

Projekt-Idee: Ein MCP-Server der Opern- und Klassik-Spielpläne als strukturierte Daten bereitstellt.

## Problem

- Kein einziger Dienst aggregiert reguläre Opernhaus-Spielpläne als API
- Bachtrack, Operabase, concerti.de — alle ohne API, und concerti.de hat z.B. keine regulären Opern-Spielpläne
- Jedes Opernhaus hat eine eigene Website mit eigenem HTML-Format
- Für LLM-Nutzung (MCP) existiert gar nichts in diesem Bereich

## Idee

- MCP-Server mit Tool: `get_events(city, days_ahead?)` → strukturierte Event-Liste
- Täglicher Scraper holt Spielpläne der einzelnen Häuser
- Jede Antwort enthält `data_age` (wie alt die Daten sind)
- Start mit deutschen Städten, dann DACH, dann Europa

## Architektur

- Node.js/TypeScript MCP-Server (@modelcontextprotocol/sdk)
- SQLite für Event-Speicherung
- Pro Venue ein Scraper-Modul (leicht erweiterbar)
- Cron-Job scraped 1x täglich
- Open Source auf GitHub

## Rechtliches

- Faktische Daten (Datum, Werk, Dirigent) sind nicht urheberrechtlich geschützt
- BGH "Urlaubsbot" Urteil stützt Scraping öffentlicher Fakten
- 1x täglich ist minimal — kein Serverlast-Argument
- Nicht in Konkurrenz zu den Häusern (keine Tickets verkaufen)
- robots.txt respektieren, Quellen nennen, Kontaktadresse angeben
- Venues profitieren von der Sichtbarkeit

## Mögliche Venue-Liste (Start)

- Staatsoper Stuttgart
- Stuttgarter Philharmoniker
- Bayerische Staatsoper München
- Semperoper Dresden
- Deutsche Oper Berlin / Staatsoper Unter den Linden / Komische Oper
- Hamburgische Staatsoper
- Oper Frankfurt
- Wiener Staatsoper
- Opernhaus Zürich

## Bestehende Datenquellen

- **concerti.de** — 50k Events DACH, kein API, Schema.org Markup (aber keine regulären Opern-Spielpläne)
- **kulturkurier.de** — referenziert api.kulturkurier.de im Frontend, evtl. anfragen
- **classicalconcertmap.com** — PostgREST Backend, kleines Indie-Projekt
- **Open Opus API** — Komponisten/Werk-Metadaten (kostenlos, open source) — gut zum Anreichern
- **buehnenfotos.de** — Liste aller ~80 deutschen Opernhäuser mit Links

## Nächste Schritte

- [ ] Spielplan-Seiten der Top-5 Häuser analysieren (HTML-Struktur, JSON-LD?)
- [ ] Prototyp: Scraper für Staatsoper Stuttgart
- [ ] MCP-Server Grundgerüst mit SQLite
- [ ] GitHub-Repo aufsetzen

