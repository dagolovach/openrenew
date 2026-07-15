# Immediate Redirect with "Analyzing" Status

**Date:** 2026-04-02
**Status:** Approved

## Problem

Clicking "Confirm & extract" on the review page causes a ~55s freeze with no visual feedback. The button appears unresponsive because `/api/confirm` awaits `triggerAnalysis()` (a Python AI call) before returning. The user is then redirected to dashboard with the contract already active.

## Goal

Redirect to dashboard immediately on confirm. Show an "Analyzing contract..." status on the dashboard card while analysis runs in background. Card resolves to active when analysis completes.

## Design

### 1. `/api/confirm/route.ts`

- After saving fields, alerts, and activity log: update contract status to `"analyzing"` (instead of `"active"`)
- Use Next.js `after()` to schedule background work post-response:
  - Call `triggerAnalysis(contract_id, userId)`
  - On success: update contract `status` to `"active"`
  - On failure: log error (contract stays `"analyzing"` — dashboard timeout will handle gracefully)
- Return `{ ok: true }` immediately
- Keep `export const maxDuration = 60` — required for `after()` lifetime on Vercel

### 2. `review-client.tsx`

No redirect logic changes needed. `handleConfirm` already redirects to `/dashboard` on success. Since the API now responds in ~1s instead of ~55s, the existing `isConfirming` spinner shows briefly before navigation.

### 3. `components/dashboard/contract-list.tsx`

- `getCardState()`: add case for `status === "analyzing"` → `{ type: "analyzing" }` (before the `party_review` check)
- Card renders spinner + label "Analyzing contract..." (same visual treatment as `"processing"`)
- `getSortPriority()`: `"analyzing"` → priority 5 (same as `"processing"` / `"party_review"`)
- Polling `useEffect`: extend filter to include `status === "analyzing"` alongside `status === "processing"`
- Polling query: add `"analyzing"` to the status filter on the Supabase `.in("id", pollIds)` call

## Status Flow

```
party_review → [user clicks Confirm & extract] → analyzing → [after() completes] → active
```

## Error Handling

- If `triggerAnalysis` fails inside `after()`: contract remains `"analyzing"`. The existing 90s client-side polling timeout in `contract-list.tsx` will eventually surface a fallback (currently times out to manual entry for `"processing"` — same behavior applies).
- If analysis fails silently, a future re-confirm or manual review handles recovery (existing pattern).

## What Is Not Changing

- `maxDuration = 60` stays on the confirm route
- No changes to the Python service
- No DB schema changes — `"analyzing"` is a new valid value for the existing `status` varchar column
- No changes to the extract/upload flow
