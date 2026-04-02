export interface City {
  id: string;      // "stuttgart"
  name: string;    // "Stuttgart"
  country: string; // "DE"
}

export interface Venue {
  id: string;
  name: string;
  city_id: string;
  url: string;
  last_scraped: string | null; // ISO 8601
}

export interface Event {
  id: string;
  venue_id: string;
  title: string;
  date: string;        // "YYYY-MM-DD"
  time: string | null; // "HH:MM"
  conductor: string | null;
  cast: string[] | null;
  url: string | null;
  scraped_at: string;  // ISO 8601
}
