# Week 3 Design Spec — Alerts + Edit Contract

**Date:** 2026-03-21
**Scope:** Vercel Cron daily alert delivery via Resend (rich email) + edit/re-open confirmed contracts
**Deferred:** Slack webhook UI (Week 4), Stripe payments (Week 4)

---

## 1. Overview

Week 3 completes the core value loop: confirmed contracts already have pre-generated `alerts` rows (from `/api/confirm`). This week the cron job reads those rows daily and sends rich HTML emails. Users who receive an alert can click through, edit the contract if needed, and re-confirm to regenerate alerts with corrected dates.

---

## 2. New Environment Variables

| Variable | Where set | Purpose |
|----------|-----------|---------|
| `CRON_SECRET` | Vercel env vars | Bearer token — Vercel sends automatically, guards cron route from public access |
| `RESEND_API_KEY` | Vercel env vars | Resend API key for sending email |
| `APP_URL` | Vercel env vars | Base URL e.g. `https://renewl.app` — server-only (no `NEXT_PUBLIC_` prefix) — used for CTA links in emails |

---

## 3. Database Migration

One migration needed before any code runs:

```sql
-- Make user_id nullable in activity_log for system/cron events that have no user session
ALTER TABLE public.activity_log ALTER COLUMN user_id DROP NOT NULL;
```

**Pre-existing schema (already shipped in Week 2 migration `20260322000000_review_ui_schema.sql`):**
- `alerts.target_date DATE NOT NULL` — added in Week 2
- `alerts_alert_type_check` — updated to include `'notice_deadline'` in Week 2
- `alerts_contract_alert_target_unique` unique constraint on `(contract_id, alert_type, target_date)` — added in Week 2

No further `alerts` or `contracts` schema changes needed. `alerts.status` already has `'skipped'`, `contracts.status` already allows `'review'`.

**Note on `activity_log` RLS:** The existing RLS policy `USING (user_id = auth.uid())` naturally handles nullable `user_id` — `NULL = auth.uid()` evaluates to `NULL` (not `TRUE`), so system/cron rows are invisible to all users. The cron route uses `adminClient` (service role) which bypasses RLS, so the insert works correctly.

---

## 4. Cron Job — `/api/cron/send-alerts`

### 4.1 Vercel Cron Registration

`vercel.json` at repo root:

```json
{
  "crons": [
    { "path": "/api/cron/send-alerts", "schedule": "0 8 * * *" }
  ]
}
```

Fires daily at 08:00 UTC. Vercel automatically sends `Authorization: Bearer {CRON_SECRET}` with each invocation.

### 4.2 Route: `app/api/cron/send-alerts/route.ts`

**Step 1 — Auth guard (first thing, before any DB access):**

```typescript
// Startup assertions: fail loudly if required env vars are missing
if (!process.env.CRON_SECRET) {
  console.error('CRON_SECRET is not set — cron route is unprotected');
  return new Response('Server misconfiguration', { status: 500 });
}
if (!process.env.APP_URL) {
  console.error('APP_URL is not set — email CTA links will be broken');
  return new Response('Server misconfiguration', { status: 500 });
}
const authHeader = request.headers.get('authorization');
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return new Response('Unauthorized', { status: 401 });
}
```

**Step 2 — Query due alerts (single join, LIMIT 100):**

Using the Supabase admin client (service role — bypasses RLS, required for cross-user cron query). Note: `profiles.email` is set at signup and not updated if the user later changes their auth email — v1 limitation, fix in v2 by reading from `auth.users` via admin client.

```sql
SELECT
  a.id, a.alert_type, a.scheduled_for, a.target_date,
  a.contract_id, a.user_id,
  c.name, c.expiry_date, c.renewal_date, c.auto_renew,
  c.counterparty_name, c.contract_value, c.notice_period_days,
  p.email
FROM alerts a
JOIN contracts c ON c.id = a.contract_id
JOIN profiles p ON p.id = a.user_id
WHERE a.scheduled_for <= CURRENT_DATE
  AND a.status = 'pending'
LIMIT 100
```

The `LIMIT 100` is a safety ceiling for v1 — prevents runaway sends if alert rows accumulate due to a bug. Well above any realistic daily volume at MVP scale.

**Step 3 — Send concurrently via `Promise.allSettled`:**

```typescript
const results = await Promise.allSettled(
  alerts.map(alert => sendAlertEmail(alert))
);
```

`Promise.allSettled` (not `Promise.all`) — one Resend failure does not abort the rest. Each result is `{ status: 'fulfilled' }` or `{ status: 'rejected', reason }`.

**Step 4 — Mark each alert sent or skipped:**

For fulfilled results → `UPDATE alerts SET status = 'sent', sent_at = now() WHERE id = ?`
For rejected results → `UPDATE alerts SET status = 'skipped' WHERE id = ?` + `console.error`

