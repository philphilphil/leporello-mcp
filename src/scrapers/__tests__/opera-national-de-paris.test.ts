import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { OperaNationalDeParisScraper } from '../opera-national-de-paris.js';

const fixture = readFileSync(new URL('../__fixtures__/opera-national-de-paris.html', import.meta.url), 'utf8');
const scraper = new OperaNationalDeParisScraper({ fetchHtml: async () => fixture });

describe('OperaNationalDeParisScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('parses title and author', async () => {
    const events = await scraper.scrape();
    const tosca = events.find(e => e.title.includes('Tosca'));
    expect(tosca).toBeDefined();
    expect(tosca!.title).toBe('Tosca — Giacomo Puccini');
  });

  it('parses date range (start date)', async () => {
    const events = await scraper.scrape();
    const tosca = events.find(e => e.title.includes('Tosca'));
    expect(tosca).toBeDefined();
    expect(tosca!.date).toBe('2026-03-12');
    expect(tosca!.time).toBeNull();
  });

  it('parses single date with time', async () => {
    const events = await scraper.scrape();
    // "le 06 avr. 2026 à 18h30"
    const ttt = events.find(e => e.title.includes('Toï toï toï : Satyagraha'));
    expect(ttt).toBeDefined();
    expect(ttt!.date).toBe('2026-04-06');
    expect(ttt!.time).toBe('18:30');
  });

  it('parses venue location', async () => {
    const events = await scraper.scrape();
    const tosca = events.find(e => e.title.includes('Tosca'));
    expect(tosca).toBeDefined();
    expect(tosca!.location).toBe('Opéra Bastille');
  });

  it('parses event URL', async () => {
    const events = await scraper.scrape();
    const tosca = events.find(e => e.title.includes('Tosca'));
    expect(tosca).toBeDefined();
    expect(tosca!.url).toContain('operadeparis.fr');
    expect(tosca!.url).toContain('tosca');
  });

  it('all events have required fields', async () => {
    const events = await scraper.scrape();
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.venue_id).toBe('opera-national-de-paris');
      expect(e.title).toBeTruthy();
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.scraped_at).toBeTruthy();
    }
  });
});
