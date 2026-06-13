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
  country: string;
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

const venueCity = new Map(data.venues.map((v) => [v.id, v.city_name]));
const venueCountry = new Map(data.venues.map((v) => [v.id, v.country]));

function flagSpan(country: string | undefined): string {
  const cc = (country ?? '').toLowerCase();
  return /^[a-z]{2}$/.test(cc) ? `<span class="fi fi-${cc} flag" aria-hidden="true"></span>` : '';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const countrySelect = document.getElementById('filter-country') as HTMLSelectElement;
const citySelect = document.getElementById('filter-city') as HTMLSelectElement;
const venueSelect = document.getElementById('filter-venue') as HTMLSelectElement;
const periodGroup = document.getElementById('filter-days')!;
const searchInput = document.getElementById('filter-search') as HTMLInputElement;
const clearBtn = document.getElementById('filter-clear') as HTMLButtonElement;
const eventList = document.getElementById('event-list')!;
const eventCount = document.getElementById('event-count')!;

// ── Segmented period control ──
function getDays(): string {
  return periodGroup.querySelector<HTMLButtonElement>('.seg-btn.is-active')?.dataset.days ?? '30';
}
function setDays(value: string): void {
  let matched = false;
  for (const btn of periodGroup.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
    const active = btn.dataset.days === value;
    if (active) matched = true;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  if (!matched) setDays('30');
}

function initFiltersFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.has('country')) countrySelect.value = params.get('country')!;
  if (params.has('city')) citySelect.value = params.get('city')!;
  if (params.has('venue')) venueSelect.value = params.get('venue')!;
  if (params.has('days')) setDays(params.get('days')!);
  if (params.has('q')) searchInput.value = params.get('q')!;
}

function updateUrl(): void {
  const params = new URLSearchParams();
  if (countrySelect.value) params.set('country', countrySelect.value);
  if (citySelect.value) params.set('city', citySelect.value);
  if (venueSelect.value) params.set('venue', venueSelect.value);
  if (getDays() !== '30') params.set('days', getDays());
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

  citySelect.innerHTML = `<option value="">${esc(t('filter.all_cities'))}</option>`;
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

  venueSelect.innerHTML = `<option value="">${esc(t('filter.all_venues'))}</option>`;
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
  const days = parseInt(getDays(), 10);
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
  return !!(countrySelect.value || citySelect.value || venueSelect.value || getDays() !== '30' || searchInput.value);
}

function updateClearButton(): void {
  clearBtn.classList.toggle('visible', hasActiveFilters());
}

function resetFilters(): void {
  countrySelect.value = '';
  citySelect.value = '';
  venueSelect.value = '';
  setDays('30');
  searchInput.value = '';
  populateCityDropdown();
  populateVenueDropdown();
  render();
}

function eventMarkup(e: Event): string {
  const safeUrl = e.url && /^https?:\/\//.test(e.url) ? e.url : null;
  const titleText = esc(e.title);
  const title = safeUrl
    ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener" class="ev-link">${titleText}</a>`
    : titleText;

  const venue = `<span class="venue">${esc(e.venue_name ?? '')}</span>`;
  const loc = e.location ? `<span class="sep">·</span>${esc(e.location)}` : '';

  const castParts: string[] = [];
  if (e.conductor) {
    castParts.push(`<span class="ev-role">${esc(t('event.conductor'))}</span>${esc(e.conductor)}`);
  }
  if (e.cast && e.cast.length > 0) {
    castParts.push(`<span class="ev-role">${esc(t('event.cast'))}</span>${e.cast.map(esc).join(', ')}`);
  }
  const cast = castParts.length
    ? `<div class="ev-cast">${castParts.join('<span class="sep">·</span>')}</div>`
    : '';

  const city = venueCity.get(e.venue_id);
  const cityHtml = city
    ? `<div class="ev-city">${flagSpan(venueCountry.get(e.venue_id))}${esc(city)}</div>`
    : '';

  const timeCls = e.time ? 'ev-time' : 'ev-time is-tba';
  const time = e.time ? esc(e.time) : '—';

  return (
    `<article class="event">` +
    `<div class="${timeCls}">${time}</div>` +
    `<div class="ev-main"><div class="ev-title">${title}</div><div class="ev-sub">${venue}${loc}</div>${cast}</div>` +
    cityHtml +
    `</article>`
  );
}

function render(): void {
  const events = filterEvents();
  updateUrl();
  updateClearButton();

  eventCount.textContent = events.length === 1
    ? t('events.count_one')
    : t('events.count', { n: events.length });

  if (events.length === 0) {
    eventList.innerHTML = `<div class="no-results">${esc(t('events.none'))}</div>`;
    return;
  }

  // Group by date (events already sorted by date, time)
  const groups = new Map<string, Event[]>();
  for (const e of events) {
    const list = groups.get(e.date) ?? [];
    list.push(e);
    groups.set(e.date, list);
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  let html = '';
  for (const [date, evts] of groups) {
    let marker = '';
    if (date === todayStr) marker = `<span class="day-today">${esc(t('date.today'))}</span>`;
    else if (date === tomorrowStr) marker = `<span class="day-tomorrow">${esc(t('date.tomorrow'))}</span>`;
    html += `<section class="day"><h2 class="day-label">${esc(formatDate(date))}${marker}</h2><div class="events">`;
    for (const e of evts) html += eventMarkup(e);
    html += `</div></section>`;
  }
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
periodGroup.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg-btn');
  if (!btn || !btn.dataset.days) return;
  setDays(btn.dataset.days);
  render();
});
searchInput.addEventListener('input', debounce(render, 200));
clearBtn.addEventListener('click', resetFilters);

// Initialize
initFiltersFromUrl();
populateCityDropdown();
populateVenueDropdown();
render();
