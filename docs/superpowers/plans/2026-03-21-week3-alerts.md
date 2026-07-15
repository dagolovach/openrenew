## Status

**Last verified:** 2026-03-24
**Build status:** Completed (with one deferred item)

Daily email alerts via Vercel Cron + Resend are live. Alert pre-generation on confirm is live. Edit/re-open of confirmed contracts is implemented.

**Deferred:**
- Slack alert delivery: `slack_webhook_url` is stored in profiles and the plan included it, but actual sending via Slack is not yet wired in the cron job. Only email delivery is active.

---

# Week 3 — Alerts + Edit Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver daily email alerts via Vercel Cron + Resend, and allow users to edit/re-open confirmed contracts.

**Architecture:** A Vercel Cron job fires daily at 08:00 UTC, queries `alerts` rows due today, sends rich HTML emails via Resend, and marks each alert `sent` or `skipped`. Edit/reopen is handled by a `?reopen=1` URL parameter on the review page — the server component detects it, updates the contract status to `review` directly in Supabase (no extra API route), and the form renders in edit mode.

**Tech Stack:** Next.js App Router (server components, API route), Supabase (service role admin client), Resend SDK, Vercel Cron, TypeScript

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/20260322000001_activity_log_nullable_user.sql` | Drop NOT NULL on `activity_log.user_id` for cron/system events |
| Create | `vercel.json` | Register Vercel Cron job at `0 8 * * *` |
| Create | `lib/email.ts` | `buildAlertEmail()` — pure function, HTML string builder |
| Create | `__tests__/lib/email.test.ts` | Unit tests for `buildAlertEmail()` |
| Create | `app/api/cron/send-alerts/route.ts` | Cron handler: auth guard, query, send, mark sent/skipped |
| Create | `__tests__/api/send-alerts.test.ts` | API route tests |
| Modify | `components/dashboard/contract-card.tsx` | Add "Edit" link on confirmed state |
| Modify | `app/(dashboard)/dashboard/review/[id]/page.tsx` | Add `searchParams` prop + `?reopen=1` handling |
| Modify | `components/review/review-client.tsx` | Add "Edit contract" link in read-only banner |

---

## Task 1: Database Migration — Nullable `user_id` in `activity_log`

The cron job inserts an `activity_log` row with no user session. `user_id` must be nullable.

**Files:**
- Create: `supabase/migrations/20260322000001_activity_log_nullable_user.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260322000001_activity_log_nullable_user.sql
-- Make user_id nullable in activity_log for system/cron events that have no user session.
-- RLS note: NULL = auth.uid() evaluates to NULL (not TRUE), so system rows are invisible
-- to regular users. The cron route uses adminClient (service role) which bypasses RLS.
ALTER TABLE public.activity_log ALTER COLUMN user_id DROP NOT NULL;
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```

Expected: migration applied successfully, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260322000001_activity_log_nullable_user.sql
git commit -m "feat: make activity_log.user_id nullable for cron/system events"
```

---

## Task 2: Vercel Cron Registration

Tell Vercel to invoke `/api/cron/send-alerts` daily at 08:00 UTC.

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Check if `vercel.json` already exists**

```bash
ls vercel.json 2>/dev/null && echo "exists" || echo "not found"
```

- [ ] **Step 2: Create `vercel.json`**

If it doesn't exist, create it. If it does exist, read it first and merge the `crons` key without removing any existing content.

```json
{
  "crons": [
    { "path": "/api/cron/send-alerts", "schedule": "0 8 * * *" }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: register daily cron job for send-alerts"
```

---

## Task 3: Email Builder — `lib/email.ts`

Pure function that takes an alert + contract context and returns `{ subject, html }`. No side effects, no Resend calls — testable in isolation.

**Files:**
- Create: `lib/email.ts`
- Create: `__tests__/lib/email.test.ts`

### 3a: Write failing tests first (TDD)

- [ ] **Step 1: Create test file**

