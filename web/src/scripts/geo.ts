// Pure geo helpers — no DOM, no Astro. Unit-tested in __tests__/geo.test.ts.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface CityCoords {
  id: string;
  lat: number | null;
  lng: number | null;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two points in kilometres (haversine).
 * Correct across the equator, the prime meridian, and the antimeridian.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The city nearest to `origin`, ignoring cities without coordinates.
 * Returns null if no city has coordinates.
 */
export function nearestCity<T extends CityCoords>(origin: LatLng, cities: readonly T[]): T | null {
  let best: T | null = null;
  let bestKm = Infinity;
  for (const c of cities) {
    if (c.lat == null || c.lng == null) continue;
    const km = haversineKm(origin, { lat: c.lat, lng: c.lng });
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return best;
}
