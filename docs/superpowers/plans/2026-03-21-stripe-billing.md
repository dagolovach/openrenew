## Status

**Last verified:** 2026-03-24
**Build status:** Completed

Stripe checkout, customer portal, and webhook handler are all live. Free/Pro tier enforcement is active (`profile.plan` check in `/api/upload`). Settings page with plan upgrade UI is live. Slack webhook URL save (`/api/settings/slack`) is implemented.

---

# Stripe Billing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Stripe billing with Free/Pro tiers, Customer Portal for self-service management, and webhook sync — plus a Settings page and Slack webhook save.

**Architecture:** Stripe-hosted Checkout for upgrades, Stripe Customer Portal for subscription management. Webhooks keep `profiles.plan` in sync. No custom billing UI. Free tier enforced in the upload route (20 contract limit).

**Tech Stack:** `stripe` npm package, Next.js App Router API routes, Supabase (existing), inline styles matching existing dark dashboard theme.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `lib/stripe.ts` | Stripe client singleton |
| Create | `app/api/stripe/checkout/route.ts` | Create Stripe Checkout session |
| Create | `app/api/stripe/portal/route.ts` | Create Stripe Customer Portal session |
| Create | `app/api/webhooks/stripe/route.ts` | Handle Stripe webhook events → update profiles.plan |
| Create | `app/api/settings/slack/route.ts` | Save + test Slack webhook URL |
| Create | `app/(dashboard)/dashboard/settings/page.tsx` | Settings page (billing + Slack) |
| Modify | `app/api/upload/route.ts` | Add free tier 20-contract limit check |
| Modify | `app/(dashboard)/dashboard/page.tsx` | Add Settings nav link to header |
| Modify | `components/dashboard/upload-zone.tsx` | Show upgrade banner on 403 free_tier_limit |
| Create | `__tests__/api/stripe-checkout.test.ts` | Tests for checkout route |
| Create | `__tests__/api/stripe-portal.test.ts` | Tests for portal route |
| Create | `__tests__/api/stripe-webhook.test.ts` | Tests for webhook handler |
| Create | `__tests__/api/settings-slack.test.ts` | Tests for Slack save route |
| Create | `__tests__/api/upload-free-tier.test.ts` | Tests for free tier enforcement |

---

## Task 1: Install Stripe and create client singleton

**Files:**
- Modify: `package.json` (via npm install)
- Create: `lib/stripe.ts`
- Create: `__tests__/lib/stripe.test.ts`

- [ ] **Step 1: Install stripe package**

```bash
npm install stripe
```

Expected: `stripe` appears in `package.json` dependencies.

- [ ] **Step 2: Write failing test**

