# Contract Detail Page Redesign

**Date:** 2026-03-25
**Status:** Approved
**Scope:** `components/contracts/ContractDetailClient.tsx`, `components/contracts/AlertStatusRow.tsx`, `components/contracts/ProgressBar.tsx`

---

## Problem

The current contract detail page has five stacked equal-weight cards with no clear hierarchy:

1. Header (name + badges + Edit/Delete)
2. Parties card (Party A ↔ Party B centered layout)
3. Critical Dates & Countdown (live DD.HH.MM.SS clock + progress bar + date grid + auto-renew badge)
4. Alert Status (auto-renew flag + 60D/30D/7D dot trail)
5. Contract Intelligence Panel

This creates several compounding problems:
- The most critical information (notice deadline) is buried inside card 3 and not visible without scrolling
- The live seconds clock fires a re-render every second — the entire `CountdownDisplay` component exists solely to isolate this performance problem
- The parties card and alert status card occupy full-width sections for content that doesn't warrant it
- The Intelligence panel, the page's highest-value feature, is always below the fold and requires scrolling to reach
- Five cards of equal visual weight give the eye no clear starting point

---

## Design Decision

**Layout: Hero Header + Two-Column Body (Option C)**

Chosen over single-column (A) and two-column without hero (B) because:

- Option C surfaces the notice deadline as a first-class element in the first ~80px of the page — the most critical piece of information the page can show
- The large countdown number floats directly on the dark header background without a container, producing urgency through typography rather than decoration (Todoist principle)
- Pinning the Intelligence panel as a right-column sidebar means "Draft cancellation notice" is always visible on load without scrolling
- The hero band unifies name + parties + countdown + notice deadline into one logical thought before the body begins

---

## Final Layout

### Hero Header Band

A single full-width band with a 3px left urgency stripe (red/amber/green) and a subtle urgency-tinted background + border. Contains three rows:

**Row 1 — Name + actions**
- Contract name: Inter, 22px, weight 700, `#F9FAFB`
- Edit + Delete buttons: top-right, JetBrains Mono, 11px uppercase, muted until hover

**Row 2 — Parties (left) + Countdown (right)**
- `Party A ↔ Party B` in JetBrains Mono, 13px, `#9CA3AF`; arrow in `#374151`
- `{N} days` in JetBrains Mono, 52px, weight 700, urgency color (right-aligned)
- `Expires {date}` directly below the days number: JetBrains Mono, 13px, `#9CA3AF`, no uppercase tracking — reads as the second clause of "12 days until Expires 6 Apr 2025"

**Row 3 — Badges + notice deadline**
- CONFIRMED badge (green) · category badge (muted) · AUTO-RENEWS badge (amber, only if `auto_renew = true`)
- Notice deadline pill (red): `⚡ Notice deadline: {date} · {N} days away` — shown only when `notice_period_days` is set. Red background + border. This is the primary action trigger.

**Progress bar** — sits at the bottom of the band as its natural floor. Same gradient (green → amber → red) and today-marker dot as current implementation.

**Urgency coloring rules** (applied to stripe, background tint, border, countdown number, and notice pill):
- ≤ 30 days: `#EF4444` red, `rgba(239,68,68,0.05)` bg, `rgba(239,68,68,0.18)` border
- 31–60 days: `#F59E0B` amber, `rgba(245,158,11,0.05)` bg, `rgba(245,158,11,0.18)` border
- > 60 days: `#10B981` green, `rgba(16,185,129,0.05)` bg, `rgba(16,185,129,0.15)` border
- Expired: `#6B7280` gray, `rgba(255,255,255,0.03)` bg, `rgba(255,255,255,0.08)` border

### Two-Column Body

Grid: `1fr 280px`, gap 12px, `align-items: start`.

**Left column — Contract Details panel**
- Panel header: "CONTRACT DETAILS" label (JetBrains Mono, 10px uppercase, `#4B5563`)
- 3-column date grid: Effective Date · Expiry Date · Renewal Date / Notice Period · Notice Deadline · Contract Value
  - Expiry Date colored with urgency color
  - Notice Deadline colored amber (`#F59E0B`) when present
  - Missing fields are omitted (no empty cells)
- Panel footer: Auto-Renews badge (amber) + extraction confidence percentage (green mono) — both on one line, separated

**Right column — Contract Intelligence panel**
- Pinned sidebar, always visible on load
- Identical behavior to current `ContractIntelligencePanel` component (polling, findings sort, show/hide toggle, draft email actions, disclaimer)
- No layout changes to the panel internals

### Removed

- **Live countdown clock** (DD.HH.MM.SS at 44px, re-rendering every second) — replaced by static `{N} days`
- **`CountdownDisplay` component and `useCountdown` hook** — no longer needed
- **Parties card** — merged into hero row 2
- **Alert Status panel** (`AlertStatusRow` component call) — the notice deadline pill in the hero band covers the critical case; the 60D/30D/7D dot trail is engineer-readable but not user-readable and is removed

### Expired state

When `isExpired(contract)` is true:
- Hero band uses gray urgency color
- Countdown block shows "EXPIRED" in JetBrains Mono (36px, `#6B7280`) with the expiry date below it
- Notice pill is hidden
- Progress bar fills to 100% with gray fill
- Left column details grid still renders all available dates

---

## Component Changes

### `ContractDetailClient.tsx`

**Remove:**
- `useCountdown` hook and `Countdown` type
- `CountdownDisplay` component
- `pad()` helper
- `alertStatusLine` useMemo
- Import of `AlertStatusRow`

**Add:**
- `heroBandColors(contract)` helper — returns `{ stripe, bgTint, border, countdownColor }` based on days remaining
- `noticeDeadlineDaysLeft(contract)` helper — days until notice deadline (from expiry date)
- Hero band JSX (rows 1–3 + progress bar)
- Two-column body grid

**Keep:**
- `formatDate`, `formatDateLarge`, `urgencyColor`, `categoryLabel`, `noticeDeadlineDate` helpers (some may need minor adjustments)
- Delete confirmation flow (unchanged)
- `ContractIntelligencePanel` (unchanged, moved to right column)
- `ProgressBar` (unchanged, moved inside hero band)

### `AlertStatusRow.tsx`

No longer rendered from the detail page. File is kept (it may be used elsewhere or reused in future).

### `useCountdown` / `CountdownDisplay`

Deleted from `ContractDetailClient.tsx`. `CountdownDisplay` was a performance isolation workaround for the seconds ticker — no longer needed.

---

## Responsive behaviour

At ≤ 768px:
- Two-column body collapses to single column (Intelligence panel stacks below Details)
- Hero row 2 stacks vertically: parties above, countdown below (right-aligned → left-aligned)
- Hero row 3 wraps naturally (already uses `flex-wrap`)

At ≤ 480px:
- Date grid collapses from 3-column to 2-column

---

## What is NOT changing

- `ContractIntelligencePanel` internals (polling, findings, draft email, disclaimer)
- `ProgressBar` component
- Delete flow and confirmation UI
- Edit button routing (`/dashboard/review/{id}?reopen=1`)
- All API routes and data fetching (`page.tsx` unchanged)
- `AlertStatusRow.tsx` file (kept, just not rendered here)
