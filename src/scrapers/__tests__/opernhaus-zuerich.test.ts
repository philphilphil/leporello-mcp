import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { OpernhausZuerichScraper } from '../opernhaus-zuerich.js';

const fixture = readFileSync(new URL('../__fixtures__/opernhaus-zuerich.html', import.meta.url), 'utf8');
const scraper = new OpernhausZuerichScraper({ fetchHtml: async () => fixture });

describe('OpernhausZuerichScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('extracts date and time correctly', async () => {
    const events = await scraper.scrape();
    const scylla = events.find(e => e.title.includes('Scylla et Glaucus'));
    expect(scylla).toBeDefined();
    expect(scylla!.date).toBe('2026-04-02');
    expect(scylla!.time).toBe('19:00');
  });

  it('extracts location', async () => {
    const events = await scraper.scrape();
    const scylla = events.find(e => e.title.includes('Scylla et Glaucus'));
    expect(scylla).toBeDefined();
    expect(scylla!.location).toBe('Hauptbühne Opernhaus');
  });

  it('builds event URL', async () => {
    const events = await scraper.scrape();
    const scylla = events.find(e => e.title.includes('Scylla et Glaucus'));
    expect(scylla).toBeDefined();
    expect(scylla!.url).toContain('opernhaus.ch');
    expect(scylla!.url).toContain('scylla-et-glaucus');
  });

  it('enriches title with composer info', async () => {
    const events = await scraper.scrape();
    const scylla = events.find(e => e.title.includes('Scylla et Glaucus') && e.title.includes('Leclair'));
    expect(scylla).toBeDefined();
    expect(scylla!.title).toContain('Jean-Marie Leclair');
  });
});