Use individual updates (not a single bulk update) so a DB error on one row doesn't affect others.

**Step 5 — activity_log insert (no user_id — system event):**

```typescript
await adminClient.from('activity_log').insert({
  user_id: null,  // system/cron event — user_id is nullable after migration
  event_type: 'cron_alerts_sent',
  metadata: { sent: sentCount, skipped: skippedCount, date: today },
});
```

**Step 6 — Return summary:**

```typescript
return NextResponse.json({ sent: sentCount, skipped: skippedCount });
```

Vercel surfaces this in the cron execution logs.

---

## 5. Email Templates — `lib/email.ts`

### 5.1 Export

```typescript
export function buildAlertEmail(alert: AlertWithContext): { subject: string; html: string }
```

`AlertWithContext` includes all fields from the cron query join.

### 5.2 Subject Lines

The verb depends on `auto_renew`:
- `auto_renew = true` → **"renews on {date}"**
- `auto_renew = false` or `null` → **"expires on {date}"**

| Alert type | Subject |
|------------|---------|
| `day_60` | `⏰ 60 days: {contract name} {renews/expires} on {date}` |
| `day_30` | `⚠️ 30 days: {contract name} {renews/expires} on {date}` |
| `day_7` | `🔴 7 days: {contract name} {renews/expires} on {date}` |
| `notice_deadline` | `📋 Action required: {contract name} notice deadline in 7 days` |

### 5.3 Email HTML Structure

All built as a string in TypeScript — no Resend template IDs, no external template engine.

```
┌─────────────────────────────────────┐
│  Renewl                            │  ← text wordmark, no image
├─────────────────────────────────────┤
│  [URGENCY BANNER]                   │  ← colored by alert type
│  "60 days" / "30 days" / "7 days"  │    60d: green, 30d: amber, 7d/notice: red
├─────────────────────────────────────┤
│  Headline                           │
│  "Your {name} {renews/expires}      │  ← auto_renew verb logic here too
│   in {N} days"                      │
├─────────────────────────────────────┤
│  Detail grid (omit null rows):      │
│  Counterparty  │ Acme Corp          │
│  Date          │ 2026-12-31         │
│  Contract value│ £12,000/yr         │
│  Notice period │ 30 days            │
│                                     │
│  [notice_deadline only]:            │
│  ⚠ You must act by: 2026-12-01     │  ← deadline date, prominent
│  Refers to expiry: 2026-12-31       │
├─────────────────────────────────────┤
│  [View contract →]                  │  ← CTA button
│  {APP_URL}/dashboard/review/{id}    │
├─────────────────────────────────────┤
│  Sent by Renewl · Manage alerts    │  ← footer
│  (Manage alerts links to /dashboard │
│   // TODO Week 4: /dashboard/settings)
└─────────────────────────────────────┘
```

### 5.4 Urgency Colors

| Alert type | Banner color | Hex |
|------------|-------------|-----|
| `day_60` | Green | `#16a34a` |
| `day_30` | Amber | `#d97706` |
| `day_7` | Red | `#dc2626` |
| `notice_deadline` | Red | `#dc2626` |

### 5.5 Resend Call (in cron route)

```typescript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'Renewl <alerts@renewl.app>',
  to: alert.email,
  subject: email.subject,
  html: email.html,
});
```

The `from` address requires a verified domain in Resend.

---

## 6. Edit / Re-open Confirmed Contract

### 6.1 Entry Points

Two ways a user can re-open a confirmed contract:

1. **Dashboard card** — "Edit" link on the confirmed `<ContractCard />` → navigates to `/dashboard/review/{id}?reopen=1`
2. **Review page read-only banner** — "Edit contract" button in the confirmed banner (useful for users arriving via email CTA link) → same `?reopen=1` URL

### 6.2 ContractCard — Confirmed State

Add a small secondary "Edit" link alongside the days-left display:

```tsx
<Link href={`/dashboard/review/${id}?reopen=1`}
  className="text-xs text-slate-400 hover:text-slate-600 underline">
  Edit
</Link>
```

### 6.3 Review Page Server Component

The page component must declare `searchParams` in its props — it is not available automatically in Next.js App Router. Updated signature:

```typescript
type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reopen?: string }>;
};

export default async function ReviewPage({ params, searchParams }: Params) {
  const { id: contractId } = await params;
  const { reopen } = await searchParams;
  // ...
}
```

When `reopen === '1'` AND `contract.status === 'confirmed'`, update the contract **directly via the Supabase server client** (not via an internal API route — that would add an unnecessary HTTP round trip). The `contract.status === 'confirmed'` guard is the primary idempotency check: a second render after the first write finds `status = 'review'` and skips the update. **v1 limitation:** two near-simultaneous renders (e.g. React prefetch + navigation) can both read `confirmed` before either write lands, producing two `contract_reopened` activity_log rows. The UPDATE itself is idempotent (setting `'review'` twice is harmless). The duplicate log entry is cosmetic and not user-visible — acceptable for v1.

