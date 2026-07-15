# PostHog Analytics Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostHog product analytics alongside the existing GA setup using a three-layer architecture: client SDK init, unified client events via `lib/analytics.ts`, and server-side events via the Node SDK in route handlers.

**Architecture:** `PostHogProvider` / `PostHogPageView` handle SDK init and SPA pageviews in the root layout. `lib/analytics.ts` is extended to fire PostHog alongside GA for `upgradeClicked`, and a new `analysisViewed` method is added for client-only capture. Route handlers use a singleton Node SDK client (`lib/posthog.ts`) with a `Promise.race()`-guarded `shutdownPosthog()` to flush events within Vercel function lifetimes.

**Tech Stack:** `posthog-js` (client), `posthog-node` (server), Next.js 16 App Router, React 19, TypeScript

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `package.json` | modify | add posthog-js, posthog-node |
| `.env.example` | modify | document NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST |
| `lib/posthog.ts` | create | Node SDK singleton + shutdownPosthog() |
| `components/PostHogProvider.tsx` | create | client SDK init wrapper |
| `components/PostHogPageView.tsx` | create | SPA pageview capture via usePathname |
| `app/layout.tsx` | modify | wrap body with PostHogProvider, add PostHogPageView |
| `lib/analytics.ts` | modify | add PostHog to upgradeClicked; add analysisViewed method |
| `components/dashboard/dashboard-nav.tsx` | modify | add userId prop + posthog.identify useEffect |
| `app/(dashboard)/dashboard/page.tsx` | modify | pass user.id to DashboardNav |
| `app/(dashboard)/dashboard/calendar/page.tsx` | modify | pass user.id to DashboardNav |
| `app/api/upload/route.ts` | modify | capture contract_uploaded (server) |
| `app/api/extract/route.ts` | modify | capture extraction_completed / extraction_failed (server) |
| `app/api/confirm/route.ts` | modify | capture contract_confirmed (server) with Promise.race shutdown |
| `app/api/contracts/[id]/route.ts` | modify | capture contract_deleted (server) |
| `app/api/cron/send-alerts/route.ts` | modify | capture alert_email_sent per alert (server) |

---

## Task 1: Install packages and add environment variables

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install posthog-js and posthog-node**

```bash
npm install posthog-js posthog-node
```

Expected output: both packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Verify packages in package.json**

```bash
grep -E "posthog" package.json
```

Expected output:
```
"posthog-js": "^1.x.x",
"posthog-node": "^4.x.x",
```

- [ ] **Step 3: Add env vars to .env.example**

Open `.env.example`. Add after the existing `APP_URL` line:

```
# PostHog analytics
NEXT_PUBLIC_POSTHOG_KEY=phc_your_key_here
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

- [ ] **Step 4: Add env vars to .env.local**

Add the same two vars to `.env.local` with your real values (this file is gitignored):

```
NEXT_PUBLIC_POSTHOG_KEY=phc_your_actual_key
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: install posthog-js and posthog-node, document env vars"
```

---

## Task 2: Create lib/posthog.ts (Node SDK singleton)

**Files:**
- Create: `lib/posthog.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/posthog.ts
import { PostHog } from 'posthog-node'

let _client: PostHog | null = null

function getPostHogClient(): PostHog {
  if (!_client) {
    _client = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    })
  }
  return _client
}

export const posthogClient = {
  capture: (params: {
    distinctId: string
    event: string
    properties?: Record<string, unknown>
  }) => getPostHogClient().capture(params),
}

/**
 * Flush and shut down PostHog before returning a Vercel function response.
 * Races against a 2-second ceiling so a slow flush never extends the
 * function past its maxDuration budget (critical on /api/confirm which
 * has a load-bearing maxDuration = 60 — Decision 010).
 */
