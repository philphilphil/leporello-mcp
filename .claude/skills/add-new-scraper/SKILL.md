---
name: add-new-scraper
description: Use when building a new venue scraper from an open scraper-request issue (ticket) in the leporello-mcp repo — investigates the venue's live site, writes the scraper + fixture + tests per CONTRIBUTING.md, runs a self-review gate (a subset of the review-scraper-pr checks) looping until green, then opens a PR that closes the issue. Invoked as `/add-new-scraper <issue-number>`.
---

# add-new-scraper

## Overview

Turns one open `scraper: <Venue> (<City>)` issue into a merge-ready PR.
Investigates the venue's live site, builds the scraper + fixture + tests
per [CONTRIBUTING.md](../../../CONTRIBUTING.md), then runs a **self-review
gate** — the same checks `review-scraper-pr` uses — against the freshly
built branch, looping to fix every finding until the gate is green, and
finally opens a PR that closes the issue.

This is the producer; `review-scraper-pr` is the independent reviewer. The
self-review makes the PR arrive pre-vetted, but it does **not** replace the
human-triggered review — the PR body says so.

**Quality bar is high. No guesses, no vibes, no inventing.** Every gate
finding MUST cite concrete evidence (a file path, a regex match, a
Playwright snapshot, a query result). Never construct or guess event detail
URLs. Never write a scraper against stale data. If you cannot back a claim
with evidence, you cannot make the claim. Taking 5-15 minutes is expected;
correctness beats speed.

## Preconditions — verify before doing anything else

1. `git status --porcelain` is empty (clean working tree). If dirty → STOP:
   "Working tree is dirty. Stash or commit first."
2. Current branch is `main`, up to date with `origin/main`. Check via
   `git rev-parse --abbrev-ref HEAD` and `git fetch && git status -uno`. If
   not → STOP.
3. Issue number is provided as an argument. Run
   `gh issue view <n> --json number,state,title,body,labels` and verify:
   - Issue exists and `state` is `OPEN`.
   - It is a scraper request (title starts `scraper:` or has the
     `enhancement` label and a schedule URL in the body).
   - Parse from the body: **venue name, schedule URL, city, country
     (ISO-2)**. If the schedule URL is missing, try the venue's official
     site; if you still cannot find a real schedule/Spielplan/programme
     page, STOP and ask the user — do not invent one.
4. Derive `venue-id` (kebab-case of the venue, matching the issue's
   `src/scrapers/<venue-id>.ts` checklist item if present). Confirm it does
   **not** already exist: `src/scrapers/<venue-id>.ts` absent and the venue
   not already in the README Supported Venues table. If it exists → STOP:
   "Venue already has a scraper."
5. If any precondition fails, STOP. Do not touch git state.

## Flow

