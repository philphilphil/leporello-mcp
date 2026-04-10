---
name: review-scraper-pr
description: Use when reviewing an open scraper PR in the leporello-mcp repo before merging — runs an end-to-end quality review of one PR (refetches the venue's live page, verifies parsing/tests/DB writes, semantically cross-checks parsed fields against the rendered page via Playwright) and prints a verdict with evidence-backed findings into the conversation. Invoked as `/review-scraper-pr <pr-number>`.
---

# review-scraper-pr

## Overview

End-to-end review of one open scraper PR. Runs 11 checks against the PR
branch — refetches the venue's live data, verifies parsing/tests/DB
writes, and uses Playwright to semantically cross-check parsed fields
against what is actually rendered on the venue's site. Prints a verdict
plus findings into the conversation. The human reads the report and
either tells you to fix things (you are already on the right branch) or
to merge.

**Quality bar is high. No guesses, no vibes, no inventing.** Every
finding in the report MUST cite concrete evidence (a file path, a regex
match, a Playwright snapshot, a query result). If you cannot back a
claim with evidence, you cannot make the claim. The skill is allowed to
take 1-3 minutes per PR; confidence beats speed.

## Preconditions — verify before doing anything else

1. `git status --porcelain` is empty (clean working tree). If dirty →
   STOP and tell the user: "Working tree is dirty. Stash or commit first."
2. Current branch is `main` and up to date with `origin/main`. Check via
   `git rev-parse --abbrev-ref HEAD` and `git fetch && git status -uno`.
   If not → STOP and tell the user.
3. PR number is provided as an argument. Run `gh pr view <n> --json
   number,state,headRefName,files,title,body` and verify:
   - PR exists and `state` is `OPEN`
   - At least one file under `src/scrapers/` is added (not just modified)
   - Exactly **one** new scraper file (one new `src/scrapers/<venue-id>.ts`)
4. If preflight fails for any reason, STOP. Do not touch git state.

## Flow

1. **Checkout the PR branch in place.**
   ```bash
   gh pr checkout <n>
   ```
   This puts you on the PR's branch directly. No worktree.

2. **Identify the scraper.** From the PR file list, find the new
   `src/scrapers/<venue-id>.ts` file. Read it. Capture:
   - `venue-id` (from `venueId:` in the `VenueMeta`)
   - `scheduleUrl`
   - Whether it uses `fetchHtml` (HTML scraper) or `fetchJson` (JSON
     scraper) — grep the constructor signature
   - Whether it uses `fetchRenderedHtml` (Playwright fetch) — grep imports

3. **Run the 11 checks below in order.** Cheap mechanical checks first
   so a broken PR fails fast; expensive Playwright checks last. Record
   the result of each check as you go — you will collate them into the
   report at the end.

4. **Print the report into the conversation** in the format specified
   below.

5. **Stay on the PR branch.** Do NOT `git checkout main`. The user is
   expected to either tell you to address findings (you are already on
   the right branch), to merge, or to bail manually.

6. **On unexpected mid-review errors:** print whatever you gathered,
   name the failure clearly, and leave the user on the PR branch. No
   silent rollback.

## The 11 checks

### Check 0 — Refresh fixture (live fetch)

Refetch the venue's `scheduleUrl` using the **same method the scraper
uses**, and overwrite the committed fixture. All downstream checks then
run against current live data.

- **Plain HTML scraper** (no `fetchRenderedHtml`, no `fetchJson`):
  ```bash
  curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
    -o src/scrapers/__fixtures__/<venue-id>.html \
    "<scheduleUrl>"
  ```
  Then check the HTTP status: re-run with `-o /dev/null -w "%{http_code}"`
  and verify it is `200`.

- **JS-rendered HTML scraper** (uses `fetchRenderedHtml`): use the
  Playwright MCP tools (`browser_navigate`, then `browser_evaluate` to
  capture `document.documentElement.outerHTML`) and write the result
  to `src/scrapers/__fixtures__/<venue-id>.html`.

- **JSON API scraper** (uses `fetchJson`): the source typically calls
  one or more JSON endpoints. Identify the endpoint URL(s) from the
  scraper source, fetch with curl, save the response body to
  `src/scrapers/__fixtures__/<venue-id>.json`. If the scraper fetches
  multiple endpoints (e.g. month-by-month), save the array form the
  scraper expects.

If the live fetch fails (4xx, 5xx, network error, blocked) →
**STOP HERE**. Report `❌ Broken: refetch failed (HTTP <code>)`. Do not
fall back to the committed fixture and do not run downstream checks.
A scraper whose source URL is dead is broken regardless of what local
tests pass.

### Check 1 — CONTRIBUTING.md compliance (static)

Read the new scraper file and grep for:

- [ ] Imports `generateEventId` from `./base.js`
- [ ] All 9 Event fields appear in the `events.push(...)` call:
      `id`, `venue_id`, `title`, `date`, `time`, `conductor`, `cast`,
      `location`, `url`, `scraped_at`
- [ ] Uses `new URL(href, BASE_URL)` (or equivalent) to build absolute
      URLs — flag any manual string concatenation
- [ ] Throws on non-2xx responses (`if (!res.ok) throw ...`)
- [ ] Registered in `src/scheduler.ts` `scrapers` array
- [ ] Listed in the README's Supported Venues table
- [ ] PR description (from `gh pr view`) contains a clickable URL to the
      schedule page

Each missing item is a finding.

### Check 2 — Test pass

```bash
npm test -- <venue-id>
```

The fixture was just overwritten in check 0, so this is now testing the
parser against current live data. Capture the pass/fail result and the
test count. **Hard fail** if red.

### Check 3 — Re-parse in-process

```bash
npx tsx scripts/analyze-scraper.ts <venue-id>
```

This script imports the scraper class, runs it against the freshly
refetched fixture, and outputs JSON with parsed events plus stats. Read
the output. **Hard fail** if `count` is 0 or the script throws.

The same JSON feeds checks 4, 5, 6, 7, and the report.

### Check 4 — Duplicate / garbage detection

From the analyze-scraper output:

- `duplicate_ids` should be `[]`. Any entry is a finding.
- `garbage` should be `[]`. Any entry (titles too short, too long, HTML
  tags, navigation strings) is a finding citing the offending event id
  and reason.

### Check 5 — Date sanity

From the analyze-scraper output's `dates` block:

- `all_in_past: true` → finding (parser is reading stale data)
- `all_same_day: true` → finding (looks like a single date got attached
  to every event)
- `span_days < 14` → finding (real venues publish a multi-week schedule)
- `beyond_2y: true` → finding (likely a date parse bug)

### Check 6 — Field-quality sampling

From `field_coverage`. Report the raw counts and percentages. **Does not
fail on its own**, but feeds the verdict logic and the human read:

- A field at 0% when it is plausibly populated (e.g. `cast` at 0% for
  an opera house) → soft finding
- `real_url` significantly below 100% → soft finding (many events
  fall back to scheduleUrl, which CONTRIBUTING allows but is worth
  flagging)

### Check 7 — Semantic plausibility (verified, not vibe-checked)

This is the most important judgment check. **No guesses.** You must
prove via Playwright that what was parsed actually appears on the
rendered page near a label that means what the field claims.

For each of 5-10 events from the `sample` field of analyze-scraper
output:

1. Open the event's `url` in the Playwright MCP browser
   (`browser_navigate`). If the event url falls back to the schedule
   URL (`url === schedule_url`), open the schedule URL once and use it
   for all sampled events.
2. Take a `browser_snapshot` of the rendered page.
3. For each populated field on the event, search the snapshot text:
   - **`conductor`** — the parsed value MUST appear adjacent to a label
     matching `/Conductor|Dirigent|Direttore|Chef d'orchestre|Direttore d'orchestra|Cond\./i`
   - **`location`** — the parsed value MUST appear adjacent to a label
     matching `/Spielort|Venue|Location|Sala|Saal|Hall|Auditori/i`
     (or be plausibly the only hall name on the page for venues with one
     hall)
   - **`cast`** — the parsed names MUST appear adjacent to a label
     matching `/Besetzung|Cast|Mit|With|Soloists|Solisten|Interpreti|Reparto/i`
4. If a parsed value is **not** found near a matching label → finding.
   The evidence cited must be: the URL searched, the label patterns
   tried, and where the value was found instead (if anywhere — e.g.
   "found in footer credits block"). Quote the surrounding text.

If a sampled event detail page returns 404, that itself is a finding.

### Check 8 — Live scrape (end-to-end)

```bash
npm run scrape -- <venue-id>
```

Exercises the full real-world fetch pipeline (its own fetch call,
headers, redirect handling, DB write) — code paths the in-process
re-parse in check 3 does not cover. Capture from the structured logs:

- Exit code (must be 0)
- Event count from the `scrape_success` log line
- Any `scrape_error` or `scrape_validation_error` log lines

**Hard fail** on non-zero exit, scrape_error, or validation errors.

### Check 9 — DB verification

```bash
sqlite3 data/leporello.db \
  "SELECT COUNT(*), MIN(date), MAX(date) FROM events WHERE venue_id = '<venue-id>';"
```

Confirm:

- Row count > 0
- Row count is in the same ballpark as check 8's reported count
  (within ±5%)
- `MIN(date)` is today or later
- `MAX(date)` is plausible

A divergence between check 3's in-process count and check 9's DB count
that is **larger than ±5%** is itself a finding (means the in-process
parse and the live scrape disagree, which usually points to error
handling, pagination, or fetchJson differences).

### Check 10 — Playwright cross-check (precision + recall)

Open the venue's `scheduleUrl` in the Playwright MCP browser and take a
snapshot. Two sub-checks:

**Precision.** Sample 5-10 event titles from the analyze-scraper output
(use the `sample` field) and search the rendered schedule page for each
title. For each:
- ✅ found verbatim
- ⚠️ found as substring or close match (note the difference)
- ❌ not found at all → finding ("scraper extracted plausible-looking
  text from the wrong element")

**Recall.** From the snapshot's accessibility tree, count event-block
elements (look for repeated structural patterns: list items, headings
with dates, repeated card structures). Compare to `count` from check 3.

- If the snapshot shows substantially more events than the scraper
  parsed (e.g. >25% delta) → finding ("selector is too narrow,
  scraper is missing events")
- If the snapshot shows substantially fewer → likely the page paginates
  or lazy-loads; not a finding by itself, but worth noting

Save a screenshot to `.playwright-mcp/<venue-id>-review.png` (per the
CLAUDE.md convention) so the human can eyeball it after the report if
something looks off.

## Report format

Print this directly into the conversation as Markdown. Do not write to
a file.

```markdown
# Scraper PR review: #<n> — <venue name>
Branch: <branch>
Schedule URL: <scheduleUrl>

## Verdict: <emoji> <tier>

## Checks
✅ 0. Refetch fixture            — fetched <kb>, fixture overwritten
✅ 1. Compliance                 — all required items present
✅ 2. Test pass                  — N tests passed
✅ 3. Re-parse in-process        — N events
⚠️ 4. Duplicate / garbage        — M findings (see below)
✅ 5. Date sanity                — span <d1> → <d2> (<n> days)
✅ 6. Field-quality              — conductor X/N (P%), cast Y/N (P%), location Z/N (P%), real_url W/N (P%)
⚠️ 7. Semantic plausibility      — M findings (see below)
✅ 8. Live scrape                — N events written, exit 0
✅ 9. DB verification            — N rows, dates <d1> → <d2> (matches check 3 ±X%)
✅ 10. Playwright cross-check    — N/M titles found verbatim; recall delta D

## Findings

### ⚠️ check 7: conductor value not found near conductor label
  claim:    conductor "John Smith" parsed for event "Carmen" (2026-05-15)
            is not found adjacent to a conductor-label element on the
            rendered page
  evidence: searched https://example.com/event/carmen for labels matching
            /Conductor|Dirigent|Direttore/i; none contained "John Smith".
            Found "John Smith" in a footer credits block instead:
            "...Site by John Smith Design..."
  suggest:  check the selector — looks like the scraper picked up a
            footer name

(repeat for each finding)

## Next actions
You're on branch `<branch>`. Address the findings above, or tell me to
proceed (fix / merge / discard).
```

**Every finding MUST have all three lines: `claim:`, `evidence:`,
`suggest:`.** Findings without evidence are not allowed. If you cannot
fill in the evidence line, you cannot make the finding.

## Verdict tiers

- ✅ **Ready to merge** — every check is ✅, zero findings
- ⚠️ **Issues to address** — any soft finding (low field coverage,
  recall delta, semantic mismatches, garbage entries that did not
  break the parse)
- ❌ **Broken** — any hard failure (refetch failed, tests red, parse
  threw, zero events extracted, live scrape exit ≠ 0, IDs duplicated,
  required field missing, scrape_error or scrape_validation_error)

The bar for ✅ is intentionally high. Even one warning → ⚠️.

## Edge cases

| Situation | Behavior |
|---|---|
| Venue site is down at refetch | STOP at check 0, report `❌ Broken: refetch failed (<status>)`. Do not run downstream checks. |
| JSON API scraper | Refetch the JSON endpoint(s). Playwright cross-check still uses the human-facing `scheduleUrl`. |
| Event detail URLs all fall back to scheduleUrl | Check 7 runs against the schedule page itself for all sampled events. |
| Scraper uses `fetchRenderedHtml` | Use Playwright MCP for the refetch to get the same rendered DOM the scraper sees. |
| Refetched HTML produces zero events | Hard fail at check 3. The parser is broken against current data or selectors are stale. |
| PR touches files outside `src/scrapers/` | Refuse at preflight. "This PR is not a scraper PR." |
| PR adds multiple new scrapers | Refuse at preflight. "Run me once per scraper or split the PR." |
| Mid-review crash | Print whatever was gathered, name the failure, leave the user on the PR branch. |

## Red flags — STOP and reconsider

- Making a finding without an `evidence:` line you can fill in
- Saying "this looks fine" without having actually opened the page in
  Playwright
- Skipping check 7 because "the field values look plausible"
- Skipping check 10 because checks 1-9 already passed
- Sampling fewer than 5 events for checks 7 and 10
- Reporting ✅ when there is any finding at all
- Returning to `main` after the review

Each of these means the review is not yet complete. Do not move on.
