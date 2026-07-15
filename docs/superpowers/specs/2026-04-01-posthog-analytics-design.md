# PostHog Analytics Integration — Design

**Date:** 2026-04-01
**Status:** Approved

---

## Overview

Add PostHog product analytics alongside the existing Google Analytics setup. The integration uses a three-layer architecture: client SDK init, unified client event tracking through the existing analytics module, and server-side event capture via the Node SDK in route handlers.

---

## Architecture

### Layer 1 — Client initialisation

Two new components, both placed in `app/layout.tsx`:

**`components/PostHogProvider.tsx`** — `'use client'` wrapper that initialises `posthog-js` once on mount. Config:
- `capture_pageview: false` (manual pageviews prevent double-counting in App Router)
- `persistence: 'localStorage'`
- Reads `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` from env

**`components/PostHogPageView.tsx`** — `'use client'` component that fires `$pageview` on route change via `usePathname` + `useEffect`. `useSearchParams()` is wrapped in a `Suspense` boundary so pages that don't use search params are not forced into dynamic rendering (preserves the static landing page — Decision 009).

`app/layout.tsx` wraps its body content in `<PostHogProvider>` and renders `<PostHogPageView />` inside it. The root layout stays a server component.

### Layer 2 — Unified client event tracking

`lib/analytics.ts` is extended selectively, not via a blanket change to `trackEvent()`. This avoids double-counting PostHog events for actions that are also captured server-side with richer properties.

**Changed methods:**
- `Analytics.upgradeClicked()` — adds a `posthog.capture('upgrade_clicked', { current_plan })` call alongside the existing GA event. This event has no server-side equivalent.

**New PostHog-only methods added to `Analytics`:**
- `Analytics.analysisViewed(contractId)` — fires `posthog.capture('analysis_viewed', { contract_id })` only; no GA equivalent.

**Unchanged methods:** `contractUploaded`, `contractConfirmed`, `waitlistSignup`, `templateDownload`, `accountCreated` — these remain GA-only on the client. `contract_uploaded` and `contract_confirmed` are captured server-side with richer properties; firing them from the client too would create duplicate funnel entries in PostHog.

No existing call-sites change. The two new methods are called from their respective components.

### Layer 3 — Server-side event capture

**`lib/posthog.ts`** — exports a singleton `posthogClient` (PostHog Node SDK) and a `shutdownPosthog()` helper. The shutdown helper uses `Promise.race()` with a 2-second ceiling:

```ts
export async function shutdownPosthog() {
  await Promise.race([
    posthogClient.shutdown(),
    new Promise(resolve => setTimeout(resolve, 2000)),
  ])
}
```

This is required because Vercel functions close immediately after the response returns. The 2-second ceiling is critical on `/api/confirm`, which has a load-bearing `maxDuration = 60` (Decision 010) — a bare `await posthogClient.shutdown()` could push the total function time over the limit under slow network conditions.

Route handlers call `posthogClient.capture()` then `await shutdownPosthog()` before returning their response.

---

## User Identification

`components/dashboard/dashboard-nav.tsx` is a `'use client'` component. Its `DashboardNavProps` interface is extended to include `userId: string` and `userCreatedAt: string` alongside the existing `userEmail: string`. The parent server component(s) that render `DashboardNav` are updated to pass those fields from the Supabase session.

A `useEffect` in `DashboardNav` calls:

```ts
posthog.identify(userId, { email: userEmail, created_at: userCreatedAt })
```

when `userId` is available. No new components, no extra client-side auth fetches.

---

## Environment Variables

Added to `.env.local` (not committed) and `.env.example` (with placeholders):

```
NEXT_PUBLIC_POSTHOG_KEY=phc_your_key_here
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

---

## Events

### Client events (via `lib/analytics.ts` — PostHog only)

| Analytics method | PostHog event name | Properties |
|---|---|---|
| `Analytics.upgradeClicked()` | `upgrade_clicked` | `current_plan` |
| `Analytics.analysisViewed(contractId)` | `analysis_viewed` | `contract_id` |

### Server events (via `lib/posthog.ts` Node SDK)

| Event name | Route handler | Properties |
|---|---|---|
| `contract_uploaded` | `/api/upload` | `contract_id`, `file_size_kb` |
| `extraction_completed` | `/api/extract` | `contract_id`, `confidence`, `duration_ms` |
| `extraction_failed` | `/api/extract` | `contract_id`, `error_type` |
| `contract_confirmed` | `/api/confirm` | `contract_id` |
| `contract_deleted` | `/api/contracts/[id]` DELETE | `contract_id` |
| `alert_email_sent` | `/api/cron/send-alerts` | `alert_type`, `days_until_expiry` |

Server events use the authenticated user's Supabase ID as `distinct_id`. For the cron handler, the `user_id` is available from the alert join.

### What is NOT captured

- Contract text, extracted field values, or any document content
- PII beyond email (set via `identify`, not `capture`)
- Full names, counterparty names, or any financial amounts

---

## Constraints Respected

- **No Tailwind** — no UI components added; no class names touched (Decision 004)
- **No `setInterval`** — `PostHogPageView` uses `useEffect`, not polling (Decision 020)
- **Static landing page preserved** — `Suspense` on `useSearchParams` prevents dynamic rendering (Decision 009)
- **`maxDuration = 60` safe** — `Promise.race()` with 2s ceiling on `/api/confirm` shutdown (Decision 010)
- **Fonts via CSS variables only** — no new UI, non-applicable (Decision 017)
- **No hardcoded keys** — all via `NEXT_PUBLIC_POSTHOG_*` env vars
- **`posthog-node` and `posthog-js` only** — no conflicting analytics packages added

---

## Files Changed / Created

| File | Action |
|---|---|
| `package.json` | add `posthog-js`, `posthog-node` |
| `.env.example` | add `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` |
| `lib/posthog.ts` | create — Node SDK singleton + `shutdownPosthog()` |
| `lib/analytics.ts` | extend — add PostHog capture alongside GA in `trackEvent()` and new methods |
| `components/PostHogProvider.tsx` | create |
| `components/PostHogPageView.tsx` | create |
| `app/layout.tsx` | add PostHogProvider + PostHogPageView |
| `components/dashboard/dashboard-nav.tsx` | extend props + add identify useEffect |
| `app/api/upload/route.ts` | add server-side `contract_uploaded` capture |
| `app/api/extract/route.ts` | add `extraction_completed` / `extraction_failed` captures |
| `app/api/confirm/route.ts` | add `contract_confirmed` capture + `Promise.race` shutdown |
| `app/api/cron/send-alerts/route.ts` | add `alert_email_sent` capture per alert |
| `components/contracts/ContractIntelligencePanel.tsx` | add `Analytics.analysisViewed()` call |
| `app/api/contracts/[id]/route.ts` | add server-side `contract_deleted` capture |

---

## Verification Criteria

1. `npm run build` outputs `○ /` (static) for the landing page
2. `npm run lint` passes with no new errors
3. No TypeScript errors on new or modified files
4. Network tab shows events posting to the PostHog host on navigation and contract upload
5. PostHog dashboard shows identified users with `email` and `created_at` properties