1. **Branch off main.** `git checkout -b scraper/<venue-id>` (matches the
   repo's existing `scraper/<venue-id>` naming).

2. **Recon the live site** — decide the fetch strategy, then map the fields.
   See [Recon](#recon) below. This is the core investigative work; do it
   carefully before writing any parser code.

3. **Build** per [CONTRIBUTING.md](../../../CONTRIBUTING.md) §1–6. Do not
   duplicate its templates here — follow it exactly:
   - §1 scraper file `src/scrapers/<venue-id>.ts` (right fetch approach).
   - §2 save the fixture (`.html` or `.json`).
   - **§3 verify the fixture holds current/upcoming events** — run
     `date +%Y` and confirm. If the fixture is all stale/past data, this is
     a hard stop on the build: find a current-season URL/endpoint or the
     rendered page, per §3. Do **not** proceed with a stale fixture.
   - §4 tests `src/scrapers/__tests__/<venue-id>.test.ts` (ends with
     `testDbIntegration(scraper)`).
   - §5 `export default new <Class>()` — auto-discovery. Do **not** edit
     `src/scheduler.ts`.
   - §6 add the README Supported Venues row.

4. **Self-review gate** — run the [gate](#self-review-gate) and loop to fix
   every finding until green (see [Loop behavior](#loop-behavior)).

5. **Commit, push, open PR.** Once the gate is green:
   ```bash
   git add -A
   git commit -m "feat(<venue-id>): add scraper for <Venue Name> (<City>, <CC>)"
   git push -u origin scraper/<venue-id>
   gh pr create --title "scraper: <Venue Name> (<City>)" --body "<body>"
   ```
   The PR body MUST close the issue and carry the schedule URL (CONTRIBUTING
   §8) — see [PR body](#pr-body).

6. **Print the gate report + PR URL** into the conversation. Stay on the
   branch — do NOT return to `main`. The user reviews, optionally runs
   `/review-scraper-pr <n>`, and merges.

7. **On unexpected mid-build errors:** print whatever you have, name the
   failure clearly, leave the user on the branch. No silent rollback, no
   half-built PR.

## Recon

Decide the fetch approach using CONTRIBUTING's decision tree, then discover
selectors with the Playwright MCP browser.

**Fetch strategy** — `curl -s -A "Mozilla/5.0 ..." "<scheduleUrl>" | grep <a known event title>`:
- Finds events → **plain `fetch()`** (most scrapers).
- HTTP `403` / Cloudflare "Attention Required" → check the Network tab for a
  JSON API and use **`fetchJsonViaBrowser(scheduleUrl, apiUrl)`**; these APIs
  often ignore date params, so filter `parse()` to `date >= today` and dedupe.
- Empty HTML, no event data (JS-rendered) → **`fetchRenderedHtml(url, { waitForSelector })`**.
- Clean AJAX/JSON endpoint visible in the Network tab → fetch the **JSON** directly.

Prefer the venue's **native-language** schedule page (e.g. `/de/spielplan/`)
for untranslated titles.

**Field discovery** — open the schedule page (and one event detail page) in
the Playwright MCP browser, take a `browser_snapshot`, and locate each
field's container and the label it sits under:
- `title`, `date` (→ `YYYY-MM-DD`), `time` (`HH:MM` or null)
- `conductor` (near `Dirigent|Conductor|Direttore|Chef d'orchestre`)
- `cast` (near `Besetzung|Cast|Mit|Solist|Interpreti|Reparto`)
- `location` / hall (near `Spielort|Venue|Sala|Saal|Hall`)
- detail `url` — only a confirmed link found in the HTML; otherwise fall
  back to `scheduleUrl`, never `null`, never a guessed slug.

## Self-review gate

Run against the freshly built branch. These are `review-scraper-pr`'s checks
1–10 (its check 0 "refetch fixture" is unnecessary — the build just produced
a live fixture). For the two Playwright-heavy checks, **follow the exact
procedure in `review-scraper-pr` (its Check 7 and Check 10)** — including the
~90-day coverage rule — rather than re-deriving it. Pass bars are stated
inline so this skill runs standalone.

| # | Check | Command / method | Pass bar |
|---|-------|------------------|----------|
| 1 | Compliance | read the scraper + `gh issue`/PR draft | All 9 Event fields set; `generateEventId` used; absolute URLs via `new URL(href, BASE_URL)`; throws on non-2xx; `export default` present; `src/scheduler.ts` NOT edited; README row added; PR body will carry the schedule URL |
| 2 | Tests | `npm test -- <venue-id>` | Green |
| 3 | Re-parse | `npx tsx scripts/analyze-scraper.ts <venue-id>` | `count > 0`, script exits 0. Output feeds 4–6 + report |
| 4 | Dup / garbage | from analyze output | `duplicate_ids: []` and `garbage: []` |
| 5 | Date sanity | from analyze `dates` | not `all_in_past`, not `all_same_day`, not `beyond_2y`; `span_days ≥ 14` (unless the venue genuinely lists fewer — verify against the live page) |
| 6 | Field coverage | from analyze `field_coverage` | Plausibly-populated fields not at 0%; `real_url` near 100% (fallbacks allowed but minimized) |
| 7 | Semantic plausibility | Playwright — `review-scraper-pr` Check 7 | Each populated field of 5–10 sampled events appears adjacent to a matching label on the rendered page |
| 8 | Live scrape | `npm run scrape -- <venue-id>` | Exit 0; `scrape_success` log; no `scrape_error` / `scrape_validation_error` |
| 9 | DB verify | `sqlite3 data/leporello.db "SELECT COUNT(*), MIN(date), MAX(date) FROM events WHERE venue_id='<venue-id>';"` | Rows > 0, within ±5% of check 3's count, `MIN(date) ≥ today` |
| 10 | Precision + recall | Playwright — `review-scraper-pr` Check 10 | Sampled titles found verbatim on the schedule page; no events missing **within the next ~90 days**. Save `.playwright-mcp/<venue-id>-review.png` |

## Loop behavior

"Fix everything." After each gate pass, fix every finding and re-run the
affected checks:

- **Hard failures** (parse throws, 0 events, stale fixture, missing field,
  duplicate IDs, garbage titles, live scrape error, DB mismatch, wrong-field
  semantic mismatch) — MUST be fixed. Usually the scraper's selectors,
  date parsing, or fetch approach. Fix, re-run, repeat.
- **Soft findings** (low field coverage, recall delta, fallback URLs) — fix
  too, **unless** you can *prove via Playwright* the field/event is a genuine
  true negative (the data simply is not on the site). A proven true negative
  is **documented under "Known limitations" in the PR body and accepted** —
  do not loop on it. This is the escape valve that stops infinite iteration
  on a genuinely-empty `cast`.

**Attempt cap:** ~3 fix attempts per failing check. If a **hard** check is
still red after that, STOP on the branch, print the gate report, and do NOT
open a PR — a broken scraper does not get published. Tell the user what is
blocking.

## PR body

```markdown
## Summary
- Add scraper for **<Venue Name>** (<City>, <CC>) — Closes #<n>
- **Schedule URL:** <scheduleUrl>
- Fetch approach: <plain fetch | fetchRenderedHtml | fetchJsonViaBrowser | JSON API>
- <N> events parsed, dates <min> → <max>

## Self-review
Self-reviewed with the add-new-scraper gate (all hard checks green).
Run `/review-scraper-pr <n>` for the independent review before merge.

## Known limitations
- <proven true negatives, e.g. "cast not published on this site">
```

## Report format

Print into the conversation as Markdown (do not write to a file). Reuse
`review-scraper-pr`'s shape:

```markdown
# New scraper: #<n> — <venue name>
Branch: scraper/<venue-id>
Schedule URL: <scheduleUrl>

## Gate: <emoji> <green | blocked>

## Checks
✅ 1. Compliance            — all required items present
✅ 2. Tests                 — N tests passed
✅ 3. Re-parse              — N events
✅ 4. Duplicate / garbage   — none
✅ 5. Date sanity           — span <d1> → <d2> (<n> days)
✅ 6. Field coverage        — conductor X% · cast Y% · location Z% · real_url W%
✅ 7. Semantic plausibility — M/M sampled fields verified
✅ 8. Live scrape           — N events written, exit 0
✅ 9. DB verify             — N rows, <d1> → <d2> (matches check 3 ±X%)
✅ 10. Precision + recall   — N/M titles verbatim; recall delta D

## Findings (fixed during the loop)
### ⚠️ check 7: location value came from the wrong element
  claim:    "Großes Haus" parsed as location for "Tosca" (2026-09-12)
  evidence: schedule page labels it under "Spielort: Opernhaus"; "Großes
            Haus" appeared only in a sidebar nav block
  fix:      narrowed selector to `.event-meta .venue`; re-verified

## Known limitations
- <accepted true negatives, if any>

## Next actions
On branch `scraper/<venue-id>`, PR opened: <url>.
Run `/review-scraper-pr <n>` for the independent review, then merge.
```

Every finding line keeps `claim:` / `evidence:` / `fix:`.

## Edge cases

| Situation | Behavior |
|---|---|
| Issue isn't a scraper request | STOP at preconditions. "Issue #<n> is not a scraper request." |
| Issue body has no schedule URL | Try the venue's official site; if none found, STOP and ask. Never invent one. |
| Venue already scraped | STOP. "Venue already has a scraper." |
| Site only has stale/past events | STOP the build at CONTRIBUTING §3 — find a current-season URL/endpoint first. No scraper against stale data. |
| Cloudflare / JS-rendered | Use `fetchJsonViaBrowser` / `fetchRenderedHtml` per Recon; refetch in Playwright for the gate. |
| Detail URLs unavailable | Fall back to `scheduleUrl`; check 7 runs against the schedule page for those events. |
| Hard check still red after ~3 fixes | STOP on the branch, report the blocker, no PR. |
| Mid-build crash | Print what you have, name the failure, leave the user on the branch. |

## Red flags — STOP and reconsider

- Writing a scraper against a fixture full of past events
- Constructing or guessing an event detail URL from a title slug
- Editing `src/scheduler.ts` (auto-discovery means you never should)
- Opening the PR while a hard check is red
- Calling a field correct without having opened the page in Playwright
- Looping forever on a soft finding instead of proving it a true negative
- Making a finding without an `evidence:` line you can fill in
- Returning to `main` before the user has reviewed