export async function shutdownPosthog(): Promise<void> {
  if (!_client) return
  await Promise.race([
    _client.shutdown(),
    new Promise<void>(resolve => setTimeout(resolve, 2000)),
  ])
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors on `lib/posthog.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/posthog.ts
git commit -m "feat: add posthog-node singleton with 2s-ceiling shutdown helper"
```

---

## Task 3: Create PostHogProvider and PostHogPageView components

**Files:**
- Create: `components/PostHogProvider.tsx`
- Create: `components/PostHogPageView.tsx`

- [ ] **Step 1: Create PostHogProvider.tsx**

```typescript
// components/PostHogProvider.tsx
'use client'

import posthog from 'posthog-js'
import { useEffect } from 'react'

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      capture_pageview: false,
      persistence: 'localStorage',
    })
  }, [])

  return <>{children}</>
}
```

We import `posthog` directly everywhere — no React context needed, so no `posthog-js/react` wrapper is required.

- [ ] **Step 2: Create PostHogPageView.tsx**

```typescript
// components/PostHogPageView.tsx
'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, Suspense } from 'react'
import posthog from 'posthog-js'

function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (pathname) {
      const url =
        searchParams.toString()
          ? `${pathname}?${searchParams.toString()}`
          : pathname
      posthog.capture('$pageview', { $current_url: url })
    }
  }, [pathname, searchParams])

  return null
}

export default function PostHogPageView() {
  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  )
}
```

The `Suspense` boundary is required by Next.js 16: `useSearchParams()` inside a client component without a boundary forces every parent route into dynamic rendering, which would break the static landing page (Decision 009).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors on the two new files.

- [ ] **Step 4: Commit**

```bash
git add components/PostHogProvider.tsx components/PostHogPageView.tsx
git commit -m "feat: add PostHogProvider and PostHogPageView client components"
```

---

## Task 4: Wire PostHog into app/layout.tsx

**Files:**
- Modify: `app/layout.tsx`

Current `<body>` content:
```tsx
<body className="min-h-full flex flex-col">
  {children}
  <Analytics />
  <SpeedInsights />
  {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
    <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
  )}
</body>
```

- [ ] **Step 1: Add imports to app/layout.tsx**

Add after the existing imports at the top of the file:

```typescript
import PostHogProvider from "@/components/PostHogProvider";
import PostHogPageView from "@/components/PostHogPageView";
```

- [ ] **Step 2: Wrap body children with PostHogProvider**

Replace the `<body>` block with:

```tsx
<body className="min-h-full flex flex-col">
  <PostHogProvider>
    {children}
    <PostHogPageView />
  </PostHogProvider>
  <Analytics />
  <SpeedInsights />
  {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
    <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />
  )}
</body>
```

`Analytics` and `SpeedInsights` stay outside `PostHogProvider` — they don't need PostHog context.

- [ ] **Step 3: Verify the landing page stays static**

```bash
npm run build 2>&1 | grep "○ /"
```

Expected output contains `○ /` (the `○` symbol indicates a static route). If you see `λ /` instead, the Suspense boundary in PostHogPageView is missing or broken — go back to Task 3 Step 2.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: wrap root layout with PostHogProvider, add PostHogPageView for SPA pageviews"
```

---

## Task 5: Extend lib/analytics.ts with PostHog

**Files:**
- Modify: `lib/analytics.ts`

Only `upgradeClicked` gets a PostHog call added (no server-side equivalent for this event). A new `analysisViewed` method is added (PostHog only, no GA equivalent). `contractUploaded` and `contractConfirmed` are intentionally left GA-only on the client — they are captured server-side with richer properties.

- [ ] **Step 1: Replace lib/analytics.ts**

```typescript
// lib/analytics.ts
import posthog from 'posthog-js'

type GTagEvent = {
  action: string
  category: string
  label?: string
  value?: number
}

declare global {
  interface Window {
    gtag: (
      command: 'event' | 'config' | 'set',
      targetId: string,
      params?: Record<string, unknown>
    ) => void
  }
}

export function trackEvent({ action, category, label, value }: GTagEvent) {
  if (typeof window === 'undefined') return
  if (!window.gtag) return

  window.gtag('event', action, {
    event_category: category,
    event_label: label,
    value,
  })
}

// Pre-defined events for consistency
export const Analytics = {
  waitlistSignup: (email?: string) =>
    trackEvent({
      action: 'waitlist_signup',
      category: 'conversion',
      label: email ? 'with_email' : 'unknown',
    }),

  templateDownload: () =>
    trackEvent({
      action: 'template_download',
      category: 'engagement',
      label: 'contract_renewal_tracker',
    }),

  accountCreated: () =>
    trackEvent({
      action: 'account_created',
      category: 'conversion',
      label: 'free_tier',
    }),

  contractUploaded: () =>
    trackEvent({
      action: 'contract_uploaded',
      category: 'engagement',
    }),

  contractConfirmed: () =>
    trackEvent({
      action: 'contract_confirmed',
      category: 'engagement',
    }),

  // Fires GA + PostHog. PostHog gets current_plan for funnel analysis.
  upgradeClicked: (currentPlan: string = 'free') => {
    trackEvent({
      action: 'upgrade_clicked',
      category: 'conversion',
      label: 'pro_plan',
    })
    posthog.capture('upgrade_clicked', { current_plan: currentPlan })
  },

  // PostHog only — no GA equivalent.
  analysisViewed: (contractId: string) => {
    posthog.capture('analysis_viewed', { contract_id: contractId })
  },
}
```

- [ ] **Step 2: Check existing upgradeClicked call-sites**

```bash
grep -rn "upgradeClicked\|Analytics.upgradeClicked" app/ components/ --include="*.tsx" --include="*.ts"
```

If any call passes no arguments, that's fine — `currentPlan` defaults to `'free'`. If any call already passes a plan string, verify it still compiles. No call-sites need updating for `analysisViewed` yet (it's added in Task 11).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/analytics.ts
git commit -m "feat: extend analytics.ts with PostHog for upgradeClicked, add analysisViewed method"
```

---

## Task 6: Add posthog.identify to DashboardNav

**Files:**
- Modify: `components/dashboard/dashboard-nav.tsx`
- Modify: `app/(dashboard)/dashboard/page.tsx`
- Modify: `app/(dashboard)/dashboard/calendar/page.tsx`

`getUserFromHeader()` returns `{ id: string, email: string }`. Both pages that render `DashboardNav` already call it and have `user.id` available. We extend the prop type to accept `userId` and call `posthog.identify` once on mount.

- [ ] **Step 1: Update DashboardNav component**

Replace `components/dashboard/dashboard-nav.tsx` with:

```typescript
"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import { Logo } from "@/components/ui/Logo";
import LogoutButton from "@/components/dashboard/logout-button";

interface DashboardNavProps {
  userEmail: string;
  userId: string;
}

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", exact: true },
  { href: "/dashboard/calendar", label: "Calendar", exact: false },
  { href: "/dashboard/settings", label: "Settings", exact: false },
];

export default function DashboardNav({ userEmail, userId }: DashboardNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 640) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  useEffect(() => {
    if (userId) {
      posthog.identify(userId, { email: userEmail });
    }
  }, [userId, userEmail]);

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <>
      <header className="dash-header">
        <div className="dash-header-inner">
          <Logo theme="dark" size="md" />

          {/* Desktop nav items */}
          <div className="dash-nav-desktop">
            {NAV_LINKS.map(({ href, label, exact }) => (
              <Link
                key={href}
                href={href}
                className="dash-nav-link"
                style={isActive(href, exact) ? { color: "#F9FAFB" } : undefined}
              >
                {label}
              </Link>
            ))}
            <span className="dash-nav-email">{userEmail}</span>
            <LogoutButton />
          </div>

          {/* Mobile hamburger */}
          <button
            className="dash-mobile-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <span className={`dash-hamburger ${menuOpen ? "open" : ""}`}>
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </header>

      {/* Mobile overlay */}
      {menuOpen && (
        <div className="dash-mobile-overlay" onClick={() => setMenuOpen(false)}>
          <div className="dash-mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="dash-mobile-email">{userEmail}</div>
            {NAV_LINKS.map(({ href, label, exact }) => (
              <Link
                key={href}
                href={href}
                className="dash-mobile-link"
                style={isActive(href, exact) ? { color: "#F9FAFB" } : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </Link>
            ))}
            <div className="dash-mobile-logout">
              <LogoutButton />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Update dashboard/page.tsx — pass user.id**

In `app/(dashboard)/dashboard/page.tsx`, change line 23 from:

```tsx
<DashboardNav userEmail={user.email ?? ""} />
```

to:

```tsx
<DashboardNav userEmail={user.email ?? ""} userId={user.id} />
```

- [ ] **Step 3: Update calendar/page.tsx — pass user.id**

In `app/(dashboard)/dashboard/calendar/page.tsx`, change the `<DashboardNav>` line from:

```tsx
<DashboardNav userEmail={user.email ?? ''} />
```

to:

```tsx
<DashboardNav userEmail={user.email ?? ''} userId={user.id} />
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/dashboard-nav.tsx \
        app/\(dashboard\)/dashboard/page.tsx \
        app/\(dashboard\)/dashboard/calendar/page.tsx
git commit -m "feat: add posthog.identify to DashboardNav on user session mount"
```

---

## Task 7: Server-side capture in /api/upload

**Files:**
- Modify: `app/api/upload/route.ts`

Capture `contract_uploaded` with `contract_id` and `file_size_kb` just before returning the success response. Call `shutdownPosthog()` before returning. If PostHog fails, log the error but do not fail the upload.

- [ ] **Step 1: Add import to upload/route.ts**

Add after the existing imports:

```typescript
import { posthogClient, shutdownPosthog } from "@/lib/posthog";
```

- [ ] **Step 2: Add capture before the final return**

Find the final `return NextResponse.json(...)` at the bottom of the `POST` function (line ~157):

```typescript
return NextResponse.json({ contract_id: contractId, detected_parties: detectedParties });
```

Replace it with:

```typescript
try {
  posthogClient.capture({
    distinctId: user.id,
    event: 'contract_uploaded',
    properties: {
      contract_id: contractId,
      file_size_kb: Math.round(file.size / 1024),
    },
  })
  await shutdownPosthog()
} catch (e) {
  console.error('[upload] PostHog capture failed:', e)
}

return NextResponse.json({ contract_id: contractId, detected_parties: detectedParties });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/api/upload/route.ts
git commit -m "feat: capture contract_uploaded to PostHog in /api/upload"
```

---

## Task 8: Server-side capture in /api/extract

**Files:**
- Modify: `app/api/extract/route.ts`

Capture `extraction_completed` or `extraction_failed` depending on the result. Record `duration_ms` by capturing the start time at the top of the handler. Call `shutdownPosthog()` before each return path.

- [ ] **Step 1: Add import to extract/route.ts**

Add after the existing imports:

```typescript
import { posthogClient, shutdownPosthog } from "@/lib/posthog";
```

- [ ] **Step 2: Add start time capture at top of POST handler**

After the rate limit check and before the contract fetch, add:

```typescript
const extractionStart = Date.now()
```

Place it immediately after line 35 (`if (!rateLimitOk) { ... }`).

- [ ] **Step 3: Add capture before the failed return**

Find the failed return at the bottom of the handler:

```typescript
if (failed) {
  return NextResponse.json({ status: "manual", message: statusMessage });
}
```

Replace with:

```typescript
if (failed) {
  try {
    posthogClient.capture({
      distinctId: user.id,
      event: 'extraction_failed',
      properties: {
        contract_id,
        error_type: (extractionResult.error as string) ?? 'unknown',
      },
    })
    await shutdownPosthog()
  } catch (e) {
    console.error('[extract] PostHog capture failed:', e)
  }
  return NextResponse.json({ status: "manual", message: statusMessage });
}
```

- [ ] **Step 4: Add capture before the success return**

Find the final success return:

```typescript
return NextResponse.json({
  status: "draft",
  contract_id,
  low_confidence: lowConfidence,
});
```

Replace with:

```typescript
try {
  posthogClient.capture({
    distinctId: user.id,
    event: 'extraction_completed',
    properties: {
      contract_id,
      confidence,
      duration_ms: Date.now() - extractionStart,
    },
  })
  await shutdownPosthog()
} catch (e) {
  console.error('[extract] PostHog capture failed:', e)
}

return NextResponse.json({
  status: "draft",
  contract_id,
  low_confidence: lowConfidence,
});
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add app/api/extract/route.ts
git commit -m "feat: capture extraction_completed/extraction_failed to PostHog in /api/extract"
```

---

## Task 9: Server-side capture in /api/confirm

**Files:**
- Modify: `app/api/confirm/route.ts`

Capture `contract_confirmed` with `contract_id`. Use `shutdownPosthog()` with its built-in `Promise.race` 2s ceiling. **Do not `await shutdownPosthog()` before `triggerAnalysis()`** — analysis must complete first (Decision 010). Call PostHog capture + shutdown after `triggerAnalysis` resolves and before the final `return`.

- [ ] **Step 1: Add import to confirm/route.ts**

Add after the existing imports:

```typescript
import { posthogClient, shutdownPosthog } from "@/lib/posthog";
```

- [ ] **Step 2: Add capture before the final return**

Find the final `return NextResponse.json({ ok: true })` at the bottom of the handler. Insert before it:

```typescript
try {
  posthogClient.capture({
    distinctId: userId,
    event: 'contract_confirmed',
    properties: { contract_id },
  })
  await shutdownPosthog()
} catch (e) {
  console.error('[confirm] PostHog capture failed:', e)
}
```

The full final block should look like:

```typescript
  // Mark parent contract as expired and skip its pending alerts
  if (contract.parent_contract_id) {
    await sessionClient
      .from("contracts")
      .update({ status: "renewed" })
      .eq("id", contract.parent_contract_id)
      .eq("user_id", userId);

    await sessionClient
      .from("alerts")
      .update({ status: "skipped" })
      .eq("contract_id", contract.parent_contract_id)
      .eq("user_id", userId)
      .eq("status", "pending");
  }

  try {
    posthogClient.capture({
      distinctId: userId,
      event: 'contract_confirmed',
      properties: { contract_id },
    })
    await shutdownPosthog()
  } catch (e) {
    console.error('[confirm] PostHog capture failed:', e)
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Confirm maxDuration is still present**

```bash
grep "maxDuration" app/api/confirm/route.ts
```

Expected output: `export const maxDuration = 60;` — do not remove this line.

- [ ] **Step 5: Commit**

```bash
git add app/api/confirm/route.ts
git commit -m "feat: capture contract_confirmed to PostHog in /api/confirm (after triggerAnalysis)"
```

---

## Task 10: Server-side capture in /api/contracts/[id]

**Files:**
- Modify: `app/api/contracts/[id]/route.ts`

Capture `contract_deleted` with `contract_id` before returning the 204 response. The DB delete has already cascaded at this point, so PostHog capture goes last.

- [ ] **Step 1: Add import**

Add after the existing imports:

```typescript
import { posthogClient, shutdownPosthog } from "@/lib/posthog";
```

- [ ] **Step 2: Add capture before the final return**

Find `return new Response(null, { status: 204 })` at the end of the DELETE handler. Insert before it:

```typescript
try {
  posthogClient.capture({
    distinctId: user.id,
    event: 'contract_deleted',
    properties: { contract_id: contractId },
  })
  await shutdownPosthog()
} catch (e) {
  console.error('[contracts/delete] PostHog capture failed:', e)
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add "app/api/contracts/[id]/route.ts"
git commit -m "feat: capture contract_deleted to PostHog in DELETE /api/contracts/[id]"
```

---

## Task 11: Server-side capture in /api/cron/send-alerts

**Files:**
- Modify: `app/api/cron/send-alerts/route.ts`

Capture `alert_email_sent` per successfully sent alert. The alert object has `alert_type` and `target_date`. Compute `days_until_expiry` from `target_date` relative to today. Batch all captures before the final `shutdownPosthog()`.

- [ ] **Step 1: Add import**

Add after the existing imports:

```typescript
import { posthogClient, shutdownPosthog } from "@/lib/posthog";
```

- [ ] **Step 2: Capture per successfully sent alert**

In the results processing block, find where `totalSent++` is called:

```typescript
if (result.status === 'fulfilled') {
  totalSent++;
  const { error } = await adminClient
    .from('alerts')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', alertId);
  if (error) console.error(`Cron: failed to mark alert ${alertId} sent`, error);
}
```

Replace with:

```typescript
if (result.status === 'fulfilled') {
  totalSent++;
  const { error } = await adminClient
    .from('alerts')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', alertId);
  if (error) console.error(`Cron: failed to mark alert ${alertId} sent`, error);

  const alert = alertsWithContext[i];
  const targetDate = alert.target_date ? new Date(alert.target_date) : null;
  const daysUntilExpiry = targetDate
    ? Math.ceil((targetDate.getTime() - new Date().getTime()) / 86400000)
    : null;
  posthogClient.capture({
    distinctId: alert.user_id,
    event: 'alert_email_sent',
    properties: {
      alert_type: alert.alert_type,
      days_until_expiry: daysUntilExpiry,
    },
  });
}
```

- [ ] **Step 3: Add shutdownPosthog before the final return**

Find the final `return NextResponse.json(...)` at the bottom of the GET handler:

```typescript
return NextResponse.json({ sent: totalSent, failed: totalFailed, total: totalProcessed });
```

Replace with:

```typescript
try {
  await shutdownPosthog()
} catch (e) {
  console.error('[cron/send-alerts] PostHog shutdown failed:', e)
}

return NextResponse.json({ sent: totalSent, failed: totalFailed, total: totalProcessed });
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/send-alerts/route.ts
git commit -m "feat: capture alert_email_sent per alert in /api/cron/send-alerts"
```

---

## Task 12: Add analysis_viewed capture to ContractIntelligencePanel

**Files:**
- Modify: `components/contracts/ContractIntelligencePanel.tsx`

The panel already receives `contractId` as a prop. Capture `analysis_viewed` via `Analytics.analysisViewed()` once when findings load successfully (status transitions to `"found"`).

- [ ] **Step 1: Add Analytics import**

At the top of `components/contracts/ContractIntelligencePanel.tsx`, add after the existing import:

```typescript
import { Analytics } from "@/lib/analytics";
```

- [ ] **Step 2: Add capture when findings load**

Find the block inside the polling `useEffect` where `setStatus` is set to `"found"` or `"empty"`:

```typescript
setFindings(sorted);
const hasWarnings = sorted.some((f) => f.type === "warning");
setIsOpen(hasWarnings);
setStatus(sorted.length > 0 ? "found" : "empty");
```

Replace with:

```typescript
setFindings(sorted);
const hasWarnings = sorted.some((f) => f.type === "warning");
setIsOpen(hasWarnings);
if (sorted.length > 0) {
  setStatus("found");
  Analytics.analysisViewed(contractId);
} else {
  setStatus("empty");
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/contracts/ContractIntelligencePanel.tsx
git commit -m "feat: capture analysis_viewed in ContractIntelligencePanel when findings load"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run the full build**

```bash
npm run build
```

Expected: build completes with no errors.

- [ ] **Step 2: Confirm landing page is static**

```bash
npm run build 2>&1 | grep "○ /"
```

Expected: `○ /` appears in the output (static route, not `λ`).

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no new errors or warnings.

- [ ] **Step 4: Smoke test in browser**

```bash
npm run dev
```

1. Open `http://localhost:3000` — landing page loads (no console errors)
2. Open DevTools → Network → filter by `posthog`
3. Navigate to `/dashboard` — verify a `$pageview` request appears in the Network tab posting to your PostHog host
4. Upload a contract — verify `contract_uploaded` appears in Network tab after upload completes
5. Open PostHog dashboard → People — verify the signed-in user appears with `email` property set

- [ ] **Step 5: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "fix: lint fixes after PostHog integration"
```

Only run this step if Step 3 produced errors that required fixes.