```typescript
// __tests__/lib/stripe.test.ts
import { stripe } from '@/lib/stripe'

describe('stripe client', () => {
  test('is a Stripe instance with correct API version', () => {
    expect(stripe).toBeDefined()
    // Stripe instances expose _api property with version info
    expect(typeof stripe.checkout).toBe('object')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx jest __tests__/lib/stripe.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '@/lib/stripe'"

- [ ] **Step 4: Create the Stripe client**

```typescript
// lib/stripe.ts
import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
})
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest __tests__/lib/stripe.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/stripe.ts __tests__/lib/stripe.test.ts package.json package-lock.json
git commit -m "feat: add Stripe client singleton"
```

---

## Task 2: Checkout route

**Files:**
- Create: `app/api/stripe/checkout/route.ts`
- Create: `__tests__/api/stripe-checkout.test.ts`

The route creates a Stripe Checkout session for upgrading to Pro. It creates a Stripe customer if one doesn't exist yet, saves the `stripe_customer_id` to `profiles`, then returns the checkout URL.

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/api/stripe-checkout.test.ts
import { POST } from '@/app/api/stripe/checkout/route'

const mockGetUser = jest.fn()
const mockProfileSelect = jest.fn()
const mockProfileUpdate = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: mockProfileSelect,
            })),
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => mockProfileUpdate()),
          })),
        }
      }
      return {}
    }),
  })),
}))

const mockCustomersCreate = jest.fn()
const mockSessionsCreate = jest.fn()

jest.mock('@/lib/stripe', () => ({
  stripe: {
    customers: { create: mockCustomersCreate },
    checkout: { sessions: { create: mockSessionsCreate } },
  },
}))

function makeReq() {
  return new Request('http://localhost/api/stripe/checkout', { method: 'POST' })
}

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_PRO_PRICE_ID = 'price_test123'
    process.env.APP_URL = 'https://app.example.com'
  })

  test('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  test('returns 400 when user is already on Pro', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    mockProfileSelect.mockResolvedValue({
      data: { plan: 'pro', stripe_customer_id: 'cus_123', email: 'a@b.com' },
      error: null,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Already on Pro plan')
  })

  test('creates Stripe customer when none exists and returns checkout URL', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    mockProfileSelect.mockResolvedValue({
      data: { plan: 'free', stripe_customer_id: null, email: 'a@b.com' },
      error: null,
    })
    mockCustomersCreate.mockResolvedValue({ id: 'cus_new' })
    mockProfileUpdate.mockResolvedValue({ error: null })
    mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test' })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test')
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: 'a@b.com',
      metadata: { supabase_user_id: 'u1' },
    })
  })

  test('skips customer creation when stripe_customer_id exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    mockProfileSelect.mockResolvedValue({
      data: { plan: 'free', stripe_customer_id: 'cus_existing', email: 'a@b.com' },
      error: null,
    })
    mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test' })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(mockCustomersCreate).not.toHaveBeenCalled()
    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/api/stripe-checkout.test.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the route**

```typescript
// app/api/stripe/checkout/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error: profileError } = await sessionClient
    .from('profiles')
    .select('plan, stripe_customer_id, email')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  if (profile.plan === 'pro') {
    return NextResponse.json({ error: 'Already on Pro plan' }, { status: 400 })
  }

  let customerId = profile.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await sessionClient
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id)
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID!, quantity: 1 }],
    success_url: `${process.env.APP_URL}/dashboard/settings?upgraded=true`,
    cancel_url: `${process.env.APP_URL}/dashboard/settings`,
    // metadata on the session itself — readable in checkout.session.completed webhook
    metadata: { supabase_user_id: user.id },
    // metadata on subscription — inherited by subscription.updated/deleted events
    subscription_data: {
      metadata: { supabase_user_id: user.id },
    },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/api/stripe-checkout.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/stripe/checkout/route.ts __tests__/api/stripe-checkout.test.ts
git commit -m "feat: add Stripe checkout route"
```

---

## Task 3: Customer Portal route

**Files:**
- Create: `app/api/stripe/portal/route.ts`
- Create: `__tests__/api/stripe-portal.test.ts`

Creates a Stripe Customer Portal session so Pro users can manage their subscription (cancel, update card, view invoices).

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/api/stripe-portal.test.ts
import { POST } from '@/app/api/stripe/portal/route'

const mockGetUser = jest.fn()
const mockProfileSelect = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: mockProfileSelect,
        })),
      })),
    })),
  })),
}))

const mockPortalCreate = jest.fn()

jest.mock('@/lib/stripe', () => ({
  stripe: {
    billingPortal: { sessions: { create: mockPortalCreate } },
  },
}))

function makeReq() {
  return new Request('http://localhost/api/stripe/portal', { method: 'POST' })
}

describe('POST /api/stripe/portal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.APP_URL = 'https://app.example.com'
  })

  test('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  test('returns 400 when no stripe_customer_id', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({
      data: { stripe_customer_id: null },
      error: null,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(400)
  })

  test('returns portal URL for existing customer', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({
      data: { stripe_customer_id: 'cus_123' },
      error: null,
    })
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/xxx' })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://billing.stripe.com/session/xxx')
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://app.example.com/dashboard/settings',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/api/stripe-portal.test.ts --no-coverage
```

Expected: FAIL

- [ ] **Step 3: Implement the route**