```typescript
// __tests__/lib/email.test.ts
import { buildAlertEmail } from '@/lib/email';

const base = {
  id: 'alert-1',
  contract_id: 'contract-1',
  user_id: 'user-1',
  alert_type: 'day_60' as const,
  scheduled_for: '2026-06-01',
  target_date: '2026-07-31',
  name: 'Acme SaaS Agreement',
  expiry_date: '2026-07-31',
  renewal_date: null,
  auto_renew: false,
  counterparty_name: 'Acme Corp',
  contract_value: '£12,000/yr',
  notice_period_days: 30,
  email: 'user@example.com',
};

describe('buildAlertEmail', () => {
  it('auto_renew=true → subject contains "renews on"', () => {
    const { subject } = buildAlertEmail({ ...base, auto_renew: true });
    expect(subject).toContain('renews on');
  });

  it('auto_renew=false → subject contains "expires on"', () => {
    const { subject } = buildAlertEmail({ ...base, auto_renew: false });
    expect(subject).toContain('expires on');
  });

  it('auto_renew=null → subject contains "expires on"', () => {
    const { subject } = buildAlertEmail({ ...base, auto_renew: null });
    expect(subject).toContain('expires on');
  });

  it('notice_deadline → subject contains "Action required"', () => {
    const { subject } = buildAlertEmail({ ...base, alert_type: 'notice_deadline' });
    expect(subject).toContain('Action required');
  });

  it('day_60 → subject starts with ⏰ 60 days:', () => {
    const { subject } = buildAlertEmail({ ...base, alert_type: 'day_60' });
    expect(subject).toMatch(/^⏰ 60 days:/);
  });

  it('day_30 → subject starts with ⚠️ 30 days:', () => {
    const { subject } = buildAlertEmail({ ...base, alert_type: 'day_30' });
    expect(subject).toMatch(/^⚠️ 30 days:/);
  });

  it('day_7 → subject starts with 🔴 7 days:', () => {
    const { subject } = buildAlertEmail({ ...base, alert_type: 'day_7' });
    expect(subject).toMatch(/^🔴 7 days:/);
  });

  it('null counterparty_name → row omitted from HTML', () => {
    const { html } = buildAlertEmail({ ...base, counterparty_name: null });
    expect(html).not.toContain('Counterparty');
  });

  it('null contract_value → row omitted from HTML', () => {
    const { html } = buildAlertEmail({ ...base, contract_value: null });
    expect(html).not.toContain('Contract value');
  });

  it('notice_deadline → HTML shows "You must act by"', () => {
    const { html } = buildAlertEmail({
      ...base,
      alert_type: 'notice_deadline',
      target_date: '2026-07-01',
    });
    expect(html).toContain('You must act by');
    expect(html).toContain('2026-07-01');
  });

  it('CTA link includes contract_id', () => {
    const { html } = buildAlertEmail({ ...base });
    expect(html).toContain('/dashboard/review/contract-1');
  });

  it('returns valid html string', () => {
    const { html } = buildAlertEmail({ ...base });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Renewl');
  });
});
```

- [ ] **Step 2: Run tests — expect failures (module not found)**

```bash
npx jest __tests__/lib/email.test.ts --no-coverage
```

Expected: `Cannot find module '@/lib/email'`

### 3b: Implement `lib/email.ts`

- [ ] **Step 3: Create `lib/email.ts`**

