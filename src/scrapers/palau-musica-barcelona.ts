import { load } from 'cheerio';
import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

const JSON_URL =
  'https://www.palaumusica.cat/ca/programming_data_json?palau_productions=1&orfeo_productions=0&espaisoci_productions=0&sessions_as_dict=0';

type FetchJson = () => Promise<PalauData>;

interface PalauSession {
  production: number;
  expired: boolean;
  start_date: { ts: number; value: string; label: string };
  stage: number;
  problems: string | null;
  hidden: boolean;
}

interface PalauProduction {
  id: number;
  title: string;       // HTML string, e.g. "<p>Concert Title</p>"
  subtitle: string | null;
  url: string | null;
  performers: string | null; // HTML with <strong>name</strong>, <em>role</em>
}

interface PalauStage {
  title: string;
}

export interface PalauData {
  sessions: PalauSession[];
  productions: Record<string, PalauProduction>;
  stages: Record<string, PalauStage>;
}

export class PalauMusicaBarcelonaScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'palau-musica-barcelona',
    venueName: 'Palau de la Música Catalana',
    cityId: 'barcelona',
    cityName: 'Barcelona',
    country: 'ES',
    scheduleUrl: 'https://www.palaumusica.cat/ca/programacio_1158636',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchJson?: FetchJson } = {}) {}

  async scrape(): Promise<Event[]> {
    const data = this.opts.fetchJson
      ? await this.opts.fetchJson()
      : await this.fetchFromApi();
    return this.parse(data);
  }

  private async fetchFromApi(): Promise<PalauData> {
    const res = await fetch(JSON_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${JSON_URL}`);
    return res.json() as Promise<PalauData>;
  }

  parse(data: PalauData): Event[] {
    const events: Event[] = [];
    const seen = new Set<string>();
    const now = new Date().toISOString();

    for (const session of data.sessions) {
      try {
        if (session.expired || session.hidden) continue;
        if (!session.start_date?.ts) continue;

        const prod = data.productions[String(session.production)];
        if (!prod) continue;

        const title = stripHtml(prod.title);
        if (!title) continue;

        // Parse "YYYY-MM-DD HH:MM" from start_date.value
        const dateMatch = session.start_date.value.match(
          /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/,
        );
        if (!dateMatch) continue;
        const date = dateMatch[1];
        const time = dateMatch[2];

        const subtitle = prod.subtitle ? stripHtml(prod.subtitle) : null;
        const fullTitle = subtitle ? `${title} (${subtitle})` : title;

        const url = prod.url ?? null;

        // Parse stage as location
        const stage = data.stages[String(session.stage)];
        const location = stage?.title ?? null;

        // Parse performers HTML for conductor and cast
        const { conductor, cast } = parsePerformers(prod.performers);

        const id = generateEventId(this.venueId, date, time, title);
        if (seen.has(id)) continue;
        seen.add(id);

        events.push({
          id,
          venue_id: this.venueId,
          title: fullTitle,
          date,
          time,
          conductor,
          cast: cast.length > 0 ? cast : null,
          location,
          url,
          scraped_at: now,
        });
      } catch {
        // skip malformed entries silently
      }
    }

    return events;
  }
}

/** Strip HTML tags and decode entities, returning plain text. */
function stripHtml(html: string): string {
  return load(html).text().trim();
}

/** Parse the performers HTML to extract conductor and cast names. */
function parsePerformers(html: string | null): {
  conductor: string | null;
  cast: string[];
} {
  if (!html) return { conductor: null, cast: [] };

  const $ = load(html);
  let conductor: string | null = null;
  const cast: string[] = [];

  // The HTML structure pairs <strong>Name,</strong> <em>role</em>
  // Walk through strong elements to find names and their associated roles
  $('strong').each((_, el) => {
    const name = $(el).text().trim().replace(/,\s*$/, '');
    if (!name) return;

    // Find the role — the next <em> sibling or text after the strong tag
    const nextEm = $(el).next('em');
    const role = nextEm.length ? nextEm.text().trim().toLowerCase() : '';

    if (role.includes('direcció musical') || role === 'direcció' || role === 'director') {
      conductor = name;
    } else {
      cast.push(name);
    }
  });

  // Also pick up <span class="artist"> names (alternative format)
  if (cast.length === 0) {
    $('span.artist').each((_, el) => {
      const name = $(el).text().trim().replace(/,\s*$/, '');
      if (name) cast.push(name);
    });
  }

  return { conductor, cast };
}