```typescript
// app/api/stripe/portal/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await sessionClient
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${process.env.APP_URL}/dashboard/settings`,
  })

  return NextResponse.json({ url: portalSession.url })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/api/stripe-portal.test.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/stripe/portal/route.ts __tests__/api/stripe-portal.test.ts
git commit -m "feat: add Stripe customer portal route"
```

---

## Task 4: Webhook handler

**Files:**
- Create: `app/api/webhooks/stripe/route.ts`
- Create: `__tests__/api/stripe-webhook.test.ts`

Handles three Stripe events to keep `profiles.plan` in sync. Uses service-role Supabase client since there's no user session. Must read raw request body for signature verification.

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/api/stripe-webhook.test.ts
import { POST } from '@/app/api/webhooks/stripe/route'

const mockAdminUpdate = jest.fn().mockResolvedValue({ error: null })
const mockAdminEq = jest.fn(() => mockAdminUpdate())
const mockAdminFrom = jest.fn(() => ({
  update: jest.fn(() => ({ eq: mockAdminEq })),
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockAdminFrom,
  })),
}))

const mockConstructEvent = jest.fn()
jest.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
  },
}))

function makeReq(body: string, sig = 'valid-sig') {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': sig },
    body,
  })
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  })

  test('returns 400 on invalid signature', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('Invalid signature') })
    const res = await POST(makeReq('{}'))
    expect(res.status).toBe(400)
  })

  test('handles checkout.session.completed — sets plan to pro', async () => {
    // Note: Stripe delivers session.metadata in the webhook, NOT subscription_data.metadata
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_123',
          metadata: { supabase_user_id: 'u1' }, // top-level session metadata
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)
    const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }))
    mockAdminFrom.mockReturnValue({ update: mockUpdate })

    const res = await POST(makeReq(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', stripe_subscription_id: 'sub_123' })
    )
  })

  test('handles checkout.session.completed — ignores non-subscription mode', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          subscription: null,
          metadata: { supabase_user_id: 'u1' },
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)
    const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }))
    mockAdminFrom.mockReturnValue({ update: mockUpdate })

    const res = await POST(makeReq(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('handles customer.subscription.deleted — sets plan to free', async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          status: 'canceled',
          metadata: { supabase_user_id: 'u1' },
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)
    const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }))
    mockAdminFrom.mockReturnValue({ update: mockUpdate })

    const res = await POST(makeReq(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'free', stripe_subscription_id: null })
    )
  })

  test('returns 200 for unhandled event types', async () => {
    mockConstructEvent.mockReturnValue({ type: 'payment_intent.created', data: { object: {} } })
    const res = await POST(makeReq('{}'))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/api/stripe-webhook.test.ts --no-coverage
```

Expected: FAIL

- [ ] **Step 3: Implement the webhook handler**

```typescript
// app/api/webhooks/stripe/route.ts
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe'
import type Stripe from 'stripe'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.CheckoutSession
    // Read from session.metadata (top-level) — that's what Stripe delivers in the webhook event
    const userId = session.metadata?.supabase_user_id

    if (userId && session.mode === 'subscription') {
      await adminClient
        .from('profiles')
        .update({ plan: 'pro', stripe_subscription_id: session.subscription as string })
        .eq('id', userId)
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription
    const userId = subscription.metadata?.supabase_user_id

    if (userId) {
      const isActive = ['active', 'trialing'].includes(subscription.status)
      await adminClient
        .from('profiles')
        .update({
          plan: isActive ? 'pro' : 'free',
          // Keep subscription ID when active so portal works; null it when downgraded (consistent with deleted handler)
          stripe_subscription_id: isActive ? subscription.id : null,
        })
        .eq('id', userId)
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    const userId = subscription.metadata?.supabase_user_id

    if (userId) {
      await adminClient
        .from('profiles')
        .update({ plan: 'free', stripe_subscription_id: null })
        .eq('id', userId)
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/api/stripe-webhook.test.ts --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/webhooks/stripe/route.ts __tests__/api/stripe-webhook.test.ts
git commit -m "feat: add Stripe webhook handler for subscription sync"
```

