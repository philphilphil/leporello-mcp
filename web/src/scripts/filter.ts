import { t, getLang } from '../i18n/index.js';

interface Event {
  id: string;
  venue_id: string;
  venue_name: string;
  title: string;
  date: string;
  time: string | null;
  conductor: string | null;
  cast: string[] | null;
  location: string | null;
  url: string | null;
}

interface Venue {
  id: string;
  name: string;
  city_id: string;
  city_name: string;
}

interface City {
  id: string;
  name: string;
  country: string;
}

interface PageData {
  cities: City[];
  venues: Venue[];
  events: Event[];
  dataAge: Record<string, string | null>;
}

const data: PageData = JSON.parse(
  document.getElementById('event-data')!.textContent!
);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const countrySelect = document.getElementById('filter-country') as HTMLSelectElement;
const citySelect = document.getElementById('filter-city') as HTMLSelectElement;
const venueSelect = document.getElementById('filter-venue') as HTMLSelectElement;
const daysSelect = document.getElementById('filter-days') as HTMLSelectElement;
const searchInput = document.getElementById('filter-search') as HTMLInputElement;
const clearBtn = document.getElementById('filter-clear') as HTMLButtonElement;
const eventList = document.getElementById('event-list')!;
const eventCount = document.getElementById('event-count')!;
const filterToggle = document.getElementById('filter-toggle') as HTMLElement;
const filterDetails = document.getElementById('filter-details') as HTMLDetailsElement;

function initFiltersFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.has('country')) countrySelect.value = params.get('country')!;
  if (params.has('city')) citySelect.value = params.get('city')!;
  if (params.has('venue')) venueSelect.value = params.get('venue')!;
  if (params.has('days')) daysSelect.value = params.get('days')!;
  if (params.has('q')) searchInput.value = params.get('q')!;
}

function updateUrl(): void {
  const params = new URLSearchParams();
  if (countrySelect.value) params.set('country', countrySelect.value);
  if (citySelect.value) params.set('city', citySelect.value);
  if (venueSelect.value) params.set('venue', venueSelect.value);
  if (daysSelect.value !== '30') params.set('days', daysSelect.value);
  if (searchInput.value) params.set('q', searchInput.value);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

function populateCityDropdown(): void {
  const country = countrySelect.value;
  const currentCity = citySelect.value;
  const filtered = country
    ? data.cities.filter((c) => c.country === country)
    : data.cities;

  citySelect.innerHTML = `<option value="">${t('filter.all_cities')}</option>`;
  for (const c of filtered) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    citySelect.appendChild(opt);
  }

  if (filtered.some((c) => c.id === currentCity)) {
    citySelect.value = currentCity;
  }
}

function populateVenueDropdown(): void {
  const country = countrySelect.value;
  const city = citySelect.value;
  const currentVenue = venueSelect.value;

  let filtered = data.venues;
  if (city) {
    filtered = filtered.filter((v) => v.city_id === city);
  } else if (country) {
    const countryCityIds = new Set(data.cities.filter((c) => c.country === country).map((c) => c.id));
    filtered = filtered.filter((v) => countryCityIds.has(v.city_id));
  }

  venueSelect.innerHTML = `<option value="">${t('filter.all_venues')}</option>`;
  for (const v of filtered) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    venueSelect.appendChild(opt);
  }

  if (filtered.some((v) => v.id === currentVenue)) {
    venueSelect.value = currentVenue;
  }
}

