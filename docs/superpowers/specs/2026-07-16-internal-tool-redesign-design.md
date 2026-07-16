# OpenRenew Internal-Tool Redesign — Design

**Date:** 2026-07-16
**Status:** Approved
**Context:** OpenRenew is now a self-hosted internal tool, but its home screen still has
SaaS DNA: vanity metric cards, promotional copy, SEO/OG metadata for an app behind a
login. This redesign re-prioritizes the UI around the product's two real questions —
"what do I need to act on now?" and "what's coming?" — and finishes the Renewl→OpenRenew
rename.

## Goals

- Home screen leads with a **triage queue** of contracts needing a decision, then a
  12-month **horizon timeline**, then the dense contract table. No marketing surface.
- **iCal feed** so deadlines appear in the calendars people already check.
- Zero "Renewl" references outside intentional history (DECISIONS.md).

## Non-Goals

- No new lifecycle workflows (renewal upload/compare and cron expiry stay as-is).
- No changes to auth, alerts generation/delivery, review or detail pages beyond the
  decision badge.
- No visual rebrand — dark terminal aesthetic, inline styles, and all hard rules stay.

## 1. Strip the SaaS shell

Delete:
- `components/dashboard/DashboardMetrics.tsx` and its usage (the 3-card metric row).
- `app/opengraph-image.tsx`, `app/twitter-image.tsx`, `app/api/og/` (route + assets).
- `app/sitemap.ts`, `app/robots.ts`.
- In `app/layout.tsx`: `keywords`, `openGraph`, `twitter`, `authors`, and any other
  SEO-only metadata. Keep `title` (default + template), `description`, `metadataBase`,
  icons.
- Upload-zone promotional copy: the bulk-import "let us know" mailto sentence. The zone
  becomes a slim strip: "Drop a contract PDF · or click to browse · Add manually →".

Keep tracked spend: rendered as a one-line stat in the contract-table header, e.g.
`~$12k/yr tracked across 8 contracts` (same computation the deleted card used; hidden
when no contract has `annual_value`).

## 2. Triage queue (home hero)

**Derivation — `lib/triage.ts` (pure, unit-tested).**

```
type TriageItem = {
  contract_id: string; name: string;
  party_a: string | null; party_b: string | null;
  annual_value: number | null;
  decision_date: string;          // YYYY-MM-DD — the point of no return
  decision_kind: "notice_deadline" | "expiry" | "renewal";
  days_left: number;              // negative = overdue
  urgency: "overdue" | "critical" | "warning";  // <0 | ≤7 | ≤30 days
};
buildTriageQueue(contracts, today) => TriageItem[]
```

Rules:
- Input: `active` contracts only.
- Decision date per contract: `expiry − notice_period_days` when both exist and that
  date is today-or-future-or-past (i.e. always prefer the notice deadline when a notice
  period exists); else `renewal_date` if set and ≠ expiry; else `expiry_date`. Contracts
  with no dates at all never enter the queue.
- Enters the queue when `days_left ≤ 30` (including negative/overdue).
- Excluded when `snoozed_until` is today-or-future, or `renewal_decision` is set.
- Sort: overdue first (most overdue on top), then ascending `days_left`.
- Date math uses the same UTC-midnight normalization as `lib/alerts.ts`.