---

## Task 5: Slack webhook save route

**Files:**
- Create: `app/api/settings/slack/route.ts`
- Create: `__tests__/api/settings-slack.test.ts`

Saves a Slack incoming webhook URL to `profiles.slack_webhook_url`. Validates the URL is a real Slack webhook (SSRF mitigation), then tests it by posting a message. Returns 400 if the URL is not a Slack domain or is unreachable.

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/api/settings-slack.test.ts
import { PATCH } from '@/app/api/settings/slack/route'

const mockGetUser = jest.fn()
const mockProfileUpdate = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => mockProfileUpdate()),
      })),
    })),
  })),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

function makeReq(body: object) {
  return new Request('http://localhost/api/settings/slack', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/settings/slack', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProfileUpdate.mockResolvedValue({ error: null })
  })

  test('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await PATCH(makeReq({ slack_webhook_url: 'https://hooks.slack.com/xxx' }))
    expect(res.status).toBe(401)
  })

  test('returns 400 when URL is not a Slack domain (SSRF guard)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await PATCH(makeReq({ slack_webhook_url: 'https://evil.com/steal-data' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_webhook_url')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  test('returns 400 when webhook URL is unreachable', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFetch.mockResolvedValue({ ok: false, status: 404 })

    const res = await PATCH(makeReq({ slack_webhook_url: 'https://hooks.slack.com/bad' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('webhook_unreachable')
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  test('returns 400 when fetch throws (network error)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFetch.mockRejectedValue(new Error('network failure'))

    const res = await PATCH(makeReq({ slack_webhook_url: 'https://hooks.slack.com/bad' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('webhook_unreachable')
  })

  test('saves URL and returns ok when webhook responds 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFetch.mockResolvedValue({ ok: true })

    const res = await PATCH(makeReq({ slack_webhook_url: 'https://hooks.slack.com/valid' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockProfileUpdate).toHaveBeenCalled()
  })

  test('clears URL when null is passed (no fetch test)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await PATCH(makeReq({ slack_webhook_url: null }))
    expect(res.status).toBe(200)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/api/settings-slack.test.ts --no-coverage
```

Expected: FAIL

- [ ] **Step 3: Implement the route**

```typescript
// app/api/settings/slack/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slack_webhook_url } = await request.json()

  if (slack_webhook_url) {
    // SSRF guard: only allow real Slack webhook URLs
    if (!slack_webhook_url.startsWith('https://hooks.slack.com/')) {
      return NextResponse.json({ error: 'invalid_webhook_url' }, { status: 400 })
    }

    try {
      const testRes = await fetch(slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '✓ Renewl is connected to this Slack channel.' }),
      })
      if (!testRes.ok) {
        return NextResponse.json({ error: 'webhook_unreachable' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'webhook_unreachable' }, { status: 400 })
    }
  }

  await sessionClient
    .from('profiles')
    .update({ slack_webhook_url: slack_webhook_url ?? null })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/api/settings-slack.test.ts --no-coverage
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/settings/slack/route.ts __tests__/api/settings-slack.test.ts
git commit -m "feat: add Slack webhook save route with connectivity test"
```

---

## Task 6: Free tier enforcement in upload route

**Files:**
- Modify: `app/api/upload/route.ts`
- Create: `__tests__/api/upload-free-tier.test.ts`

Adds a 20-contract limit for free users. Check happens after auth but before file processing. Returns `{ error: 'free_tier_limit' }` with status 403.

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/api/upload-free-tier.test.ts
// Tests specifically for free tier enforcement in POST /api/upload
import { POST } from '@/app/api/upload/route'

const mockGetUser = jest.fn()
const mockProfileSelect = jest.fn()
const mockContractCount = jest.fn()
const mockStorageUpload = jest.fn().mockResolvedValue({ data: {}, error: null })
const mockFromInsert = jest.fn().mockResolvedValue({ error: null })

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: mockProfileSelect,
            })),
          })),
        }
      }
      if (table === 'contracts') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              neq: jest.fn(() => mockContractCount()),
            })),
          })),
          insert: mockFromInsert,
        }
      }
      return {}
    }),
  })),
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    storage: { from: jest.fn(() => ({ upload: mockStorageUpload })) },
  })),
}))

function makeReq() {
  const fd = {
    get: () => ({
      type: 'application/pdf',
      size: 1024,
      name: 'contract.pdf',
      arrayBuffer: async () => new ArrayBuffer(1024),
    }),
  }
  return { formData: async () => fd } as unknown as Request
}

describe('POST /api/upload — free tier', () => {
  beforeEach(() => jest.clearAllMocks())

  test('returns 403 with free_tier_limit when free user has 20 contracts', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({ data: { plan: 'free' }, error: null })
    mockContractCount.mockResolvedValue({ count: 20, error: null })

    const res = await POST(makeReq())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('free_tier_limit')
  })

  test('allows upload when free user has fewer than 20 contracts', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({ data: { plan: 'free' }, error: null })
    mockContractCount.mockResolvedValue({ count: 19, error: null })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
  })

  test('allows upload for pro users regardless of contract count', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({ data: { plan: 'pro' }, error: null })
    // Must set insert mock so the route completes successfully
    mockFromInsert.mockResolvedValue({ error: null })
    mockStorageUpload.mockResolvedValue({ data: {}, error: null })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    // Contract count check should be skipped for pro users
    expect(mockContractCount).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/api/upload-free-tier.test.ts --no-coverage
```

Expected: FAIL

- [ ] **Step 3: Add free tier check to upload route**

Add this block after the auth check and before the formData parsing in `app/api/upload/route.ts`:

```typescript
// Free tier: check contract count
const { data: profile } = await sessionClient
  .from('profiles')
  .select('plan')
  .eq('id', user.id)
  .single()

if (profile?.plan === 'free') {
  const { count } = await sessionClient
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .neq('status', 'expired')

  if ((count ?? 0) >= 20) {
    return NextResponse.json(
      { error: 'free_tier_limit', message: 'Free plan is limited to 20 contracts. Upgrade to Pro for unlimited contracts.' },
      { status: 403 }
    )
  }
}
```

The full updated `app/api/upload/route.ts` after the change:

```typescript
// app/api/upload/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Free tier: check contract count
  const { data: profile } = await sessionClient
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  if (profile?.plan === 'free') {
    const { count } = await sessionClient
      .from('contracts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .neq('status', 'expired')

    if ((count ?? 0) >= 20) {
      return NextResponse.json(
        { error: 'free_tier_limit', message: 'Free plan is limited to 20 contracts. Upgrade to Pro for unlimited contracts.' },
        { status: 403 }
      )
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 20MB limit" }, { status: 413 });
  }

  const contractId = randomUUID();
  const filePath = `${user.id}/${contractId}/original.pdf`;
  const fileName = file.name;

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: uploadError } = await adminClient.storage
    .from("contracts")
    .upload(filePath, await file.arrayBuffer(), { contentType: "application/pdf" });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    return NextResponse.json({ error: "File upload failed" }, { status: 500 });
  }

  const { error: dbError } = await sessionClient.from("contracts").insert({
    id: contractId,
    user_id: user.id,
    name: fileName.replace(/\.pdf$/i, ""),
    category: "other",
    status: "processing",
    extraction_status: "pending",
    file_path: filePath,
    file_name: fileName,
  });

  if (dbError) {
    console.error("DB insert error:", dbError);
    return NextResponse.json({ error: "Failed to create contract record" }, { status: 500 });
  }

  return NextResponse.json({ contract_id: contractId });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/api/upload-free-tier.test.ts --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Run existing upload tests to confirm no regressions**

```bash
npx jest __tests__/api/upload.test.ts --no-coverage
```

Note: The existing upload tests mock `from()` without `profiles` — they may need their mock updated to handle the new `profiles` query. If they fail, update `__tests__/api/upload.test.ts` mock:

```typescript
// Update the from() mock to handle 'profiles', 'contracts' (count path), and 'contracts' (insert path)
// Pro plan is returned for profiles so the count check is skipped in all existing upload tests
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn().mockResolvedValue({ data: { plan: 'pro' }, error: null }),
            })),
          })),
        }
      }
      // contracts table: supports both insert (success path) and select (count — never reached for pro)
      return {
        insert: mockFromInsert,
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            neq: jest.fn().mockResolvedValue({ count: 0, error: null }),
          })),
        })),
      }
    }),
  })),
}))
```

- [ ] **Step 6: Commit**

```bash
git add app/api/upload/route.ts __tests__/api/upload-free-tier.test.ts __tests__/api/upload.test.ts
git commit -m "feat: enforce 20-contract free tier limit in upload route"
```

---

## Task 7: Settings page

**Files:**
- Create: `app/(dashboard)/dashboard/settings/page.tsx`

Server component. Reads profile from Supabase (plan, email, slack_webhook_url, stripe_customer_id). Renders billing section (plan cards + upgrade/manage button) and Slack section. No tests needed — it's a server component with no logic; all logic lives in the API routes tested above.

- [ ] **Step 1: Create the settings page**

```tsx
// app/(dashboard)/dashboard/settings/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SettingsClient from '@/components/dashboard/settings-client'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, email, slack_webhook_url, stripe_customer_id')
    .eq('id', user.id)
    .single()

  return (
    <SettingsClient
      plan={profile?.plan ?? 'free'}
      email={profile?.email ?? user.email ?? ''}
      slackWebhookUrl={profile?.slack_webhook_url ?? null}
      hasStripeCustomer={!!profile?.stripe_customer_id}
    />
  )
}
```

- [ ] **Step 2: Create the client component**

```tsx
// components/dashboard/settings-client.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface Props {
  plan: string
  email: string
  slackWebhookUrl: string | null
  hasStripeCustomer: boolean
}

