import { haversineKm, nearestCity, type CityCoords } from '../geo.js';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 48.2082, lng: 16.3738 }, { lat: 48.2082, lng: 16.3738 })).toBe(0);
  });

  it('matches a known distance (Paris ↔ London ≈ 344 km)', () => {
    const km = haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 });
    expect(km).toBeGreaterThan(330);
    expect(km).toBeLessThan(355);
  });

  it('handles the antimeridian without wrapping the long way round', () => {
    // 2° of longitude at the equator ≈ 222 km — not ~39,000 km.
    const km = haversineKm({ lat: 0, lng: 179 }, { lat: 0, lng: -179 });
    expect(km).toBeLessThan(250);
  });

  it('is symmetric', () => {
    const a = { lat: 40.7128, lng: -74.006 };
    const b = { lat: 37.7749, lng: -122.4194 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe('nearestCity', () => {
  const cities: CityCoords[] = [
    { id: 'stuttgart', lat: 48.7758, lng: 9.1829 },
    { id: 'muenchen', lat: 48.1351, lng: 11.582 },
    { id: 'wien', lat: 48.2082, lng: 16.3738 },
    { id: 'sydney', lat: -33.8688, lng: 151.2093 },
  ];

  it('picks the geographically closest city', () => {
    expect(nearestCity({ lat: 48.1, lng: 11.6 }, cities)?.id).toBe('muenchen');
  });

  it('works in the southern hemisphere', () => {
    expect(nearestCity({ lat: -33.9, lng: 151.0 }, cities)?.id).toBe('sydney');
  });

  it('skips cities without coordinates', () => {
    const withNulls: CityCoords[] = [
      { id: 'muenchen', lat: null, lng: null }, // closest but no coords
      { id: 'wien', lat: 48.2082, lng: 16.3738 },
    ];
    expect(nearestCity({ lat: 48.1, lng: 11.6 }, withNulls)?.id).toBe('wien');
  });

  it('returns null when no city has coordinates', () => {
    expect(nearestCity({ lat: 0, lng: 0 }, [{ id: 'x', lat: null, lng: null }])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(nearestCity({ lat: 0, lng: 0 }, [])).toBeNull();
  });
});