```typescript
// lib/email.ts

export type AlertType = 'day_60' | 'day_30' | 'day_7' | 'notice_deadline';

export type AlertWithContext = {
  id: string;
  contract_id: string;
  user_id: string;
  alert_type: AlertType;
  scheduled_for: string;
  target_date: string;
  name: string;
  expiry_date: string | null;
  renewal_date: string | null;
  auto_renew: boolean | null;
  counterparty_name: string | null;
  contract_value: string | null;
  notice_period_days: number | null;
  email: string;
};

const URGENCY_COLOR: Record<AlertType, string> = {
  day_60: '#16a34a',
  day_30: '#d97706',
  day_7: '#dc2626',
  notice_deadline: '#dc2626',
};

const DAYS_LABEL: Record<AlertType, string> = {
  day_60: '60 days',
  day_30: '30 days',
  day_7: '7 days',
  notice_deadline: 'Notice deadline',
};

function verb(autoRenew: boolean | null): string {
  return autoRenew === true ? 'renews on' : 'expires on';
}

export function buildAlertEmail(alert: AlertWithContext): { subject: string; html: string } {
  const appUrl = process.env.APP_URL ?? '';
  const ctaUrl = `${appUrl}/dashboard/review/${alert.contract_id}`;
  const relevantDate = alert.expiry_date ?? alert.renewal_date ?? alert.target_date;
  const v = verb(alert.auto_renew);

  // Subject
  let subject: string;
  if (alert.alert_type === 'notice_deadline') {
    subject = `📋 Action required: ${alert.name} notice deadline in 7 days`;
  } else {
    const emoji = alert.alert_type === 'day_60' ? '⏰' : alert.alert_type === 'day_30' ? '⚠️' : '🔴';
    const days = DAYS_LABEL[alert.alert_type];
    subject = `${emoji} ${days}: ${alert.name} ${v} ${relevantDate}`;
  }

  // Detail grid rows (omit null values)
  const rows: Array<[string, string]> = [];
  if (alert.counterparty_name) rows.push(['Counterparty', alert.counterparty_name]);
  rows.push(['Date', relevantDate]);
  if (alert.contract_value) rows.push(['Contract value', alert.contract_value]);
  if (alert.notice_period_days != null) rows.push(['Notice period', `${alert.notice_period_days} days`]);

  const detailRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap;">${label}</td>
        <td style="padding:6px 0;font-size:14px;color:#111827;">${value}</td>
      </tr>`
    )
    .join('');

  const noticeBlock =
    alert.alert_type === 'notice_deadline'
      ? `<p style="margin:16px 0 0;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:#991b1b;font-size:14px;">
           <strong>⚠ You must act by: ${alert.target_date}</strong><br/>
           <span style="color:#6b7280;">Refers to expiry: ${alert.expiry_date ?? 'N/A'}</span>
         </p>`
      : '';

  const bannerColor = URGENCY_COLOR[alert.alert_type];
  const headline =
    alert.alert_type === 'notice_deadline'
      ? `Notice deadline for ${alert.name} in 7 days`
      : `Your ${alert.name} ${v} ${relevantDate}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <!-- Header -->
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
            <span style="font-size:18px;font-weight:700;color:#111827;letter-spacing:-0.5px;">Renewl</span>
          </td>
        </tr>
        <!-- Urgency banner -->
        <tr>
          <td style="background:${bannerColor};padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;">
            ${DAYS_LABEL[alert.alert_type]}
          </td>
        </tr>
        <!-- Headline -->
        <tr>
          <td style="padding:24px 24px 0;">
            <h1 style="margin:0;font-size:20px;font-weight:700;color:#111827;line-height:1.3;">${headline}</h1>
          </td>
        </tr>
        <!-- Detail grid -->
        <tr>
          <td style="padding:16px 24px 0;">
            <table cellpadding="0" cellspacing="0">${detailRows}</table>
            ${noticeBlock}
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td style="padding:24px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">View contract →</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              Sent by Renewl ·
              <a href="${appUrl}/dashboard" style="color:#6b7280;">Manage alerts</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
npx jest __tests__/lib/email.test.ts --no-coverage
```

Expected: all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/email.ts __tests__/lib/email.test.ts
git commit -m "feat: add buildAlertEmail() with rich HTML templates and unit tests"
```

---

## Task 4: Cron Route — `/api/cron/send-alerts`

**Files:**
- Create: `app/api/cron/send-alerts/route.ts`
- Create: `__tests__/api/send-alerts.test.ts`

### 4a: Write failing tests first

- [ ] **Step 1: Create test file**

Check how existing API route tests are structured first:

```bash
ls __tests__/api/
```

Then create the test file. The pattern used in the codebase for API route testing mocks `@/lib/supabase/admin`, `resend`, and process.env.

```typescript
// __tests__/api/send-alerts.test.ts
import { NextRequest } from 'next/server';

// ── Mocks ───────────────────────────────────────────────
const mockSelect = jest.fn();
const mockUpdate = jest.fn();
const mockInsert = jest.fn();

// Build mock Supabase chain: .from(...).select(...).lte(...).eq(...).limit(...)
const mockChain = {
  select: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  limit: jest.fn(),
  update: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
};
mockChain.limit.mockResolvedValue({ data: [], error: null });

const mockFrom = jest.fn(() => mockChain);

jest.mock('@/lib/supabase/admin', () => ({
  adminClient: { from: mockFrom },
}));

const mockResendSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}));

// ── Import route AFTER mocks ────────────────────────────
import { GET } from '@/app/api/cron/send-alerts/route';

const CRON_SECRET = 'test-secret';