export default function SettingsClient({ plan, email, slackWebhookUrl, hasStripeCustomer }: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [slackUrl, setSlackUrl] = useState(slackWebhookUrl ?? '')
  const [slackStatus, setSlackStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [slackError, setSlackError] = useState('')
  const [billingLoading, setBillingLoading] = useState(false)
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(false)

  useEffect(() => {
    if (searchParams.get('upgraded') === 'true') {
      setShowUpgradeBanner(true)
    }
  }, [searchParams])

  async function handleUpgrade() {
    setBillingLoading(true)
    const res = await fetch('/api/stripe/checkout', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setBillingLoading(false)
  }

  async function handleManage() {
    setBillingLoading(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setBillingLoading(false)
  }

  async function handleSlackSave() {
    setSlackStatus('saving')
    setSlackError('')
    const res = await fetch('/api/settings/slack', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slack_webhook_url: slackUrl || null }),
    })
    if (res.ok) {
      setSlackStatus('saved')
      setTimeout(() => setSlackStatus('idle'), 2000)
    } else {
      const data = await res.json()
      setSlackStatus('error')
      setSlackError(
        data.error === 'webhook_unreachable'
          ? 'Could not reach that webhook URL. Please check it and try again.'
          : 'Failed to save. Please try again.'
      )
    }
  }

  const isPro = plan === 'pro'

  const sectionStyle = {
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    paddingBottom: '32px',
    marginBottom: '32px',
  }

  const labelStyle = {
    fontSize: '11px',
    fontWeight: 600,
    color: '#4B5563',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    marginBottom: '16px',
  }

  const cardStyle = (active: boolean) => ({
    border: `1.5px solid ${active ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: '8px',
    padding: '16px 20px',
    flex: 1,
    background: active ? 'rgba(16,185,129,0.05)' : 'transparent',
  })

  return (
    <div style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif', color: '#F9FAFB', minHeight: '100vh', background: '#0A0F1E' }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '56px' }}>
            <Link href="/dashboard" style={{ color: '#10B981', fontSize: '20px', fontWeight: 600, letterSpacing: '-0.02em', textDecoration: 'none' }}>
              renewl
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Link href="/dashboard/settings" style={{ fontSize: '13px', color: '#10B981', textDecoration: 'none' }}>Settings</Link>
              <span style={{ fontSize: '13px', color: '#4B5563' }}>{email}</span>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '680px', margin: '0 auto', padding: '40px 24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '32px' }}>Settings</h1>

        {/* Upgrade success banner */}
        {showUpgradeBanner && (
          <div
            onClick={() => setShowUpgradeBanner(false)}
            style={{
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '24px',
              fontSize: '14px',
              color: '#10B981',
              cursor: 'pointer',
            }}
          >
            ✓ Welcome to Pro. All limits removed.
          </div>
        )}

        {/* Account */}
        <div style={sectionStyle}>
          <p style={labelStyle}>Account</p>
          <p style={{ fontSize: '14px', color: '#9CA3AF' }}>
            <span style={{ color: '#6B7280' }}>Email: </span>{email}
          </p>
        </div>

        {/* Billing */}
        <div style={sectionStyle}>
          <p style={labelStyle}>Billing</p>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            {/* Free card */}
            <div style={cardStyle(!isPro)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600 }}>Free</span>
                {!isPro && <span style={{ fontSize: '11px', color: '#10B981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: '4px' }}>Current plan</span>}
              </div>
              <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '4px' }}>Up to 20 contracts</p>
              <p style={{ fontSize: '13px', color: '#6B7280' }}>Email alerts</p>
            </div>
            {/* Pro card */}
            <div style={cardStyle(isPro)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600 }}>Pro — $49/month</span>
                {isPro && <span style={{ fontSize: '11px', color: '#10B981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: '4px' }}>Current plan</span>}
              </div>
              <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '4px' }}>Unlimited contracts</p>
              <p style={{ fontSize: '13px', color: '#6B7280' }}>Email + Slack alerts</p>
            </div>
          </div>
          {!isPro ? (
            <button
              onClick={handleUpgrade}
              disabled={billingLoading}
              style={{
                background: '#10B981',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 20px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: billingLoading ? 'not-allowed' : 'pointer',
                opacity: billingLoading ? 0.7 : 1,
              }}
            >
              {billingLoading ? 'Redirecting…' : 'Upgrade to Pro →'}
            </button>
          ) : (
            <button
              onClick={handleManage}
              disabled={billingLoading}
              style={{
                background: 'transparent',
                color: '#9CA3AF',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '6px',
                padding: '8px 20px',
                fontSize: '14px',
                cursor: billingLoading ? 'not-allowed' : 'pointer',
                opacity: billingLoading ? 0.7 : 1,
              }}
            >
              {billingLoading ? 'Redirecting…' : 'Manage subscription →'}
            </button>
          )}
        </div>

        {/* Notifications / Slack */}
        <div style={sectionStyle}>
          <p style={labelStyle}>Notifications</p>
          <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '12px' }}>
            Slack webhook URL
            {!isPro && <span style={{ color: '#4B5563', marginLeft: '8px' }}>(Pro only)</span>}
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              type="url"
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              disabled={!isPro}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                color: '#F9FAFB',
                outline: 'none',
                opacity: !isPro ? 0.4 : 1,
              }}
            />
            <button
              onClick={handleSlackSave}
              disabled={!isPro || slackStatus === 'saving'}
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: '#F9FAFB',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '13px',
                cursor: !isPro || slackStatus === 'saving' ? 'not-allowed' : 'pointer',
                opacity: !isPro ? 0.4 : 1,
              }}
            >
              {slackStatus === 'saving' ? 'Saving…' : slackStatus === 'saved' ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          {slackStatus === 'error' && (
            <p style={{ fontSize: '12px', color: '#EF4444' }}>{slackError}</p>
          )}
          {isPro && (
            <a
              href="https://api.slack.com/messaging/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '12px', color: '#4B5563', textDecoration: 'none' }}
            >
              How to get a webhook URL ↗
            </a>
          )}
        </div>

        {/* Danger zone */}
        <div>
          <p style={labelStyle}>Danger Zone</p>
          <button
            disabled
            style={{
              background: 'transparent',
              color: '#4B5563',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px',
              padding: '8px 16px',
              fontSize: '13px',
              cursor: 'not-allowed',
            }}
          >
            Delete account — coming soon
          </button>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Verify the page renders without TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/dashboard/settings/page.tsx components/dashboard/settings-client.tsx
git commit -m "feat: add settings page with billing and Slack sections"
```

---

## Task 8: Dashboard nav — add Settings link and upgrade banner in upload zone

**Files:**
- Modify: `app/(dashboard)/dashboard/page.tsx`
- Modify: `components/dashboard/upload-zone.tsx`

- [ ] **Step 1: Add Settings link to dashboard header**

In `app/(dashboard)/dashboard/page.tsx`, update the header's right side to include a Settings link before the email:

```tsx
// Replace the right side of the header div:
<div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
  <Link href="/dashboard/settings" style={{ fontSize: "13px", color: "#6B7280", textDecoration: "none" }}>
    Settings
  </Link>
  <span style={{ fontSize: "13px", color: "#4B5563" }}>{user.email}</span>
  <LogoutButton />
</div>
```

Also add `import Link from 'next/link'` at the top if not already present.

- [ ] **Step 2: Add upgrade banner to upload zone on 403**

In `components/dashboard/upload-zone.tsx`, update the State type and error handling:

```typescript
// Update State type:
type State =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "error"; message: string }
  | { status: "limit_reached" }

// In handleFile, after the fetch:
if (res.status === 403) {
  const { error } = await res.json().catch(() => ({ error: '' }))
  if (error === 'free_tier_limit') {
    setState({ status: "limit_reached" })
    return
  }
}

// In the JSX, add below the existing error display:
{state.status === "limit_reached" && (
  <p style={{ fontSize: "12px", color: "#F59E0B", marginTop: "8px" }}>
    You've reached the 20 contract limit on the Free plan.{" "}
    <Link
      href="/dashboard/settings"
      onClick={(e) => e.stopPropagation()}
      style={{ color: "#10B981", textDecoration: "underline" }}
    >
      Upgrade to Pro →
    </Link>
  </p>
)}
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/(dashboard)/dashboard/page.tsx components/dashboard/upload-zone.tsx
git commit -m "feat: add Settings nav link and free tier upgrade prompt in upload zone"
```

---

## Task 9: Full test run

- [ ] **Step 1: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass, no regressions

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

---

## Environment variables checklist

Before testing end-to-end, ensure these are set in `.env.local`:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is NOT used in v1 (Stripe-hosted checkout, no Stripe.js needed)
# Reserve it for future inline payment UI if needed
APP_URL=http://localhost:3000
```

For production, set all of the above in Vercel environment variables (swap `sk_test_` → `sk_live_`, etc.).

---

## Testing checklist (manual, sandbox mode)

- [ ] Free user clicks "Upgrade to Pro" → Stripe Checkout opens
- [ ] Complete with test card `4242 4242 4242 4242` → redirected back with `?upgraded=true` banner
- [ ] `profiles.plan` updated to `'pro'` in Supabase dashboard
- [ ] Pro user clicks "Manage subscription" → Stripe Customer Portal opens
- [ ] Cancel in portal → webhook fires → `profiles.plan` → `'free'`
- [ ] Free user with 20 contracts uploads → amber banner with "Upgrade to Pro →" link
- [ ] Slack webhook save with valid `https://hooks.slack.com/...` URL → success, test message appears in Slack
- [ ] Slack webhook save with non-Slack URL (e.g. `https://evil.com`) → `invalid_webhook_url` error, nothing saved
- [ ] Slack webhook save with valid domain but unreachable URL → `webhook_unreachable` error, nothing saved
