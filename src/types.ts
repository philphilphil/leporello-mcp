export interface City {
  id: string;      // "stuttgart"
  name: string;    // "Stuttgart"
  country: string; // "DE"
  lat: number | null; // city-center latitude; null on legacy rows until next scrape
  lng: number | null; // city-center longitude; null on legacy rows until next scrape
}

export interface Venue {
  id: string;
  name: string;
  city_id: string;
  url: string;
  last_scraped: string | null;      // ISO 8601
  last_scrape_status: string | null; // "ok" | "error"
  last_scrape_error: string | null;
}

export interface Event {
  id: string;
  venue_id: string;
  title: string;
  date: string;        // "YYYY-MM-DD"
  time: string | null; // "HH:MM"
  conductor: string | null;
  cast: string[] | null;
  location: string | null; // physical performance location, e.g. "Liederhalle"
  url: string | null;
  scraped_at: string;  // ISO 8601
}
