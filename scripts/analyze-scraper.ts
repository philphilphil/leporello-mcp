#!/usr/bin/env -S npx tsx
// Analyze a scraper against its committed fixture and emit JSON stats.
//
// Usage: npx tsx scripts/analyze-scraper.ts <venue-id>
//
// Output (stdout): JSON with parsed event count, duplicate ids, date stats,
// field coverage, garbage-title detection, and a deterministic sample of
// parsed events. Used by the /review-scraper-pr skill (checks 3-6).
//
// Exit codes:
//   0 — success
//   1 — script/usage error
//   2 — scraper threw during scrape()

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Event } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const venueId = process.argv[2];
if (!venueId) {
  console.error('Usage: npx tsx scripts/analyze-scraper.ts <venue-id>');
  process.exit(1);
}

const scraperPath = resolve(REPO_ROOT, 'src/scrapers', `${venueId}.ts`);
if (!existsSync(scraperPath)) {
  console.error(`Scraper file not found: ${scraperPath}`);
  process.exit(1);
}

const source = readFileSync(scraperPath, 'utf8');
const classMatch = source.match(/export class (\w+)\s+implements Scraper/);
if (!classMatch) {
  console.error(`Could not find "export class X implements Scraper" in ${scraperPath}`);
  process.exit(1);
}
const className = classMatch[1];
const isJson = /fetchJson\??\s*:/.test(source);

const fixtureExt = isJson ? 'json' : 'html';
const fixturePath = resolve(
  REPO_ROOT,
  'src/scrapers/__fixtures__',
  `${venueId}.${fixtureExt}`,
);
if (!existsSync(fixturePath)) {
  console.error(`Fixture not found: ${fixturePath}`);
  process.exit(1);
}
const fixtureContent = readFileSync(fixturePath, 'utf8');

const mod = (await import(pathToFileURL(scraperPath).href)) as Record<string, unknown>;
const ScraperClass = mod[className] as
  | (new (opts: Record<string, unknown>) => {
      scrape: () => Promise<Event[]>;
      venue?: { scheduleUrl?: string };
    })
  | undefined;
if (!ScraperClass) {
  console.error(`Class ${className} not exported from ${scraperPath}`);
  process.exit(1);
}

const opts: Record<string, unknown> = isJson
  ? { fetchJson: async () => JSON.parse(fixtureContent) }
  : { fetchHtml: async () => fixtureContent };

const scraper = new ScraperClass(opts);

let events: Event[];
try {
  events = await scraper.scrape();
} catch (err) {
  console.error(`Scraper threw: ${(err as Error).message}`);
  process.exit(2);
}

// ── stats ───────────────────────────────────────────────────────────────────
const scheduleUrl = scraper.venue?.scheduleUrl ?? '';

const idCount = new Map<string, number>();
for (const e of events) idCount.set(e.id, (idCount.get(e.id) ?? 0) + 1);
const duplicate_ids = [...idCount.entries()]
  .filter(([, n]) => n > 1)
  .map(([id, count]) => ({ id, count }));

const dates = events.map((e) => e.date).filter(Boolean).sort();
const today = new Date().toISOString().slice(0, 10);
const min = dates[0] ?? null;
const max = dates[dates.length - 1] ?? null;
const span_days =
  min && max ? Math.round((Date.parse(max) - Date.parse(min)) / 86400000) : 0;
const all_in_past = dates.length > 0 && dates.every((d) => d < today);
const all_same_day = dates.length > 0 && min === max;

const twoYearsOut = new Date();
twoYearsOut.setFullYear(twoYearsOut.getFullYear() + 2);
const twoYearsOutISO = twoYearsOut.toISOString().slice(0, 10);
const beyond_2y = dates.some((d) => d > twoYearsOutISO);

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 10000) / 100;
}

const conductor_n = events.filter((e) => e.conductor).length;
const cast_n = events.filter((e) => Array.isArray(e.cast) ? e.cast.length > 0 : Boolean(e.cast)).length;
const location_n = events.filter((e) => e.location).length;
const real_url_n = events.filter((e) => e.url && e.url !== scheduleUrl).length;

// Garbage-title detection. These patterns catch common selector mistakes
// (extracting nav text, footer credits, or HTML fragments).
const GARBAGE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'html_tag', re: /^\s*<[^>]+>/ },
  {
    name: 'navigation',
    re: /^(cookies?|menu|subscribe|newsletter|search|home|login|sign in|tickets?|about|contact|impressum|privacy|terms|imprint|datenschutz)$/i,
  },
];

type GarbageHit = { idx: number; id: string; title: string; reason: string };
const garbage: GarbageHit[] = [];
events.forEach((e, idx) => {
  const t = e.title ?? '';
  if (!t || t.length < 3) {
    garbage.push({ idx, id: e.id, title: t, reason: 'too_short' });
    return;
  }
  if (t.length > 300) {
    garbage.push({
      idx,
      id: e.id,
      title: t.slice(0, 80) + '…',
      reason: 'too_long',
    });
    return;
  }
  for (const p of GARBAGE_PATTERNS) {
    if (p.re.test(t)) {
      garbage.push({ idx, id: e.id, title: t, reason: p.name });
      return;
    }
  }
});

// Deterministic sample: evenly spaced across the parsed list, max 10.
const SAMPLE_SIZE = 10;
const sampleIdx =
  events.length <= SAMPLE_SIZE
    ? events.map((_, i) => i)
    : Array.from({ length: SAMPLE_SIZE }, (_, i) =>
        Math.floor((i * events.length) / SAMPLE_SIZE),
      );
const sample = sampleIdx.map((i) => events[i]);

const report = {
  venue_id: venueId,
  class_name: className,
  fixture_kind: isJson ? 'json' : 'html',
  schedule_url: scheduleUrl,
  count: events.length,
  duplicate_ids,
  garbage,
  dates: { min, max, span_days, all_in_past, all_same_day, beyond_2y },
  field_coverage: {
    conductor: { n: conductor_n, pct: pct(conductor_n, events.length) },
    cast: { n: cast_n, pct: pct(cast_n, events.length) },
    location: { n: location_n, pct: pct(location_n, events.length) },
    real_url: { n: real_url_n, pct: pct(real_url_n, events.length) },
  },
  sample,
};

console.log(JSON.stringify(report, null, 2));