function filterEvents(): Event[] {
  const country = countrySelect.value;
  const city = citySelect.value;
  const venue = venueSelect.value;
  const days = parseInt(daysSelect.value, 10);
  const query = searchInput.value.toLowerCase().trim();

  const today = new Date();
  const until = new Date();
  until.setDate(today.getDate() + days);
  const todayStr = today.toISOString().slice(0, 10);
  const untilStr = until.toISOString().slice(0, 10);

  const countryCityIds = country
    ? new Set(data.cities.filter((c) => c.country === country).map((c) => c.id))
    : null;

  return data.events.filter((e) => {
    if (e.date < todayStr || e.date > untilStr) return false;
    if (venue && e.venue_id !== venue) return false;
    if (city && !venue) {
      const v = data.venues.find((v) => v.id === e.venue_id);
      if (v && v.city_id !== city) return false;
    }
    if (countryCityIds && !city && !venue) {
      const v = data.venues.find((v) => v.id === e.venue_id);
      if (v && !countryCityIds.has(v.city_id)) return false;
    }
    if (query) {
      const haystack = [
        e.title,
        e.venue_name,
        e.conductor,
        e.location,
        ...(e.cast ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(getLang(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function hasActiveFilters(): boolean {
  return !!(countrySelect.value || citySelect.value || venueSelect.value || daysSelect.value !== '30' || searchInput.value);
}

function updateClearButton(): void {
  clearBtn.classList.toggle('visible', hasActiveFilters());
}

function countActiveFilters(): number {
  let count = 0;
  if (countrySelect.value) count++;
  if (citySelect.value) count++;
  if (venueSelect.value) count++;
  if (daysSelect.value !== '30') count++;
  return count;
}

function updateFilterToggle(): void {
  const count = countActiveFilters();
  if (count > 0) {
    filterToggle.textContent = t('filter.toggle_count', { n: count });
  } else {
    filterToggle.textContent = t('filter.toggle');
  }
}

function resetFilters(): void {
  countrySelect.value = '';
  citySelect.value = '';
  venueSelect.value = '';
  daysSelect.value = '30';
  searchInput.value = '';
  populateCityDropdown();
  populateVenueDropdown();
  render();
}

function render(): void {
  const events = filterEvents();
  updateUrl();
  updateClearButton();
  updateFilterToggle();

  eventCount.textContent = events.length === 1
    ? t('events.count_one')
    : t('events.count', { n: events.length });

  if (events.length === 0) {
    eventList.innerHTML = `<p class="no-results">${t('events.none')}</p>`;
    return;
  }

  // Group by date
  const groups = new Map<string, Event[]>();
  for (const e of events) {
    const list = groups.get(e.date) ?? [];
    list.push(e);
    groups.set(e.date, list);
  }

  let html = '<table class="event-table"><tbody>';
  for (const [date, evts] of groups) {
    html += `<tr class="date-row"><td colspan="4" class="date-header">${formatDate(date)}</td></tr>`;
    for (const e of evts) {
      const time = esc(e.time ?? '');
      const venue = esc(e.venue_name ?? '');
      const location = e.location ? esc(e.location) : null;
      const venueDisplay = location ? `${venue}<span class="event-location"> · ${location}</span>` : venue;
      const safeUrl = e.url && /^https?:\/\//.test(e.url) ? e.url : null;
      const link = (text: string, cls: string) =>
        safeUrl ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener" class="${cls}">${text}</a>` : `<span class="${cls}">${text}</span>`;

      let people = '';
      if (e.conductor) people += `<span class="people-label">${t('event.conductor')}</span> ${esc(e.conductor)}`;
      if (e.cast && e.cast.length > 0) {
        if (people) people += '<br>';
        people += `<span class="people-label">${t('event.cast')}</span> ${e.cast.map(esc).join(', ')}`;
      }

      html += `<tr class="event-row">`;
      html += `<td class="event-time">${time}</td>`;
      html += `<td class="event-title">${link(esc(e.title), 'event-link')}</td>`;
      html += `<td class="event-venue">${venueDisplay}</td>`;
      html += `<td class="event-people">${people}</td>`;
      html += `</tr>`;
    }
  }
  html += '</tbody></table>';
  eventList.innerHTML = html;
}

// Debounce helper
function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout>;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

// Wire up event listeners
countrySelect.addEventListener('change', () => {
  populateCityDropdown();
  populateVenueDropdown();
  render();
});
citySelect.addEventListener('change', () => {
  populateVenueDropdown();
  render();
});
venueSelect.addEventListener('change', render);
daysSelect.addEventListener('change', render);
searchInput.addEventListener('input', debounce(render, 200));
clearBtn.addEventListener('click', resetFilters);
const doneBtn = document.getElementById('filter-done');
if (doneBtn) {
  doneBtn.addEventListener('click', () => {
    filterDetails.removeAttribute('open');
  });
}

// Initialize
initFiltersFromUrl();
populateCityDropdown();
populateVenueDropdown();
render();

// On mobile, start with filters collapsed
if (window.matchMedia('(max-width: 700px)').matches) {
  filterDetails.removeAttribute('open');
}
