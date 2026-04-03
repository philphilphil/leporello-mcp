import type { Event } from '../types.js';
import { generateEventId, USER_AGENT, type Scraper, type VenueMeta } from './base.js';

type FetchJson = () => Promise<TypesenseResponse>;

const BASE_URL = 'https://www.berliner-philharmoniker.de';
const API_KEY = '09zNJI6igIRLJHhNB2YGwgaX0JApQYOL';
const SEARCH_URL = `${BASE_URL}/filter/search/collections/performance_0/documents/search`;

interface TypesenseArtist {
  name: string;
  role: string;
}

interface TypesenseDocument {
  title: string;
  super_title: string;
  place: string;
  detail_url: string;
  time_start: number;
  time_start_formatted: string;
  date_string: string;
  artists: TypesenseArtist[];
  works_overview_formatted: string;
  is_guest_event: boolean;
}

interface TypesenseResponse {
  found: number;
  hits: { document: TypesenseDocument }[];
}

export class BerlinerPhilharmonieBerlinScraper implements Scraper {
  readonly venue: VenueMeta = {
    venueId: 'berliner-philharmonie-berlin',
    venueName: 'Berliner Philharmonie',
    cityId: 'berlin',
    cityName: 'Berlin',
    country: 'DE',
    scheduleUrl: 'https://www.berliner-philharmoniker.de/konzerte/kalender/',
  };

  get venueId(): string { return this.venue.venueId; }

  constructor(private readonly opts: { fetchJson?: FetchJson } = {}) {}

  async scrape(): Promise<Event[]> {
    const data = this.opts.fetchJson
      ? await this.opts.fetchJson()
      : await this.fetchFromApi();
    return this.parse(data);
  }

  private async fetchFromApi(): Promise<TypesenseResponse> {
    const nowUnix = Math.floor(Date.now() / 1000);
    const allHits: TypesenseResponse['hits'] = [];
    let page = 1;
    const perPage = 50;
    let totalFound = Infinity;

    while (allHits.length < totalFound) {
      const params = new URLSearchParams({
        q: '',
        query_by: 'title,place,works_raw,artists_raw,super_title,brand_title,brand_title_second',
        filter_by: `is_guest_event:false && tags:!=Führungen && time_start:>=${nowUnix}`,
        sort_by: 'time_start:asc',
        drop_tokens_threshold: '0',
        per_page: String(perPage),
        page: String(page),
      });

      const url = `${SEARCH_URL}?${params}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'x-typesense-api-key': API_KEY,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const json = (await res.json()) as TypesenseResponse;
      totalFound = json.found;
      allHits.push(...json.hits);
      if (json.hits.length < perPage) break;
      page++;
    }

    return { found: totalFound, hits: allHits };
  }

  parse(data: TypesenseResponse): Event[] {
    const events: Event[] = [];
    const now = new Date().toISOString();

    for (const hit of data.hits) {
      try {
        const doc = hit.document;
        if (!doc.title || !doc.time_start) continue;

        // Parse date and time from Unix timestamp
        const dt = new Date(doc.time_start * 1000);
        const date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

        // Parse time from formatted string ("15.30 Uhr" -> "15:30")
        let time: string | null = null;
        const timeMatch = doc.time_start_formatted?.match(/(\d{1,2})\.(\d{2})/);
        if (timeMatch) {
          time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
        }

        // Use super_title as the primary title if available, fall back to title
        const title = doc.super_title || doc.title;

        // Append composer/works overview if available
        const worksOverview = doc.works_overview_formatted?.replace(/<[^>]*>/g, '').trim();
        const fullTitle = worksOverview ? `${title} — ${worksOverview}` : title;

        // Extract conductor and cast from artists
        let conductor: string | null = null;
        const cast: string[] = [];

        for (const artist of doc.artists ?? []) {
          const role = artist.role?.toLowerCase() ?? '';
          if (role === 'dirigent' || role === 'dirigentin') {
            conductor = artist.name;
          } else if (role !== 'orchester' && role !== 'chor' && role !== 'ensemble' && role !== 'streichorchester' && role !== 'streichquartett') {
            cast.push(artist.name);
          }
        }

        // Location (place)
        const location = doc.place || null;

        // URL
        const url = doc.detail_url
          ? new URL(doc.detail_url, BASE_URL + '/').href
          : null;

        events.push({
          id: generateEventId(this.venueId, date, time, title),
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