**Schema (migration #2):** `contracts.snoozed_until date NULL`,
`contracts.renewal_decision text NULL` (values: `renewing | canceling | negotiating`).

**Actions API — `PATCH /api/contracts/[id]/decision`** (auth `requireUser()`):
body `{ decision: "renewing" | "canceling" | "negotiating" | null }` or
`{ snooze_days: 7 }`. Setting a decision clears `snoozed_until`; `decision: null`
clears the decision (undo). Response `{ ok: true }`. zod-validated.

**Queue item UI** (client component `components/dashboard/triage-queue.tsx`, receives
items as props from the server page): urgency color bar, contract name (links to
detail), `party_a ↔ party_b`, sentence like `Notice window closes Jul 30 — 15 days
left` (or `— 3 days overdue`), value when present, and buttons: `Renewing` `Canceling`
`Negotiating` `Snooze 7d`, plus `Draft email →` linking to the contract detail page's
existing drafter section — shown only when `aiEnabled` prop is true AND the contract has
analysis findings (server page passes a `has_findings` boolean per item). Buttons call
the decision API then `router.refresh()`. Inline styles, dark theme, existing fonts.

**Decision badge:** contract table rows and the detail page show a small badge when
`renewal_decision` is set (`Renewing` green / `Canceling` red / `Negotiating` amber),
with a clear-decision control on the detail page only.

**Empty state:** `Nothing needs action.` plus, when any future decision point exists,
`Next up: {name} — {kind sentence}, {date} ({N} days)`.

## 3. Home layout order

1. No-delivery-channel banner (existing, unchanged)
2. Triage queue / empty state
3. Horizon timeline — new section `components/dashboard/horizon-timeline.tsx`: a
   single horizontal 12-month band (now → +12mo), one row per active contract with a
   marker at its decision date, colored by urgency, name label left. Reuses the
   date/formatting helpers of `components/RenewalTimeline.tsx` where practical; if the
   existing component already renders this shape, adapt rather than rewrite. Contracts
   beyond 12 months are omitted; section hidden when nothing to show.
4. Contract table (existing `contract-list.tsx`) with the spend stat in its header
5. Slim upload strip (de-promoted upload zone)

## 4. iCal feed

- **`lib/ical.ts` (pure, unit-tested):** `buildCalendar(contracts) => string` producing
  RFC 5545 VCALENDAR text: for each active contract, all-day VEVENTs for expiry
  (`SUMMARY: {name} expires`), notice deadline (`{name} — notice deadline`), and
  renewal date when distinct. Stable `UID: {contractId}-{kind}@openrenew`. Correct
  CRLF line endings and 75-octet line folding for long summaries; `PRODID`/`VERSION`
  headers; dates as `DTSTART;VALUE=DATE:YYYYMMDD`.
- **Route `GET /api/calendar/feed.ics?token=<hex>`:** no cookie auth (calendar apps
  can't); validates token against `app_settings` key `ical_token` with constant-time
  compare; 404 on mismatch or when no token exists. Response
  `Content-Type: text/calendar; charset=utf-8`.
- **Settings page:** "Calendar feed" section — on first render, generates and stores
  the token (`crypto.randomBytes(32).toString("hex")`) if absent; shows the full URL
  (`{APP_URL}/api/calendar/feed.ics?token=…`) with a copy button and a "Regenerate"
  button (`POST /api/settings/ical-token`, admin-only, replaces token and invalidates
  the old URL).

## 5. Rename sweep (finish Renewl → OpenRenew)

- Delete stale SaaS-era docs: `docs/renewl_project_handoff.md`,
  `docs/renewly_build_bible.md`, and ALL `docs/superpowers/plans/*` and
  `docs/superpowers/specs/*` dated before 2026-07 (they describe the shelved SaaS).
  Keep the 2026-07-15 conversion spec/plan and this spec.
- `python-service/generate_test_contract.py`: fixture company "Renewly Ltd" → a neutral
  fictional name ("Meridian Software Ltd").
- Remove `.claude/settings.local.json` from git (add `.claude/settings.local.json` to
  `.gitignore`).
- After all changes: `grep -ri renewl` across the repo (excluding node_modules,
  DECISIONS.md, and the 2026-07 docs which reference the old name as history) must be
  empty.

## Error handling

- Decision API: 401 unauth, 404 unknown contract, 400 invalid body.
- Feed route: 404 for bad/missing token (no information leak), 200 with empty calendar
  when no contracts.
- Triage derivation: contracts with malformed/missing dates are skipped, never throw.

## Testing

- `__tests__/lib/triage.test.ts`: notice-deadline preference, 30-day window edge,
  overdue ordering, snooze exclusion, decision exclusion, no-dates exclusion.
- `__tests__/lib/ical.test.ts`: VEVENT per date kind, stable UIDs, DATE format,
  CRLF/folding, empty input → valid empty calendar.
- Route tests: decision API (auth/validation/effects), feed token (valid/invalid/
  missing).
- Existing 131 jest + 54 pytest stay green. Browser smoke test of the new home screen
  (queue item actions, empty state, feed URL in Settings) before finishing.
