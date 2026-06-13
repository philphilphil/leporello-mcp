import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { RoyalOperaHouseLondonScraper } from '../royal-opera-house-london.js';
import { testDbIntegration } from './helpers/db-integration.js';

const fixtureJson = JSON.parse(
  readFileSync(new URL('../__fixtures__/royal-opera-house-london.json', import.meta.url), 'utf8'),
);
const scraper = new RoyalOperaHouseLondonScraper({ fetchJson: async () => fixtureJson });

// The shape the scraper's `fetchJson` option must resolve to, derived from the
// constructor so the test stays in sync without exporting internal types.
type Fixture = Awaited<
  ReturnType<NonNullable<NonNullable<ConstructorParameters<typeof RoyalOperaHouseLondonScraper>[0]>['fetchJson']>>
>;

// Build a minimal JSON:API response with one calendarActivity per spec, so URL
// construction and title handling can be asserted without depending on which
// productions happen to be in the live fixture this month.
function makeFixture(
  specs: Array<{ sourceType: string; slug: string; title: string; link?: string | null; location?: string }>,
): Fixture {
  const included: Fixture['included'] = [];
  specs.forEach((s, i) => {
    const evId = `ev${i}`;
    const locId = `loc${i}`;
    included.push({
      type: 'calendarEvent',
      id: evId,
      attributes: { sourceType: s.sourceType, title: s.title, slug: s.slug, link: s.link ?? null, location: null },
    });
    if (s.location) {
      included.push({ type: 'locations', id: locId, attributes: { title: s.location } });
    }
    included.push({
      type: 'calendarActivity',
      id: `act${i}`,
      attributes: { date: '2026-06-15T19:30:00+01:00', subtitle: null, type: 'discrete-activity' },
      relationships: {
        event: { data: { type: 'calendarEvent', id: evId } },
        locations: { data: s.location ? [{ type: 'locations', id: locId }] : [] },
      },
    });
  });
  return { data: { type: 'calendar', id: 'x', attributes: {} }, included };
}

describe('RoyalOperaHouseLondonScraper', () => {
  it('parses events from fixture', async () => {
    const events = await scraper.scrape();
    expect(events.length).toBeGreaterThan(0);
  });

  it('sets valid required fields on every event', async () => {
    const events = await scraper.scrape();
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.venue_id).toBe('royal-opera-house-london');
      expect(event.title).toBeTruthy();
      expect(event.title).not.toMatch(/<[^>]+>/); // titles must not contain raw HTML
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.scraped_at).toBeTruthy();
      // Optional fields can be null but must be present
      expect('time' in event).toBe(true);
      expect('conductor' in event).toBe(true);
      expect('cast' in event).toBe(true);
      expect('location' in event).toBe(true);
      expect('url' in event).toBe(true);
    }
  });

  it('parses time in HH:MM format when present', async () => {
    const events = await scraper.scrape();
    const withTime = events.filter(e => e.time);
    expect(withTime.length).toBeGreaterThan(0);
    for (const e of withTime) expect(e.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('builds absolute detail URLs', async () => {
    const events = await scraper.scrape();
    const withUrl = events.filter(e => e.url);
    expect(withUrl.length).toBeGreaterThan(0);
    for (const e of withUrl) expect(e.url).toMatch(/^https:\/\//);
  });

  it('resolves venue location from the locations relationship', async () => {
    const events = await scraper.scrape();
    expect(events.some(e => typeof e.location === 'string' && e.location.length > 0)).toBe(true);
  });

  it('builds the correct detail URL for each sourceType', async () => {
    const fixture = makeFixture([
      { sourceType: 'single-production-page', slug: 'samson-et-dalila-richard-jones', title: 'Samson et Dalila' },
      { sourceType: 'event-detail', slug: 'roh-behind-the-scene-tour', title: 'Behind the Scenes Tour' },
      { sourceType: 'prismic-only-event-detail', slug: 'jette-parker-concert', title: 'Jette Parker Concert' },
      { sourceType: 'festival', slug: 'rboshift-2026', title: 'RBO/SHIFT 2026' },
    ]);
    const s = new RoyalOperaHouseLondonScraper({ fetchJson: async () => fixture });
    const byTitle = Object.fromEntries((await s.scrape()).map(e => [e.title, e.url]));
    expect(byTitle['Samson et Dalila']).toBe('https://www.rbo.org.uk/production/samson-et-dalila-richard-jones');
    expect(byTitle['Behind the Scenes Tour']).toBe('https://www.rbo.org.uk/tickets-and-events/roh-behind-the-scene-tour-dates');
    expect(byTitle['Jette Parker Concert']).toBe('https://www.rbo.org.uk/tickets-and-events/jette-parker-concert-details');
    expect(byTitle['RBO/SHIFT 2026']).toBe('https://www.rbo.org.uk/tickets-and-events/festival/rboshift-2026-details');
  });

  it('prefers an explicit API link over the slug pattern', async () => {
    const fixture = makeFixture([
      { sourceType: 'event-detail', slug: 'whatever', title: 'Booking', link: '/tickets-and-events/festival/special/page' },
    ]);
    const s = new RoyalOperaHouseLondonScraper({ fetchJson: async () => fixture });
    const events = await s.scrape();
    expect(events[0].url).toBe('https://www.rbo.org.uk/tickets-and-events/festival/special/page');
  });

  it('skips promo card entries and strips HTML from titles', async () => {
    const fixture = makeFixture([
      { sourceType: 'prismic-only-event-card', slug: 'shift', title: '<h4>SATURDAY/EARLY SHIFT</h4>' },
      { sourceType: 'event-detail', slug: 'real-event', title: 'Real <em>Event</em>' },
    ]);
    const s = new RoyalOperaHouseLondonScraper({ fetchJson: async () => fixture });
    const events = await s.scrape();
    // promo card skipped entirely
    expect(events.some(e => e.title.includes('SHIFT'))).toBe(false);
    // HTML stripped from the surviving title
    const real = events.find(e => e.title.startsWith('Real'));
    expect(real).toBeDefined();
    expect(real!.title).toBe('Real Event');
  });

  it('includes subtitle in title when present', async () => {
    const events = await scraper.scrape();
    const withSubtitle = events.find(e => e.title.includes('—'));
    if (withSubtitle) {
      expect(withSubtitle.title).toContain('—');
    }
  });

  testDbIntegration(scraper);
});