```typescript
// Server component — direct DB update, no HTTP round trip
if (reopen === '1' && contract.status === 'confirmed') {
  await supabase
    .from('contracts')
    .update({ status: 'review', updated_at: new Date().toISOString() })
    .eq('id', contractId)
    .eq('user_id', user.id); // RLS + explicit ownership check

  await supabase.from('activity_log').insert({
    user_id: user.id,
    contract_id: contractId,
    event_type: 'contract_reopened',
    metadata: { contract_id: contractId, source: 'review_page' },
  });

  contract.status = 'review'; // update local var so ReviewClient gets live form
}
```

The `ReviewClient` receives `status: 'review'` → `isReadOnly = false` → form renders instead of read-only view.

### 6.4 `/api/reopen` Route

For the client-side "Edit" button on `<ContractCard />` — that click happens in the browser and needs an API route. The review page navigates to a URL; the card could do the same (`?reopen=1`), so `/api/reopen` is only needed if a card-level Edit button triggers a fetch rather than a navigation.

**Simplest implementation:** make the card "Edit" link a `<Link href="...?reopen=1">` navigation (same as the banner button). This means **no `/api/reopen` route needed** — both entry points use URL navigation, and the server component handles the DB update on render.

### 6.5 Alerts Behavior on Reopen

Alerts are **not touched on reopen**. `pending` alerts remain pending. When the user re-confirms via the existing `/api/confirm` route, it upserts alerts with `ON CONFLICT (contract_id, alert_type, target_date) DO NOTHING` — so unchanged alerts are preserved, and new alerts (e.g., for a corrected expiry date) are inserted.

The `/api/confirm` 409 guard checks `status = 'confirmed'`. After reopen, status is `'review'` → confirm proceeds normally. No change to `/api/confirm`.

### 6.6 Read-only View Update

The confirmed banner in `<ReviewClient />` gains an "Edit contract" button:

```tsx
{isReadOnly && (
  <div className="rounded-xl bg-green-50 border border-green-200 p-4 mb-5">
    <strong>This contract has been confirmed.</strong> Alerts are active.{" "}
    <Link href={`/dashboard/review/${contract.id}?reopen=1`}
      className="underline">Edit contract</Link>
    {" · "}
    <Link href="/dashboard" className="underline">Back to contracts</Link>
  </div>
)}
```

---

## 7. File Changes Summary

| Action | Path | Purpose |
|--------|------|---------|
| Create | `vercel.json` | Register Vercel Cron job |
| Create | `supabase/migrations/20260322000001_activity_log_nullable_user.sql` | Drop NOT NULL on activity_log.user_id |
| Create | `app/api/cron/send-alerts/route.ts` | Cron handler — query, send, mark sent/skipped |
| Create | `lib/email.ts` | `buildAlertEmail()` — rich HTML email builder |
| Modify | `components/dashboard/contract-card.tsx` | Add "Edit" link on confirmed state |
| Modify | `app/(dashboard)/dashboard/review/[id]/page.tsx` | Add `searchParams: Promise<{ reopen?: string }>` to `Params` type and component destructuring (currently absent); handle `?reopen=1` — direct Supabase update + activity_log |
| Modify | `components/review/review-client.tsx` | Add "Edit contract" link in read-only banner |

---

## 8. Testing

### Unit tests

- `lib/email.ts` — `buildAlertEmail()`:
  - `auto_renew = true` → subject contains "renews on"
  - `auto_renew = false` → subject contains "expires on"
  - `auto_renew = null` → subject contains "expires on"
  - `notice_deadline` → subject contains "Action required"
  - Null fields (`counterparty_name`, `contract_value`) → rows omitted from detail grid
  - `notice_deadline` → shows "You must act by" and target_date

### API route tests (`__tests__/api/send-alerts.test.ts`)

- Returns 500 when `CRON_SECRET` missing (misconfiguration, not auth failure)
- Returns 401 when `CRON_SECRET` wrong
- Sends emails for due alerts, marks `sent`
- Marks `skipped` when Resend throws
- Returns `{ sent, skipped }` summary
- Does not send alerts with `scheduled_for > today`
- Does not send already-`sent` alerts

---

## 9. Error Handling

| Failure | Behaviour |
|---------|-----------|
| Resend API error on one email | Mark that alert `skipped`, log error, continue sending others |
| Resend API key missing | Route throws at Resend client init → all alerts remain `pending`, cron logs error |
| DB query fails | Return 500, no alerts sent, all remain `pending` (retry next day) |
| `APP_URL` missing | CTA link in email is broken — `undefined/dashboard/review/...` — catch with startup check |
| Reopen: contract not owned by user | `.eq('user_id', user.id)` on update returns 0 rows affected — silent no-op (RLS protects data) |
