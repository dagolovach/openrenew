# Renewal Timeline Dashboard — Design Spec

**Date:** 2026-04-07
**Status:** Approved

## Overview

Replace the `ContractList` on the dashboard with a `RenewalTimeline` component that visualises contract expiry as horizontal bars. Add an urgency stats row above it. Keep "Needs review" for draft/processing contracts, positioned above the timeline so users see in-progress uploads immediately.

## Final Dashboard Layout (main content area, top to bottom)

1. DashboardMetrics *(unchanged)*
2. UploadZone *(unchanged)*
3. **Urgency stats row** — 4 cards, active contracts only
4. **"Needs review" section** — draft / processing / party_review contracts only; hidden when empty
5. **RenewalTimeline** — active contracts only, sorted by expiry_date ASC nulls last

## Data Flow

`contracts-feed.tsx` keeps its single existing Supabase query. No new query added. The select list gains `currency` (needed by `TimelineContract`). After fetching, contracts are split into two buckets:

- `activeContracts` — `status === 'active'`, not expired → fed to urgency stats + RenewalTimeline
- `needsReviewContracts` — `status` in `draft | processing | analyzing | party_review` → fed to the "Needs review" section

`contracts-feed.tsx` renders all three sections in order.

## Component: `components/RenewalTimeline.tsx`

`"use client"` component. Props-only — no Supabase, no data fetching.

### Props

```tsx
interface TimelineContract {
  id: string
  name: string
  party_a: string | null
  party_b: string | null
  expiry_date: string | null
  notice_period_days: number | null
  annual_value: number | null
  currency: string | null
}

export function RenewalTimeline({ contracts }: { contracts: TimelineContract[] })
```

### Computed values per contract

```tsx
const today = new Date()
const expiry = new Date(contract.expiry_date)
const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / 86400000)
const daysUntilNotice = contract.notice_period_days
  ? daysUntilExpiry - contract.notice_period_days
  : null
const barWidth = `${Math.min(Math.max(daysUntilExpiry / 365, 0), 1) * 100}%`
const noticeTickLeft = daysUntilNotice !== null
  ? `${Math.min(Math.max(daysUntilNotice / 365, 0), 1) * 100}%`
  : null

const urgency = daysUntilExpiry <= 30 ? 'red'
  : daysUntilExpiry <= 90 || (daysUntilNotice !== null && daysUntilNotice <= 60) ? 'amber'
  : 'green'
```

### Urgency colour tokens

| Urgency | Bar       | Pill bg   | Pill text | Pill border |
|---------|-----------|-----------|-----------|-------------|
| red     | `#EF4444` | `#1F0A0A` | `#EF4444` | `#3B1010`   |
| amber   | `#F59E0B` | `#1A1200` | `#F59E0B` | `#3B2800`   |
| green   | `#10B981` | `#051A12` | `#10B981` | `#0A3D26`   |

### Layout

**Legend row** (above card): dots for red/amber/green urgency + amber tick for notice deadline.

**Card**: `background #111827`, `border 0.5px solid #1F2937`, `borderRadius 12px`

**Column header row**: CONTRACT | TIMELINE | STATUS — 10px, `#374151`, uppercase

**Contract rows**: grid `200px 1fr 110px`, `padding 14px 20px`, `border-bottom 0.5px solid #1F2937` (last row: none)

Each row wrapped in `<Link href="/contracts/{id}">` with `textDecoration none`. Hover: `background #0F1929` on mouseEnter, `transparent` on mouseLeave. `useState` per row index for hover tracking.

**Left column:**
- Name: 13px, weight 500, `#F9FAFB`
- Parties: `party_a ↔ party_b`, 11px, `#4B5563`
- Annual value: 11px, `#4B5563` — `$Xk` if ≥ 1000, else `$X`; omit if null

**Middle column (bar track):**
- Track: `background #1F2937`, `borderRadius 3px`, `height 8px`, `position relative`
- Fill: absolute, `left 0 top 0`, `height 8px`, `borderRadius 3px`, width = barWidth, background = urgency colour
- Notice tick (if present): absolute, `top -4px`, `width 2px`, `height 16px`, `borderRadius 1px`, `background #F59E0B`, `left = noticeTickLeft`
- Below track: flex space-between, 10px, expiry date left / notice deadline right. Colour: red if ≤ 30d, amber if ≤ 60d, else `#374151`

**Right column (days badge):**
- Pill: `display inline-flex`, `alignItems center`, `gap 5px`, `fontSize 12px`, `fontWeight 500`, `padding 4px 10px`, `borderRadius 20px`, `border 0.5px solid`
- Dot: `width 6px`, `height 6px`, `borderRadius 50%`
- Shows `● N days` using urgency colours
- No expiry_date → show `—` in `#4B5563`

**Empty state** (no active contracts):
```
No active contracts yet — upload a PDF above to get started
padding 32px, textAlign center, color #4B5563, fontSize 13
```

## Urgency Stats Row

Four cards inline between UploadZone and "Needs review". Values computed from `activeContracts`.

| Label | Value | Colour |
|-------|-------|--------|
| Total contracts | `contracts.length` | `#6B7280` |
| Expiring in 30 days | count where daysUntilExpiry ≤ 30 | `#EF4444` if > 0, else `#6B7280` |
| Notice deadline soon | count where daysUntilNotice ≤ 60 | `#F59E0B` if > 0, else `#6B7280` |
| Total annual value | sum of annual_value, `$Xk` / `$XM` | `#10B981` |

Card style: `background #111827`, `borderRadius 10px`, `border 0.5px solid #1F2937`, `padding 14px 16px`

Label: 11px, `#4B5563`, uppercase, `letterSpacing .05em`, `var(--font-inter)`
Value: 22px, weight 500, `var(--font-jetbrains)`

Grid: `repeat(4, 1fr)`, `gap 12px`, `marginBottom 20px`

## "Needs review" Section

Rendered only when `needsReviewContracts.length > 0`. No empty state — collapses completely when empty.

Pass `needsReviewContracts` to the existing `<ContractList>` component (unchanged). Because `ContractList` only renders sections that have matching contracts, passing only draft/processing/party_review contracts causes it to naturally show just the "Needs review" section. Its polling loop for processing/analyzing contracts continues to work unchanged.

## Sorting

`RenewalTimeline` sorts its own `contracts` prop client-side: `expiry_date ASC`, nulls last. No change to how `contracts-feed.tsx` orders the query.

## Constraints

- Inline styles only — zero Tailwind classes (Decision 004)
- `var(--font-jetbrains)` for numbers, `var(--font-inter)` for labels
- No `setInterval` — not needed here
- No new Supabase query — existing query in `contracts-feed.tsx` extended with `currency` field only
- Do not touch: DashboardMetrics, UploadZone, DashboardNav, page.tsx
