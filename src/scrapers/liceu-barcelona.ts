import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

const JSON_URL =
  'https://www.liceubarcelona.cat/sites/default/files/programme.json';
const SITE_BASE = 'https://www.liceubarcelona.cat';
const TZ = 'Europe/Madrid';

interface LiceuSession {
  id: string;
  date: number | null;
  artists: Array<{ id: number; name: string }>;
  turns: Array<{ id: string; name: { ca: string | null; es: string | null; en: string | null } }>;
}

interface LiceuProduction {
  title: { ca: string | null; es: string | null; en: string | null };
  subtitle: { ca: string | null; es: string | null; en: string | null };
  url: { ca: string | null; es: string | null; en: string | null };
  categories: Record<string, { ca: string; es: string; en: string }> | never[];
  sessions: LiceuSession[];
}

export interface LiceuData {
  productions: Record<string, LiceuProduction> | LiceuProduction[];
}

export class LiceuBarcelonaScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'liceu-barcelona',
    venueName: 'Gran Teatre del Liceu',
    cityId: 'barcelona',
    cityName: 'Barcelona',
    country: 'ES',
    scheduleUrl: 'https://www.liceubarcelona.cat/en/whats-on',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchJson?: () => Promise<LiceuData> } = {}) {}

  async scrape(): Promise<Event[]> {
    const data = this.opts.fetchJson
      ? await this.opts.fetchJson()
      : await this.fetchFromApi();
    return this.parse(data);
  }

  private async fetchFromApi(): Promise<LiceuData> {
    const res = await fetch(JSON_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${JSON_URL}`);
    return res.json() as Promise<LiceuData>;
  }

  /** The API timestamps are double-offset: the server subtracts the Madrid
   *  timezone offset twice. Correct by adding the offset back once. */
  parse(data: LiceuData): Event[] {
    const events: Event[] = [];
    const seen = new Set<string>();
    const now = new Date().toISOString();

    const prods = Array.isArray(data.productions)
      ? data.productions
      : Object.values(data.productions);

    for (const prod of prods) {
      try {
        const title = prod.title.ca ?? prod.title.es ?? prod.title.en;
        if (!title) continue;

        const composer = prod.subtitle.ca ?? prod.subtitle.es ?? prod.subtitle.en;
        const urlPath = prod.url.ca ?? prod.url.es ?? prod.url.en;
        const url = urlPath ? new URL(urlPath, SITE_BASE).href : null;
        const fullTitle = composer ? `${title} (${composer})` : title;

        for (const session of prod.sessions) {
          try {
            if (session.date === null) continue;

            const { date, time } = fixTimestamp(session.date);

            const cast = session.artists.map(a => a.name.trim()).filter(Boolean);

            const id = generateEventId(this.venueId, date, time, title);
            if (seen.has(id)) continue;
            seen.add(id);

            events.push({
              id,
              venue_id: this.venueId,
              title: fullTitle,
              date,
              time,
              conductor: null,
              cast: cast.length > 0 ? cast : null,
              location: null,
              url,
              scraped_at: now,
            });
          } catch {
            // skip malformed session silently
          }
        }
      } catch {
        // skip malformed production silently
      }
    }

    return events;
  }
}

// The Liceu API double-subtracts the Madrid timezone offset from timestamps.
// Correct by adding the offset back once.
function fixTimestamp(ts: number): { date: string; time: string } {
  const dt = new Date(ts * 1000);
  const utc = dt.toLocaleString('en-US', { timeZone: 'UTC' });
  const local = dt.toLocaleString('en-US', { timeZone: TZ });
  const offsetMs = new Date(local).getTime() - new Date(utc).getTime();
  const corrected = new Date(dt.getTime() + offsetMs);
  return {
    date: corrected.toLocaleDateString('sv-SE', { timeZone: TZ }),
    time: corrected.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}