function makeRequest(authHeader?: string) {
  return new NextRequest('http://localhost/api/cron/send-alerts', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

const sampleAlert = {
  id: 'alert-1',
  alert_type: 'day_30',
  scheduled_for: '2026-03-21',
  target_date: '2026-04-20',
  contract_id: 'contract-1',
  user_id: 'user-1',
  name: 'Acme SaaS',
  expiry_date: '2026-04-20',
  renewal_date: null,
  auto_renew: false,
  counterparty_name: 'Acme Corp',
  contract_value: '£12,000/yr',
  notice_period_days: 30,
  email: 'user@example.com',
};

describe('GET /api/cron/send-alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.APP_URL = 'https://renewl.app';

    // Default: no due alerts
    mockChain.limit.mockResolvedValue({ data: [], error: null });
    // Default: update returns no error
    mockChain.update.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    // Default: insert returns no error
    mockChain.insert.mockResolvedValue({ error: null });
  });

  it('returns 500 when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });

  it('returns 500 when APP_URL is missing', async () => {
    delete process.env.APP_URL;
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
  });

  it('returns 401 when Authorization header is wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns { sent: 0, skipped: 0 } when no due alerts', async () => {
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: 0, skipped: 0 });
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it('sends emails for due alerts and marks them sent', async () => {
    mockChain.limit.mockResolvedValue({ data: [sampleAlert], error: null });
    mockResendSend.mockResolvedValue({ id: 'email-1' });

    // Mock update chain for marking sent
    const mockEq = jest.fn().mockResolvedValue({ error: null });
    mockChain.update.mockReturnValue({ eq: mockEq });

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.skipped).toBe(0);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  it('marks alert skipped when Resend throws', async () => {
    mockChain.limit.mockResolvedValue({ data: [sampleAlert], error: null });
    mockResendSend.mockRejectedValue(new Error('Resend unavailable'));

    const mockEq = jest.fn().mockResolvedValue({ error: null });
    mockChain.update.mockReturnValue({ eq: mockEq });

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('returns 500 when DB query fails', async () => {
    mockChain.limit.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests — expect failures (module not found)**

```bash
npx jest __tests__/api/send-alerts.test.ts --no-coverage
```

Expected: `Cannot find module '@/app/api/cron/send-alerts/route'`

### 4b: Implement the cron route

- [ ] **Step 3: Check that `lib/supabase/admin.ts` exists and exports `adminClient`**

```bash
cat lib/supabase/admin.ts
```

The cron route imports `adminClient` from `@/lib/supabase/admin`. Verify the export name matches — if the file uses a different export, adjust the import in the route accordingly.

- [ ] **Step 4: Create the cron route directory and file**

```bash
mkdir -p app/api/cron/send-alerts
```

```typescript
// app/api/cron/send-alerts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/supabase/admin';
import { buildAlertEmail, AlertWithContext } from '@/lib/email';

export async function GET(request: NextRequest) {
  // ── Startup assertions ─────────────────────────────────
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET is not set — cron route is unprotected');
    return new Response('Server misconfiguration', { status: 500 });
  }
  if (!process.env.APP_URL) {
    console.error('APP_URL is not set — email CTA links will be broken');
    return new Response('Server misconfiguration', { status: 500 });
  }

  // ── Auth guard ─────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ── Query due alerts ───────────────────────────────────
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const { data: alerts, error: queryError } = await adminClient
    .from('alerts')
    .select(`
      id, alert_type, scheduled_for, target_date,
      contract_id, user_id,
      contracts!inner ( name, expiry_date, renewal_date, auto_renew, counterparty_name, contract_value, notice_period_days ),
      profiles!inner ( email )
    `)
    .lte('scheduled_for', today)
    .eq('status', 'pending')
    .limit(100);

  if (queryError || !alerts) {
    console.error('Cron: failed to query alerts', queryError);
    return new Response('Internal Server Error', { status: 500 });
  }

  if (alerts.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  // ── Flatten join rows ──────────────────────────────────
  const alertsWithContext: AlertWithContext[] = alerts.map((a: any) => ({
    id: a.id,
    alert_type: a.alert_type,
    scheduled_for: a.scheduled_for,
    target_date: a.target_date,
    contract_id: a.contract_id,
    user_id: a.user_id,
    name: a.contracts.name,
    expiry_date: a.contracts.expiry_date,
    renewal_date: a.contracts.renewal_date,
    auto_renew: a.contracts.auto_renew,
    counterparty_name: a.contracts.counterparty_name,
    contract_value: a.contracts.contract_value,
    notice_period_days: a.contracts.notice_period_days,
    email: a.profiles.email,
  }));

  // ── Send emails concurrently ───────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY);

  const results = await Promise.allSettled(
    alertsWithContext.map(async (alert) => {
      const email = buildAlertEmail(alert);
      await resend.emails.send({
        from: 'Renewl <alerts@renewl.app>',
        to: alert.email,
        subject: email.subject,
        html: email.html,
      });
      return alert.id;
    })
  );

  // ── Mark sent / skipped ────────────────────────────────
  let sentCount = 0;
  let skippedCount = 0;

  await Promise.all(
    results.map(async (result, i) => {
      const alertId = alertsWithContext[i].id;
      if (result.status === 'fulfilled') {
        sentCount++;
        const { error } = await adminClient
          .from('alerts')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', alertId);
        if (error) console.error(`Cron: failed to mark alert ${alertId} sent`, error);
      } else {
        skippedCount++;
        console.error(`Cron: failed to send alert ${alertId}`, result.reason);
        const { error } = await adminClient
          .from('alerts')
          .update({ status: 'skipped' })
          .eq('id', alertId);
        if (error) console.error(`Cron: failed to mark alert ${alertId} skipped`, error);
      }
    })
  );

  // ── Activity log ───────────────────────────────────────
  await adminClient.from('activity_log').insert({
    user_id: null,
    event_type: 'cron_alerts_sent',
    metadata: { sent: sentCount, skipped: skippedCount, date: today },
  });

  return NextResponse.json({ sent: sentCount, skipped: skippedCount });
}
```

- [ ] **Step 5: Run tests — expect all to pass**

```bash
npx jest __tests__/api/send-alerts.test.ts --no-coverage
```

Expected: all tests pass.

**Note on mock structure:** The Supabase join query in the route uses `!inner` foreign key syntax. In tests, the mock resolves the flat `sampleAlert` shape directly (already flattened). This is fine — the mock bypasses the actual Supabase client. If any test fails due to the join flattening logic, adjust the `sampleAlert` shape in the test to include nested `contracts` and `profiles` objects and update the mock accordingly.

- [ ] **Step 6: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass (including existing week 1/2 tests).

- [ ] **Step 7: Commit**

```bash
git add app/api/cron/send-alerts/route.ts __tests__/api/send-alerts.test.ts
git commit -m "feat: add /api/cron/send-alerts with Resend email sending and tests"
```

---

## Task 5: Edit/Reopen — ContractCard "Edit" Link

Add a small secondary "Edit" link to confirmed contract cards so users can navigate directly to the edit flow.

**Files:**
- Modify: `components/dashboard/contract-card.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat components/dashboard/contract-card.tsx
```

Understand the current confirmed-state rendering (look for where `daysLeft` / urgency badge is rendered).

- [ ] **Step 2: Add the Edit link**

Import `Link` from `next/link` at the top of the file if not already imported.

In the confirmed-state JSX, alongside (or below) the days-left display, add:

```tsx
import Link from 'next/link';

// Inside the confirmed card render, after the days-left / urgency display:
<Link
  href={`/dashboard/review/${id}?reopen=1`}
  className="text-xs text-slate-400 hover:text-slate-600 underline"
>
  Edit
</Link>
```

The `id` prop is already available in `ContractCard` — do not add a new prop. Match the existing component prop interface exactly.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/contract-card.tsx
git commit -m "feat: add Edit link to confirmed ContractCard"
```

---

## Task 6: Edit/Reopen — Review Page Server Component

The review page must read `searchParams` and, when `reopen=1` and contract is `confirmed`, update the status to `review` directly in Supabase.

**Files:**
- Modify: `app/(dashboard)/dashboard/review/[id]/page.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat "app/(dashboard)/dashboard/review/[id]/page.tsx"
```

Understand the current `Params` type and component signature. The file currently has `params: Promise<{ id: string }>` but NO `searchParams` — you will add it.

- [ ] **Step 2: Update `Params` type and destructure `searchParams`**

Change the `Params` type to include `searchParams`:

```typescript
type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reopen?: string }>;
};

export default async function ReviewPage({ params, searchParams }: Params) {
  const { id: contractId } = await params;
  const { reopen } = await searchParams;
  // ... rest of existing code
}
```

- [ ] **Step 3: Add reopen logic after contract is fetched**

After the contract is fetched from Supabase (and after the 404 check), add the reopen block. Use the **same** `supabase` client instance already in the file (it's the session client — RLS + user ownership is enforced by `.eq('user_id', user.id)`).

```typescript
// Direct DB update — no HTTP round trip needed from a server component
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

Place this block **after** `contract` is available and **before** it is passed to `<ReviewClient />`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/dashboard/review/[id]/page.tsx"
git commit -m "feat: handle ?reopen=1 in review page — revert confirmed contract to review status"
```

---

## Task 7: Edit/Reopen — "Edit contract" in Read-Only Banner

The confirmed read-only banner in `ReviewClient` needs an "Edit contract" link so users arriving via email CTA can also re-open.

**Files:**
- Modify: `components/review/review-client.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat components/review/review-client.tsx
```

Find the confirmed banner block (look for `isReadOnly` and the green banner).

- [ ] **Step 2: Add "Edit contract" link to the banner**

The banner currently shows "This contract has been confirmed. Alerts are active." and a "Back to contracts" link. Add an "Edit contract" link alongside it:

```tsx
{isReadOnly && (
  <div className="rounded-xl bg-green-50 border border-green-200 p-4 mb-5">
    <strong>This contract has been confirmed.</strong> Alerts are active.{" "}
    <Link href={`/dashboard/review/${contract.id}?reopen=1`} className="underline">
      Edit contract
    </Link>
    {" · "}
    <Link href="/dashboard" className="underline">Back to contracts</Link>
  </div>
)}
```

Import `Link` from `next/link` if not already imported.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/review/review-client.tsx
git commit -m "feat: add Edit contract link in read-only confirmed banner"
```

---

## Task 8: Environment Variables

The cron route requires `CRON_SECRET`, `RESEND_API_KEY`, and `APP_URL`.

**Files:**
- Modify: `.env.local` (local dev only — never commit)

- [ ] **Step 1: Check which env vars are already set**

```bash
grep -E 'CRON_SECRET|RESEND_API_KEY|APP_URL' .env.local 2>/dev/null || echo "not found"
```

- [ ] **Step 2: Add missing vars to `.env.local`**

Add any that are missing:

```bash
# Vercel Cron secret — must match what you set in Vercel dashboard
CRON_SECRET=your-random-secret-here

# Resend API key — get from https://resend.com/api-keys
RESEND_API_KEY=re_xxxx

# App base URL — server-only (no NEXT_PUBLIC_ prefix)
APP_URL=http://localhost:3000
```

`APP_URL` for local dev should be `http://localhost:3000`. For production, set it in Vercel env vars as `https://your-domain.com`.

- [ ] **Step 3: Verify `.env.local` is in `.gitignore`**

```bash
grep '.env.local' .gitignore
```

Expected: `.env.local` is listed. If not, add it.

- [ ] **Step 4: Note for Vercel deployment**

Add these three env vars in the Vercel dashboard under Settings → Environment Variables:
- `CRON_SECRET` — a random secret (e.g., `openssl rand -hex 32`)
- `RESEND_API_KEY` — from Resend dashboard
- `APP_URL` — your production URL (e.g., `https://renewl.app`)

No commit needed for this task (env vars are not committed).

---

## Task 9: Full Build + Test Verification

- [ ] **Step 1: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass (email tests + cron route tests + existing week 1/2 tests).

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Production build**

```bash
npm run build
```

Expected: build succeeds with no errors. Note: cron routes show as dynamic — this is expected.

- [ ] **Step 4: Smoke test locally**

```bash
npm run dev
```

1. Visit `http://localhost:3000/dashboard` — confirm contract list loads
2. Click a confirmed contract → read-only banner shows "Edit contract" link
3. Click "Edit contract" → page reloads in edit mode (form visible, not read-only)
4. Save changes → re-confirms, back to confirmed state
5. Check confirmed card → "Edit" link visible

To test the cron endpoint locally:

```bash
curl -H "Authorization: Bearer your-cron-secret" http://localhost:3000/api/cron/send-alerts
```

Expected: `{"sent":0,"skipped":0}` (or actual counts if due alerts exist).

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
git add -p  # stage any final fixes
git commit -m "fix: week 3 cleanup"
```

---

## Key Considerations

- **Cron auth guard order**: `CRON_SECRET` missing → 500 (misconfiguration). Wrong secret → 401. This order is intentional — fail loudly on misconfiguration.
- **`Promise.allSettled` not `Promise.all`**: one Resend failure must not abort the rest.
- **LIMIT 100**: safety ceiling for v1; prevents runaway sends from accumulated bug rows.
- **Server component direct DB write**: the review page updates Supabase directly — do not call your own API routes from server components.
- **`contract.status = 'review'` local update**: after the DB write, update the local `contract` variable so `ReviewClient` receives `status: 'review'` and renders in edit mode.
- **activity_log `user_id: null`**: only works after Task 1 migration is applied.
- **`profiles.email` staleness**: v1 limitation — email is set at signup, not updated if user changes auth email. Documented in spec.
- **Resend `from` domain**: `alerts@renewl.app` requires a verified domain in Resend. Until domain is verified, use Resend's sandbox or a verified sender address.
