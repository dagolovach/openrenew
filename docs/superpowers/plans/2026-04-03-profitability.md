# Renewl Profitability Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition Renewl around money saved / renewal leak prevention through 7 coordinated changes: pricing page, savings dashboard, homepage copy, conversion nudges, CTA updates, annual value display, and email enrichment.

**Architecture:** Marketing changes (Sections 1, 3, 5) are pure file edits with no new dependencies. Product changes (Sections 2, 4, 6, 7) share a single new `lib/subscription.ts` utility and a one-migration schema addition. Execution is strictly ordered: Section 2 must complete before 4, 6, or 7; Section 1 must complete before 5.

**Tech Stack:** Next.js 16 App Router · React 19 · Supabase (Postgres + RLS) · TypeScript · Jest · Python FastAPI (Railway)

---

## File Map

**New files:**
- `app/(marketing)/pricing/page.tsx` — server component, metadata, renders PricingCards
- `app/(marketing)/pricing/PricingCards.tsx` — `'use client'`, billing toggle + card layout
- `lib/subscription.ts` — `getUserTier()` reading `profiles.plan`
- `supabase/migrations/20260403000000_renewal_savings.sql` — adds annual_value cols + team tier
- `components/dashboard/SavingsSummary.tsx` — `'use client'`, 4 metric cards, tier-gated
- `app/api/contracts/[id]/renewal-action/route.ts` — POST renewal outcome
- `__tests__/lib/subscription.test.ts`
- `__tests__/api/renewal-action.test.ts`

**Modified files:**
- `components/marketing/marketing-nav.tsx` — add Pricing link
- `app/(marketing)/page.tsx` — hero copy, social proof, value props, CTA, footer, JSON-LD
- `app/(marketing)/faq/page.tsx` — JSON-LD pricing update
- `app/(marketing)/faq/faq-accordion.tsx` — pricing update + new entry
- `DECISIONS.md` — entries 021, 022
- `lib/utils.ts` — add `isNearExpiry()`
- `python-service/main.py` — add `annual_value` to EXTRACTION_TOOL
- `app/(dashboard)/dashboard/page.tsx` — add SavingsSummary, pass tier to UploadZone
- `components/dashboard/upload-zone.tsx` — tier prop, mount fetch, contracts_remaining banner
- `app/api/upload/route.ts` — add contracts_remaining to response
- `components/contracts/ContractDetailClient.tsx` — annual_value display, renewal outcome, post-analysis nudge
- `components/dashboard/contract-card.tsx` — annualValue in CardState + comparator
- `components/dashboard/contract-list.tsx` — select + pass annual_value
- `lib/email.ts` — annual_value + user_plan fields + tier CTA
- `app/api/cron/send-alerts/route.ts` — select annual_value + plan, updated types
- All blog pages (7) + all resources pages (7) — CTA text updates

---

## SECTION 1 — Pricing Page

### Task 1: Add Pricing to nav and homepage footer

**Files:**
- Modify: `components/marketing/marketing-nav.tsx`
- Modify: `app/(marketing)/page.tsx`

- [ ] **Add Pricing to navLinks in marketing-nav.tsx**

Open `components/marketing/marketing-nav.tsx`. Change:

```typescript
const navLinks = [
  { href: "/blog", label: "Blog", prefix: "/blog" },
  { href: "/resources", label: "Resources", prefix: "/resources" },
  { href: "/faq", label: "FAQ", prefix: "/faq" },
];
```

To:

```typescript
const navLinks = [
  { href: "/blog", label: "Blog", prefix: "/blog" },
  { href: "/resources", label: "Resources", prefix: "/resources" },
  { href: "/pricing", label: "Pricing", prefix: "/pricing" },
  { href: "/faq", label: "FAQ", prefix: "/faq" },
];
```

- [ ] **Add Pricing to footer in app/(marketing)/page.tsx**

Find the footer `foot-links` div. Change:

```tsx
<div className="foot-links">
  <a href="/faq" className="foot-link">
    FAQ
  </a>
  <span className="foot-sep">·</span>
  <a
    href="/resources/renewal-leak-calculator"
    className="foot-link"
  >
    Free Tools
  </a>
```

To:

```tsx
<div className="foot-links">
  <a href="/faq" className="foot-link">
    FAQ
  </a>
  <span className="foot-sep">·</span>
  <a href="/pricing" className="foot-link">
    Pricing
  </a>
  <span className="foot-sep">·</span>
  <a
    href="/resources/renewal-leak-calculator"
    className="foot-link"
  >
    Free Tools
  </a>
```

- [ ] **Verify with `npm run lint`** — expected: no errors

- [ ] **Commit**

```bash
git add components/marketing/marketing-nav.tsx app/\(marketing\)/page.tsx
git commit -m "feat: add Pricing link to nav and footer"
```

---

### Task 2: Create PricingCards client component

**Files:**
- Create: `app/(marketing)/pricing/PricingCards.tsx`

- [ ] **Create the file**

```tsx
// app/(marketing)/pricing/PricingCards.tsx
"use client";

import { useState } from "react";
import Link from "next/link";

type BillingCycle = "monthly" | "annual";

const FEATURES_FREE = [
  "Up to 20 contracts",
  "AI extraction",
  "Contract Intelligence (risk analysis)",
  "Email alerts (60/30/7 days)",
  "1 team member",
];

const FEATURES_PRO = [
  "Unlimited contracts",
  "AI extraction",
  "Contract Intelligence (risk analysis)",
  "Email alerts (60/30/7 days)",
  "Slack alerts",
  "Renewal savings dashboard",
  "CSV export",
  "1 team member",
];

const FEATURES_TEAM = [
  "Unlimited contracts",
  "AI extraction",
  "Contract Intelligence (risk analysis)",
  "Email alerts (60/30/7 days)",
  "Slack alerts",
  "Renewal savings dashboard",
  "CSV export",
  "Up to 5 team members",
  "Priority support",
];

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7l4 4 6-6" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7h8" stroke="#374151" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const CARD_BASE: React.CSSProperties = {
  background: "#111827",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  padding: "32px",
  display: "flex",
  flexDirection: "column",
  gap: "0",
};

const CARD_PRO: React.CSSProperties = {
  ...CARD_BASE,
  border: "1px solid #10B981",
  position: "relative",
};

function FeatureRow({ included, label }: { included: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      {included ? <CheckIcon /> : <DashIcon />}
      <span style={{
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontSize: "14px",
        color: included ? "#D1D5DB" : "#4B5563",
      }}>{label}</span>
    </div>
  );
}

const ALL_FEATURES = [
  "Up to 20 contracts",
  "Unlimited contracts",
  "AI extraction",
  "Contract Intelligence (risk analysis)",
  "Email alerts (60/30/7 days)",
  "Slack alerts",
  "Renewal savings dashboard",
  "CSV export",
  "1 team member",
  "Up to 5 team members",
  "Priority support",
];

const FREE_SET = new Set(FEATURES_FREE);
const PRO_SET = new Set(FEATURES_PRO);
const TEAM_SET = new Set(FEATURES_TEAM);

export default function PricingCards() {
  const [billing, setBilling] = useState<BillingCycle>("monthly");

  return (
    <>
      {/* ── Billing toggle ── */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", marginBottom: "48px" }}>
        <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "14px", color: billing === "monthly" ? "#F9FAFB" : "#6B7280" }}>Monthly</span>
        <button
          onClick={() => setBilling(b => b === "monthly" ? "annual" : "monthly")}
          aria-label="Toggle billing cycle"
          style={{
            width: "48px",
            height: "26px",
            borderRadius: "13px",
            background: billing === "annual" ? "#10B981" : "#374151",
            border: "none",
            cursor: "pointer",
            position: "relative",
            transition: "background 200ms",
            flexShrink: 0,
          }}
        >
          <span style={{
            position: "absolute",
            top: "3px",
            left: billing === "annual" ? "25px" : "3px",
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            background: "#fff",
            transition: "left 200ms",
          }} />
        </button>
        <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "14px", color: billing === "annual" ? "#F9FAFB" : "#6B7280" }}>
          Annual <span style={{ color: "#10B981", fontSize: "12px" }}>Save ~17%</span>
        </span>
      </div>

      {/* ── Cards ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "24px",
        maxWidth: "960px",
        margin: "0 auto",
      }}
        className="pricing-cards-grid"
      >
        {/* ── FREE ── */}
        <div style={CARD_BASE} className="reveal">
          <div style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#6B7280", marginBottom: "12px" }}>Free</div>
          <div style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "42px", fontWeight: 700, color: "#F9FAFB", lineHeight: 1, marginBottom: "4px" }}>$0</div>
          <div style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280", marginBottom: "24px" }}>Forever free · no credit card</div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "20px", marginBottom: "24px", flex: 1 }}>
            {ALL_FEATURES.map(f => <FeatureRow key={f} included={FREE_SET.has(f)} label={f} />)}
          </div>
          <Link href="/login" style={{
            display: "block", textAlign: "center", padding: "12px",
            border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px",
            fontFamily: "var(--font-jetbrains), monospace", fontSize: "13px", fontWeight: 700,
            color: "#F9FAFB", textDecoration: "none",
          }}>
            Start free →
          </Link>
        </div>

        {/* ── PRO ── */}
        <div style={CARD_PRO} className="reveal">
          <div style={{
            position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)",
            background: "#10B981", color: "#0A0F1E",
            fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px", fontWeight: 700,
            padding: "3px 12px", borderRadius: "20px", letterSpacing: "0.08em", whiteSpace: "nowrap",
          }}>Most Popular</div>
          <div style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#10B981", marginBottom: "12px" }}>Pro</div>
          <div style={{ marginBottom: "4px" }}>
            {billing === "annual" && (
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "18px", color: "#4B5563", textDecoration: "line-through", marginRight: "8px" }}>$59</span>
            )}
            <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "42px", fontWeight: 700, color: "#F9FAFB", lineHeight: 1 }}>
              {billing === "annual" ? "$49" : "$59"}
            </span>
            <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "14px", color: "#6B7280" }}>/mo</span>
          </div>
          <div style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280", marginBottom: "24px" }}>
            {billing === "annual" ? "Billed annually · cancel anytime" : "Billed monthly · cancel anytime"}
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "20px", marginBottom: "24px", flex: 1 }}>
            {ALL_FEATURES.map(f => <FeatureRow key={f} included={PRO_SET.has(f)} label={f} />)}
          </div>
          <Link href="/login" style={{
            display: "block", textAlign: "center", padding: "12px",
            background: "#10B981", borderRadius: "6px",
            fontFamily: "var(--font-jetbrains), monospace", fontSize: "13px", fontWeight: 700,
            color: "#0A0F1E", textDecoration: "none",
          }}>
            Get started →
          </Link>
        </div>

        {/* ── TEAM ── */}
        <div style={CARD_BASE} className="reveal">
          <div style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#6B7280", marginBottom: "12px" }}>Team</div>
          <div style={{ marginBottom: "4px" }}>
            {billing === "annual" && (
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "18px", color: "#4B5563", textDecoration: "line-through", marginRight: "8px" }}>$149</span>
            )}
            <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "42px", fontWeight: 700, color: "#F9FAFB", lineHeight: 1 }}>
              {billing === "annual" ? "$125" : "$149"}
            </span>
            <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "14px", color: "#6B7280" }}>/mo</span>
          </div>
          <div style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280", marginBottom: "24px" }}>
            {billing === "annual" ? "Billed annually · cancel anytime" : "Billed monthly · cancel anytime"}
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "20px", marginBottom: "24px", flex: 1 }}>
            {ALL_FEATURES.map(f => <FeatureRow key={f} included={TEAM_SET.has(f)} label={f} />)}
          </div>
          <Link href="/login" style={{
            display: "block", textAlign: "center", padding: "12px",
            border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px",
            fontFamily: "var(--font-jetbrains), monospace", fontSize: "13px", fontWeight: 700,
            color: "#F9FAFB", textDecoration: "none",
          }}>
            Get started →
          </Link>
        </div>
      </div>

      {/* ── Mobile responsive override ── */}
      <style>{`
        @media (max-width: 1024px) {
          .pricing-cards-grid { grid-template-columns: 1fr !important; max-width: 440px !important; }
        }
      `}</style>

      {/* ── All plans include ── */}
      <p style={{
        textAlign: "center", marginTop: "32px",
        fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280",
      }}>
        All plans include: 256-bit encryption · No training on your data · Cancel anytime
      </p>
    </>
  );
}
```

- [ ] **Verify no TypeScript errors**

```bash
npm run lint 2>&1 | head -20
```

---

### Task 3: Create pricing page server component + mini-FAQ

**Files:**
- Create: `app/(marketing)/pricing/page.tsx`

- [ ] **Create the file**

```tsx
// app/(marketing)/pricing/page.tsx
import type { Metadata } from "next";
import RevealObserver from "@/components/marketing/reveal-observer";
import PricingCards from "./PricingCards";

export const metadata: Metadata = {
  title: "Pricing — Renewl",
  description:
    "Renewl is free for your first 20 contracts. Pro at $59/month adds unlimited contracts, Slack alerts, and renewal savings tracking. Team at $149/month adds 5 seats and priority support.",
  alternates: { canonical: "https://getrenewl.com/pricing" },
};

const MINI_FAQ = [
  {
    q: "How much does Renewl cost?",
    a: "Free for up to 20 contracts with email alerts and AI extraction. Pro is $59/month (or $49/month billed annually) for unlimited contracts, Slack alerts, and renewal savings tracking. Team is $149/month for up to 5 users.",
  },
  {
    q: "Is there a free trial?",
    a: "Renewl uses a freemium model — not a free trial. The Free plan is yours permanently with no time limit. You only need to upgrade when you exceed 20 contracts or need Pro features.",
  },
  {
    q: "What's included in the free plan?",
    a: "Up to 20 contracts, AI extraction with confidence scoring, Contract Intelligence risk analysis, and email alerts at 60, 30, and 7 days before each deadline. No credit card required.",
  },
  {
    q: "Can I cancel at any time?",
    a: "Yes. Cancel from Settings → Billing at any time. Your plan stays active until the end of the billing period — no prorated refunds, no surprise charges.",
  },
  {
    q: "Does Renewl train AI models on my contracts?",
    a: "No. Contract text is sent to Anthropic's Claude API for extraction only. Anthropic does not train models on API data. Your contracts are never used for model training.",
  },
];

export default function PricingPage() {
  return (
    <>
      <RevealObserver />

      {/* ── Header ── */}
      <section style={{ padding: "80px 0 48px", textAlign: "center" }}>
        <div className="wrap">
          <div className="tag" style={{ justifyContent: "center" }}>Pricing</div>
          <h1
            style={{
              fontFamily: "var(--font-plex-serif), Georgia, serif",
              fontSize: "clamp(2rem, 4vw, 3rem)",
              fontWeight: 700,
              color: "#F9FAFB",
              marginBottom: "16px",
              letterSpacing: "-0.015em",
            }}
          >
            Flat pricing. No surprises. Ever.
          </h1>
          <p style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "17px",
            color: "#9CA3AF",
            maxWidth: "480px",
            margin: "0 auto",
          }}>
            Start free with 20 contracts. Upgrade when you need more.
          </p>
        </div>
      </section>

      {/* ── Cards ── */}
      <section style={{ padding: "0 0 80px" }}>
        <div className="wrap">
          <PricingCards />
        </div>
      </section>

      <div className="divider" />

      {/* ── Mini FAQ ── */}
      <section style={{ padding: "80px 0" }}>
        <div className="wrap" style={{ maxWidth: "720px" }}>
          <h2
            style={{
              fontFamily: "var(--font-plex-serif), Georgia, serif",
              fontSize: "clamp(1.5rem, 3vw, 2rem)",
              fontWeight: 700,
              color: "#F9FAFB",
              marginBottom: "40px",
              textAlign: "center",
            }}
          >
            Common questions
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {MINI_FAQ.map((item) => (
              <div
                key={item.q}
                style={{
                  background: "#111827",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px",
                  padding: "24px",
                }}
              >
                <p style={{
                  fontFamily: "var(--font-inter), sans-serif",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#F9FAFB",
                  marginBottom: "8px",
                }}>{item.q}</p>
                <p style={{
                  fontFamily: "var(--font-inter), sans-serif",
                  fontSize: "14px",
                  color: "#9CA3AF",
                  lineHeight: 1.6,
                  margin: 0,
                }}>{item.a}</p>
              </div>
            ))}
          </div>
          <p style={{
            textAlign: "center",
            marginTop: "32px",
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "14px",
            color: "#6B7280",
          }}>
            More questions? See the full <a href="/faq" style={{ color: "#10B981", textDecoration: "underline" }}>FAQ →</a>
          </p>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Run build to verify page renders**

```bash
npm run build 2>&1 | grep -E "error|Error|pricing" | head -20
```

Expected: `○ /pricing` in build output (static page).

- [ ] **Commit**

```bash
git add app/\(marketing\)/pricing/
git commit -m "feat: add /pricing page with three-tier cards and mini-FAQ"
```

---

### Task 4: Update FAQ pricing + add new entry + DECISIONS.md 021

**Files:**
- Modify: `app/(marketing)/faq/faq-accordion.tsx`
- Modify: `app/(marketing)/faq/page.tsx`
- Modify: `DECISIONS.md`

- [ ] **Update faq-accordion.tsx: billing section**

In `faq-accordion.tsx`, find the `billing` section `items` array. Replace the entire `billing` section items with:

```typescript
{
  id: "billing",
  title: "Pricing & Billing",
  items: [
    {
      q: "How much does Renewl cost?",
      a: (
        <>
          Free for up to 20 contracts with email alerts and AI extraction. Pro is $59/month (or $49/month billed annually) for unlimited contracts, Slack alerts, and renewal savings tracking. Team is $149/month for up to 5 users.{" "}
          <a href="/pricing" style={{ color: "#10B981" }}>See full pricing →</a>
        </>
      ),
    },
    {
      q: "What's included in the free plan?",
      a: "Up to 20 contracts, email alerts, and full AI extraction with Contract Intelligence risk analysis. No credit card required.",
    },
    {
      q: "Can I cancel at any time?",
      a: "Yes. Cancel from Settings → Billing at any time. Your plan stays active until the end of the current billing period — no prorated refunds, no surprise charges.",
    },
    {
      q: "Is there a free trial?",
      a: "Renewl uses a freemium model, not a free trial. The Free plan is permanent — no time limit. Upgrade to Pro ($59/month) when you exceed 20 contracts or need Slack alerts and savings tracking.",
    },
  ],
},
```

- [ ] **Update faq/page.tsx JSON-LD**

In `faq/page.tsx`, find the `faqJsonLd` `mainEntity` array. Add this entry near the top:

```typescript
{
  '@type': 'Question',
  name: 'How much does Renewl cost?',
  acceptedAnswer: {
    '@type': 'Answer',
    text: "Free for up to 20 contracts with email alerts and AI extraction. Pro is $59/month (or $49/month billed annually) for unlimited contracts, Slack alerts, and renewal savings tracking. Team is $149/month for up to 5 users. See full details on our pricing page at getrenewl.com/pricing.",
  },
},
```

Also find and update the existing `"What's included in the free plan?"` entry answer to add "Contract Intelligence risk analysis".

- [ ] **Update JSON-LD in app/(marketing)/page.tsx**

Find the `offers` array in the `jsonLd` object. Replace with:

```typescript
offers: [
  {
    "@type": "Offer",
    name: "Free",
    price: "0",
    priceCurrency: "USD",
    description: "Up to 20 contracts, email alerts, AI extraction",
  },
  {
    "@type": "Offer",
    name: "Pro",
    price: "59",
    priceCurrency: "USD",
    description: "Unlimited contracts, Slack alerts, renewal savings dashboard",
    billingDuration: "P1M",
  },
  {
    "@type": "Offer",
    name: "Team",
    price: "149",
    priceCurrency: "USD",
    description: "Up to 5 users, unlimited contracts, Slack alerts, priority support",
    billingDuration: "P1M",
  },
],
```

- [ ] **Add DECISIONS.md entry 021**

Append to the Decision Index table:
```
| 021 | Three-tier pricing with annual billing | Active | Apr 2026 |
```

Append the full entry before `## How to add a new entry`:

```markdown
### 021 — Three-tier pricing with annual billing

**Status:** Active
**Date:** April 2026

**Context:**
Renewl launched with a two-tier model (Free / Pro at $49/month). The $49 price point was set conservatively for early validation. With the savings dashboard and team features added, the product justifies a higher price. A Team tier was needed to capture multi-user ops teams without changing the solo-user Pro price excessively.

**Decision:**
Three tiers: Free (20 contracts), Pro ($59/month or $49/month annually), Team ($149/month or $125/month annually). Pro price raised from $49 → $59 to improve unit economics. No free trial — freemium model only (the Free tier is permanent, not time-limited). Annual billing saves ~17%.

**Alternatives considered:**
- Keep $49 Pro — rejected; unit economics don't support the savings dashboard + AI costs at that price
- Per-seat pricing — rejected; adds billing unpredictability for users, contradicts "no surprise invoices" positioning

**Consequences:**
- Existing Pro users at $49 are grandfathered — do not change their plan_price in Stripe without a migration plan
- Pricing page (/pricing) is the canonical source of truth; FAQ and homepage JSON-LD must be kept in sync
- Annual billing is display-only for now — Stripe products for annual billing need to be created before going live
```

- [ ] **Run `npm run lint`** — expected: no errors

- [ ] **Commit**

```bash
git add app/\(marketing\)/faq/ app/\(marketing\)/page.tsx DECISIONS.md
git commit -m "feat: update FAQ pricing to 3-tier, add decision 021"
```

---

### Task 5: Section 1 build checkpoint

- [ ] **Run full build and lint**

```bash
npm run build && npm run lint
```

Expected: clean build, `○ /pricing` in output, no errors.

---

## SECTION 2 — Renewal Savings Dashboard

### Task 6: Supabase migration

**Files:**
- Create: `supabase/migrations/20260403000000_renewal_savings.sql`

- [ ] **Create migration file**

```sql
-- supabase/migrations/20260403000000_renewal_savings.sql

-- Add 'team' to profiles.plan check constraint
ALTER TABLE public.profiles DROP CONSTRAINT profiles_plan_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'pro', 'team'));

-- Add renewal savings columns to contracts
-- annual_value: AI-extracted or user-entered annual cost
-- renewal_action: what the user did at renewal time
-- renewal_savings: NULL by default (unknown until action is recorded — not zero)
-- original_renewal_price: vendor's proposed price before negotiation
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS annual_value numeric,
  ADD COLUMN IF NOT EXISTS renewal_action text
    CHECK (renewal_action IN ('renewed', 'renegotiated', 'cancelled', 'pending')),
  ADD COLUMN IF NOT EXISTS renewal_savings numeric,
  ADD COLUMN IF NOT EXISTS original_renewal_price numeric;

-- RLS note: existing policies on contracts apply at row level.
-- These new columns are covered automatically — no policy changes needed.
-- Verified: all existing policies use USING (user_id = auth.uid()) row filters.
```

- [ ] **Apply migration to local Supabase (if running locally)**

```bash
supabase db push
# or if using remote:
# supabase db push --linked
```

- [ ] **Commit**

```bash
git add supabase/migrations/20260403000000_renewal_savings.sql
git commit -m "feat: migration — renewal savings columns + team plan tier"
```

---

### Task 7: `lib/subscription.ts` + tests

**Files:**
- Create: `lib/subscription.ts`
- Create: `__tests__/lib/subscription.test.ts`

- [ ] **Write the failing tests first**

```typescript
// __tests__/lib/subscription.test.ts
const mockGetUser = jest.fn();
const mockSingle = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: mockSingle,
        })),
      })),
    })),
  })),
}));

import { getUserTier } from "@/lib/subscription";

describe("getUserTier", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 'pro' for plan = 'pro'", async () => {
    mockSingle.mockResolvedValue({ data: { plan: "pro" }, error: null });
    expect(await getUserTier("user-123")).toBe("pro");
  });

  test("returns 'team' for plan = 'team'", async () => {
    mockSingle.mockResolvedValue({ data: { plan: "team" }, error: null });
    expect(await getUserTier("user-123")).toBe("team");
  });

  test("returns 'free' for plan = 'free'", async () => {
    mockSingle.mockResolvedValue({ data: { plan: "free" }, error: null });
    expect(await getUserTier("user-123")).toBe("free");
  });

  test("returns 'free' when profile data is null", async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    expect(await getUserTier("user-123")).toBe("free");
  });

  test("returns 'free' for unknown plan value", async () => {
    mockSingle.mockResolvedValue({ data: { plan: "enterprise" }, error: null });
    expect(await getUserTier("user-123")).toBe("free");
  });
});
```

- [ ] **Run test to verify it fails**

```bash
npx jest __tests__/lib/subscription.test.ts 2>&1 | tail -5
```

Expected: `Cannot find module '@/lib/subscription'`

- [ ] **Create `lib/subscription.ts`**

```typescript
// lib/subscription.ts
import { createClient } from "@/lib/supabase/server";

export type SubscriptionTier = "free" | "pro" | "team";

/**
 * Returns the user's subscription tier based on profiles.plan.
 * Defaults to 'free' for null, missing, or unknown plan values.
 * Uses sessionClient with explicit .eq('id', userId) alongside RLS.
 */
export async function getUserTier(userId: string): Promise<SubscriptionTier> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", userId)
    .single();

  if (data?.plan === "pro") return "pro";
  if (data?.plan === "team") return "team";
  return "free";
}
```

- [ ] **Run tests to verify they pass**

```bash
npx jest __tests__/lib/subscription.test.ts
```

Expected: 5 passed.

- [ ] **Commit**

```bash
git add lib/subscription.ts __tests__/lib/subscription.test.ts
git commit -m "feat: add getUserTier() utility with tests"
```

---

### Task 8: Add `isNearExpiry()` to `lib/utils.ts` + tests

**Files:**
- Modify: `lib/utils.ts`
- Modify: `__tests__/lib/utils.test.ts`

- [ ] **Add failing tests for isNearExpiry**

Append to `__tests__/lib/utils.test.ts`:

```typescript
import { isNearExpiry } from "@/lib/utils";

describe("isNearExpiry", () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  function daysFromNow(n: number): string {
    const d = new Date(today.getTime() + n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  test("returns true when expiry is exactly at threshold", () => {
    expect(isNearExpiry(daysFromNow(90))).toBe(true);
  });

  test("returns true when expiry is within threshold", () => {
    expect(isNearExpiry(daysFromNow(30))).toBe(true);
  });

  test("returns true when expiry is today", () => {
    expect(isNearExpiry(daysFromNow(0))).toBe(true);
  });

  test("returns false when expiry is beyond threshold", () => {
    expect(isNearExpiry(daysFromNow(91))).toBe(false);
  });

  test("returns false for null expiryDate", () => {
    expect(isNearExpiry(null)).toBe(false);
  });

  test("respects custom threshold", () => {
    expect(isNearExpiry(daysFromNow(30), 29)).toBe(false);
    expect(isNearExpiry(daysFromNow(30), 30)).toBe(true);
  });
});
```

- [ ] **Run to verify failure**

```bash
npx jest __tests__/lib/utils.test.ts 2>&1 | grep "isNearExpiry" | head -5
```

Expected: `isNearExpiry is not a function`

- [ ] **Add `isNearExpiry` to `lib/utils.ts`**

Append after the `activeExpiryDate` function (before `formatExpiredDate`):

```typescript
/**
 * Returns true when expiryDate is non-null and within daysThreshold days from today.
 * Uses UTC midnight normalisation consistent with isExpired().
 * A contract expiring today (daysLeft === 0) is considered near-expiry.
 */
export function isNearExpiry(
  expiryDate: string | null,
  daysThreshold: number = 90
): boolean {
  if (!expiryDate) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate + "T00:00:00Z");
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
  return daysLeft >= 0 && daysLeft <= daysThreshold;
}
```

- [ ] **Run full utils tests**

```bash
npx jest __tests__/lib/utils.test.ts
```

Expected: all tests pass.

- [ ] **Commit**

```bash
git add lib/utils.ts __tests__/lib/utils.test.ts
git commit -m "feat: add isNearExpiry() utility with tests"
```

---

### Task 9: Add `annual_value` to Python extraction tool

**Files:**
- Modify: `python-service/main.py`

- [ ] **Add `annual_value` to EXTRACTION_TOOL properties**

In `python-service/main.py`, find `EXTRACTION_TOOL["input_schema"]["properties"]`. After the `"contract_value"` entry, add:

```python
"annual_value": {
    "type": ["number", "null"],
    "description": (
        "The total annual value or cost of this contract in the base currency. "
        "If the contract shows a monthly rate, multiply by 12. "
        "Return null if no monetary value is found."
    ),
},
```

Note: `"type": ["number", "null"]` is required — the forced tool call (Decision 019) rejects plain `"type": "number"` for null values, causing extraction failures on contracts without pricing.

Do NOT add `annual_value` to the `"required"` list — it is optional.

- [ ] **Verify the schema is valid by running the Python tests**

```bash
cd python-service && pytest tests/ -q 2>&1 | tail -10
cd ..
```

Expected: tests pass.

- [ ] **Commit**

```bash
git add python-service/main.py
git commit -m "feat: add annual_value extraction field to Python service"
```

---

### Task 10: Create `SavingsSummary` component

**Files:**
- Create: `components/dashboard/SavingsSummary.tsx`

- [ ] **Create the component**

```tsx
// components/dashboard/SavingsSummary.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SubscriptionTier } from "@/lib/subscription";
import Link from "next/link";

interface Metrics {
  totalSavings: number;
  contractsManaged: number;
  alertsSent: number;
  renewalsActioned: number;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

function SavingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8" stroke="#10B981" strokeWidth="1.5" />
      <path d="M10 6v8M7 8.5c0-1.38 1.34-2.5 3-2.5s3 1.12 3 2.5-1.34 2.5-3 2.5" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ContractIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="12" height="14" rx="2" stroke="#6B7280" strokeWidth="1.5" />
      <path d="M7 7h6M7 10h6M7 13h4" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2a6 6 0 016 6c0 3.5 1 5 1 5H3s1-1.5 1-5a6 6 0 016-6z" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 15a2 2 0 004 0" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ActionedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10l5 5 7-7" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  value: string;
  label: string;
  accent?: boolean;
  emptyMessage?: string;
}

function MetricCard({ icon, value, label, accent, emptyMessage }: MetricCardProps) {
  const showEmpty = emptyMessage && value === "$0";
  return (
    <div style={{
      background: "#111827",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "8px",
      borderLeft: accent ? "3px solid #10B981" : undefined,
      padding: accent ? "16px 16px 16px 13px" : "16px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {icon}
        <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      </div>
      {showEmpty ? (
        <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#4B5563", margin: 0, lineHeight: 1.4 }}>{emptyMessage}</p>
      ) : (
        <span style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "28px",
          fontWeight: 700,
          color: accent ? "#10B981" : "#F9FAFB",
          lineHeight: 1,
        }}>{value}</span>
      )}
    </div>
  );
}

interface Props {
  tier: SubscriptionTier;
  userId: string;
}

export default function SavingsSummary({ tier, userId }: Props) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    if (tier === "free") return;

    async function load() {
      const supabase = createClient();

      const [savingsRes, contractsRes, alertsRes, actionedRes] = await Promise.all([
        supabase
          .from("contracts")
          .select("renewal_savings")
          .eq("user_id", userId)
          .in("renewal_action", ["renegotiated", "cancelled"])
          .not("renewal_savings", "is", null),
        supabase
          .from("contracts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("status", "in", '("expired","renewed")'),
        supabase
          .from("alerts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("sent_at", "is", null),
        supabase
          .from("contracts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("renewal_action", "is", null),
      ]);

      const totalSavings = (savingsRes.data ?? []).reduce(
        (sum, row) => sum + (row.renewal_savings ?? 0),
        0
      );

      setMetrics({
        totalSavings,
        contractsManaged: contractsRes.count ?? 0,
        alertsSent: alertsRes.count ?? 0,
        renewalsActioned: actionedRes.count ?? 0,
      });
    }

    load();
  }, [tier, userId]);

  // Free tier: blurred placeholder with upgrade prompt
  if (tier === "free") {
    return (
      <div style={{ position: "relative", marginBottom: "24px" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "12px",
          filter: "blur(4px)",
          pointerEvents: "none",
          userSelect: "none",
        }}>
          {["$4,200", "12", "36", "3"].map((v, i) => (
            <div key={i} style={{
              background: "#111827",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              padding: "16px",
              height: "88px",
            }}>
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "28px", fontWeight: 700, color: "#F9FAFB" }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(10,15,30,0.7)",
          borderRadius: "8px",
        }}>
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: "20px", display: "block", marginBottom: "8px" }}>🔒</span>
            <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "14px", color: "#D1D5DB", margin: "0 0 8px" }}>
              Unlock your renewal savings dashboard
            </p>
            <Link href="/pricing" style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px", fontWeight: 700,
              color: "#10B981", textDecoration: "underline",
            }}>
              Upgrade to Pro →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "12px",
        marginBottom: "24px",
      }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", height: "88px", opacity: 0.4 }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "12px",
      marginBottom: "24px",
    }}
      className="savings-summary-grid"
    >
      <style>{`@media (max-width: 768px) { .savings-summary-grid { grid-template-columns: repeat(2, 1fr) !important; } }`}</style>
      <MetricCard
        icon={<SavingsIcon />}
        value={formatCurrency(metrics.totalSavings)}
        label="Total Savings"
        accent
        emptyMessage="Mark your first renewal action on any contract to start tracking savings"
      />
      <MetricCard icon={<ContractIcon />} value={String(metrics.contractsManaged)} label="Contracts Managed" />
      <MetricCard icon={<AlertIcon />} value={String(metrics.alertsSent)} label="Alerts Sent" />
      <MetricCard icon={<ActionedIcon />} value={String(metrics.renewalsActioned)} label="Renewals Actioned" />
    </div>
  );
}
```

- [ ] **Run lint**

```bash
npm run lint 2>&1 | grep "SavingsSummary" | head -5
```

- [ ] **Commit**

```bash
git add components/dashboard/SavingsSummary.tsx
git commit -m "feat: add SavingsSummary dashboard component"
```

---

### Task 11: Wire SavingsSummary + tier into dashboard page

**Files:**
- Modify: `app/(dashboard)/dashboard/page.tsx`

- [ ] **Update dashboard page to call getUserTier and pass tier to both SavingsSummary and UploadZone**

Replace the entire file content with:

```tsx
// app/(dashboard)/dashboard/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUserFromHeader } from "@/lib/supabase/user-from-header";
import { getUserTier } from "@/lib/subscription";
import UploadZone from "@/components/dashboard/upload-zone";
import NewSignupTracker from "@/components/dashboard/new-signup-tracker";
import DashboardNav from "@/components/dashboard/dashboard-nav";
import SavingsSummary from "@/components/dashboard/SavingsSummary";
import ContractsFeed from "./contracts-feed";
import ContractsFeedSkeleton from "@/components/dashboard/contracts-feed-skeleton";
import "./dashboard.css";

export const metadata = { title: "Dashboard — Renewl" };

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getUserFromHeader();
  if (!user) redirect("/login");

  const tier = await getUserTier(user.id);

  return (
    <div style={{ fontFamily: "var(--font-inter), system-ui, sans-serif", color: "#F9FAFB" }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <DashboardNav userEmail={user.email ?? ""} userId={user.id} />

      <NewSignupTracker />

      {/* ── Main content ───────────────────────────────────── */}
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>

        {/* ── Savings summary (tier-gated) ─────────────────── */}
        <SavingsSummary tier={tier} userId={user.id} />

        {/* ── Upload zone ────────────────────────────────── */}
        <div style={{ marginBottom: "24px" }}>
          <UploadZone tier={tier} />
        </div>

        {/* ── Contract list (streams in after shell renders) ── */}
        <Suspense fallback={<ContractsFeedSkeleton />}>
          <ContractsFeed userId={user.id} />
        </Suspense>
      </main>
    </div>
  );
}
```

- [ ] **Run build**

```bash
npm run build 2>&1 | grep -E "error|UploadZone" | head -10
```

Expected: error about `UploadZone` not accepting `tier` prop — this is expected and will be fixed in Task 19. Note the error, continue.

- [ ] **Commit**

```bash
git add app/\(dashboard\)/dashboard/page.tsx
git commit -m "feat: wire getUserTier into dashboard page, pass tier to SavingsSummary and UploadZone"
```

---

### Task 12: Renewal action API route + tests

**Files:**
- Create: `app/api/contracts/[id]/renewal-action/route.ts`
- Create: `__tests__/api/renewal-action.test.ts`

- [ ] **Write failing tests first**

```typescript
// __tests__/api/renewal-action.test.ts
const mockGetUser = jest.fn();
const mockOwnershipSingle = jest.fn();
const mockUpdate = jest.fn();
const mockInsert = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === "contracts") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: mockOwnershipSingle,
              })),
            })),
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => mockUpdate()),
            })),
          })),
        };
      }
      if (table === "activity_log") {
        return { insert: mockInsert };
      }
      return {};
    }),
  })),
}));

import { POST } from "@/app/api/contracts/[id]/renewal-action/route";

function makeReq(body: object) {
  return new Request("http://localhost/api/contracts/uuid/renewal-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_UUID = "00000000-0000-0000-0000-000000000001";
const VALID_PARAMS = { params: Promise.resolve({ id: VALID_UUID }) };

describe("POST /api/contracts/[id]/renewal-action", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue({ error: null });
    mockInsert.mockResolvedValue({ error: null });
  });

  test("returns 400 for malformed UUID", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(makeReq({ renewal_action: "renewed" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeReq({ renewal_action: "renewed" }), VALID_PARAMS);
    expect(res.status).toBe(401);
  });

  test("returns 404 when contract not owned by user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockOwnershipSingle.mockResolvedValue({ data: null, error: { message: "not found" } });
    const res = await POST(makeReq({ renewal_action: "renewed" }), VALID_PARAMS);
    expect(res.status).toBe(404);
  });

  test("returns 400 for invalid renewal_action value", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockOwnershipSingle.mockResolvedValue({ data: { id: VALID_UUID }, error: null });
    const res = await POST(makeReq({ renewal_action: "deleted" }), VALID_PARAMS);
    expect(res.status).toBe(400);
  });

  test("returns 200 for valid input", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockOwnershipSingle.mockResolvedValue({ data: { id: VALID_UUID }, error: null });
    const res = await POST(
      makeReq({ renewal_action: "renegotiated", renewal_savings: 5000, original_renewal_price: 20000 }),
      VALID_PARAMS
    );
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "renewal_action_recorded" })
    );
  });
});
```

- [ ] **Run to verify failure**

```bash
npx jest __tests__/api/renewal-action.test.ts 2>&1 | tail -5
```

Expected: `Cannot find module '@/app/api/contracts/[id]/renewal-action/route'`

- [ ] **Create the route**

```typescript
// app/api/contracts/[id]/renewal-action/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_ACTIONS = ["renewed", "renegotiated", "cancelled", "pending"] as const;
type RenewalAction = typeof VALID_ACTIONS[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contractId } = await params;

  // 1. Validate UUID before hitting the DB
  if (!UUID_RE.test(contractId)) {
    return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
  }

  // 2. Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 3. Verify ownership (RLS + explicit eq)
  const { data: contract, error: ownerErr } = await supabase
    .from("contracts")
    .select("id")
    .eq("id", contractId)
    .eq("user_id", user.id)
    .single();

  if (ownerErr || !contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  // 4. Parse and validate body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { renewal_action, renewal_savings, original_renewal_price } = body;

  if (!VALID_ACTIONS.includes(renewal_action as RenewalAction)) {
    return NextResponse.json(
      { error: "Invalid renewal_action. Must be one of: renewed, renegotiated, cancelled, pending" },
      { status: 400 }
    );
  }

  // 5. Update contract
  const { error: updateErr } = await supabase
    .from("contracts")
    .update({
      renewal_action: renewal_action as RenewalAction,
      renewal_savings: typeof renewal_savings === "number" ? renewal_savings : null,
      original_renewal_price: typeof original_renewal_price === "number" ? original_renewal_price : null,
    })
    .eq("id", contractId)
    .eq("user_id", user.id);

  if (updateErr) {
    return NextResponse.json({ error: "Failed to update contract" }, { status: 500 });
  }

  // 6. Log to activity_log
  await supabase.from("activity_log").insert({
    event_type: "renewal_action_recorded",
    contract_id: contractId,
    user_id: user.id,
    metadata: { renewal_action, renewal_savings, original_renewal_price },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Run tests to verify they pass**

```bash
npx jest __tests__/api/renewal-action.test.ts
```

Expected: 5 passed.

- [ ] **Commit**

```bash
git add app/api/contracts/\[id\]/renewal-action/ __tests__/api/renewal-action.test.ts
git commit -m "feat: add renewal-action API route with tests"
```

---

### Task 13: Contract detail — annual_value display + renewal outcome section

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`
- Modify: `app/(dashboard)/dashboard/contracts/[id]/page.tsx`

- [ ] **Add new fields to Contract type in ContractDetailClient.tsx**

Find the `type Contract` definition (line ~13). Add these fields:

```typescript
type Contract = {
  // ... existing fields ...
  contract_value: string | null;
  extraction_confidence: number | null;
  status: string | null;
  parent_contract_id: string | null;
  contract_version: number | null;
  // NEW:
  annual_value: number | null;
  renewal_action: string | null;
  renewal_savings: number | null;
  original_renewal_price: number | null;
};
```

- [ ] **Add tier prop to ContractDetailClient**

Change the component signature. Find:

```typescript
export default function ContractDetailClient({
  contract,
  versionChain,
}: {
  contract: Contract;
  versionChain: ...
```

Add `tier` prop:

```typescript
import type { SubscriptionTier } from "@/lib/subscription";

export default function ContractDetailClient({
  contract,
  versionChain,
  tier,
}: {
  contract: Contract;
  versionChain: ...;
  tier: SubscriptionTier;
}) {
```

- [ ] **Add isNearExpiry import and renewal outcome state**

Add import at top:

```typescript
import { isExpired, daysUntil, activeExpiryDate, isNearExpiry } from "@/lib/utils";
```

Add state hooks near the top of the component function (after existing useState calls):

```typescript
const [renewalAction, setRenewalAction] = useState<string>(contract.renewal_action ?? "");
const [originalPrice, setOriginalPrice] = useState<string>(
  contract.original_renewal_price != null ? String(contract.original_renewal_price) : ""
);
const [editedAnnualValue, setEditedAnnualValue] = useState<string>(
  contract.annual_value != null ? String(contract.annual_value) : ""
);
const [savingOutcome, setSavingOutcome] = useState(false);
const [nudgeShown, setNudgeShown] = useState(false);
```

- [ ] **Add annual_value display in the contract details grid**

Find where `contract_value` is displayed (look for a row showing contract value). After that row, add:

```tsx
{contract.annual_value != null && (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
    <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280" }}>Annual value</span>
    <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "13px", color: "#F9FAFB" }}>
      ${contract.annual_value.toLocaleString()}/yr
    </span>
  </div>
)}
{contract.annual_value == null && (
  <div style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
    <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280" }}>Annual value</span>
    <div style={{ marginTop: "6px", display: "flex", gap: "8px", alignItems: "center" }}>
      <input
        type="number"
        value={editedAnnualValue}
        onChange={(e) => setEditedAnnualValue(e.target.value)}
        placeholder="0"
        style={{
          width: "120px", padding: "6px 10px", fontSize: "13px",
          background: "#1E293B", border: "1px solid #334155",
          borderRadius: "6px", color: "#F1F5F9", outline: "none",
          fontFamily: "var(--font-jetbrains), monospace",
        }}
      />
      <button
        onClick={async () => {
          const val = parseFloat(editedAnnualValue);
          if (isNaN(val)) return;
          await fetch(`/api/contracts/${contract.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ annual_value: val }),
          });
        }}
        style={{
          padding: "6px 12px", fontSize: "12px", background: "#10B981",
          border: "none", borderRadius: "6px", color: "#0A0F1E",
          fontFamily: "var(--font-jetbrains), monospace", fontWeight: 700, cursor: "pointer",
        }}
      >
        Save
      </button>
    </div>
    <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "#4B5563", marginTop: "4px" }}>
      Adding this helps track your renewal savings
    </p>
  </div>
)}
```

- [ ] **Add renewal outcome section**

After the details grid (or after the alerts section), add the renewal outcome UI. Find a good insertion point near the bottom of the component return, before the final closing tags:

```tsx
{/* ── Renewal outcome ── */}
{(isExpired(contract) || isNearExpiry(contract.expiry_date, 90)) && (
  <div style={{
    background: "#111827",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "8px",
    padding: "20px",
    marginTop: "24px",
  }}>
    <h3 style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "14px", fontWeight: 600, color: "#F9FAFB", marginBottom: "16px" }}>
      Renewal outcome
    </h3>
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div>
        <label style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "6px" }}>
          What did you do?
        </label>
        <select
          value={renewalAction}
          onChange={(e) => setRenewalAction(e.target.value)}
          style={{
            padding: "8px 12px", fontSize: "14px", background: "#1E293B",
            border: "1px solid #334155", borderRadius: "6px", color: "#F1F5F9",
            fontFamily: "var(--font-inter), sans-serif", outline: "none", width: "100%",
          }}
        >
          <option value="">Select an option</option>
          <option value="renewed">Renewed at same price</option>
          <option value="renegotiated">Renegotiated</option>
          <option value="cancelled">Cancelled</option>
          <option value="pending">Still deciding</option>
        </select>
      </div>

      {renewalAction === "renegotiated" && (
        <div>
          <label style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "6px" }}>
            Original renewal price ($)
          </label>
          <input
            type="number"
            value={originalPrice}
            onChange={(e) => setOriginalPrice(e.target.value)}
            placeholder="Vendor's proposed price"
            style={{
              width: "100%", padding: "8px 12px", fontSize: "14px",
              background: "#1E293B", border: "1px solid #334155",
              borderRadius: "6px", color: "#F1F5F9", outline: "none",
              fontFamily: "var(--font-jetbrains), monospace", boxSizing: "border-box",
            }}
          />
          {contract.annual_value != null && originalPrice && !isNaN(parseFloat(originalPrice)) && (
            <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#10B981", marginTop: "6px" }}>
              Calculated savings: ${(parseFloat(originalPrice) - contract.annual_value).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {renewalAction === "cancelled" && contract.annual_value != null && (
        <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#10B981" }}>
          Full annual value saved: ${contract.annual_value.toLocaleString()}
        </p>
      )}

      {renewalAction && (
        <button
          disabled={savingOutcome}
          onClick={async () => {
            if (!renewalAction) return;
            setSavingOutcome(true);
            let savings: number | null = null;
            let origPrice: number | null = null;
            if (renewalAction === "cancelled" && contract.annual_value != null) {
              savings = contract.annual_value;
            } else if (renewalAction === "renegotiated" && contract.annual_value != null && originalPrice) {
              origPrice = parseFloat(originalPrice);
              if (!isNaN(origPrice)) savings = origPrice - contract.annual_value;
            }
            await fetch(`/api/contracts/${contract.id}/renewal-action`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                renewal_action: renewalAction,
                renewal_savings: savings,
                original_renewal_price: origPrice,
              }),
            });
            setSavingOutcome(false);
          }}
          style={{
            padding: "10px 20px", fontSize: "13px", background: "#10B981",
            border: "none", borderRadius: "6px", color: "#0A0F1E",
            fontFamily: "var(--font-jetbrains), monospace", fontWeight: 700,
            cursor: savingOutcome ? "not-allowed" : "pointer",
            opacity: savingOutcome ? 0.6 : 1,
            alignSelf: "flex-start",
          }}
        >
          {savingOutcome ? "Saving…" : "Save outcome"}
        </button>
      )}
    </div>
  </div>
)}

{/* ── Post-analysis nudge (free tier only, one-time per session) ── */}
{tier === "free" && !nudgeShown && (
  <div
    onMouseEnter={() => setNudgeShown(true)}
    style={{
      background: "#111827",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "8px",
      padding: "16px 20px",
      marginTop: "16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: "16px",
    }}
  >
    <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#9CA3AF", margin: 0 }}>
      Renewl Pro includes Slack alerts for every deadline, renewal savings tracking, and CSV export.
    </p>
    <a href="/pricing" style={{
      fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", fontWeight: 700,
      color: "#10B981", textDecoration: "none", whiteSpace: "nowrap",
    }}>
      Learn more →
    </a>
  </div>
)}
```

- [ ] **Update contract detail server page to pass tier and new fields**

In `app/(dashboard)/dashboard/contracts/[id]/page.tsx`, add `getUserTier` import and call, and add `annual_value`, `renewal_action`, `renewal_savings`, `original_renewal_price` to the contract select query. Also pass `tier` to `<ContractDetailClient>`.

Find the existing contract query (it selects `id, name, party_a, party_b, ...`). Add the new columns to the select string.

Find `<ContractDetailClient contract={contract} versionChain={chain} />` and add `tier={tier}`.

Also add `import { getUserTier } from "@/lib/subscription";` at top.

Add `const tier = await getUserTier(user.id);` after the auth check.

- [ ] **Update PATCH handler in `/api/contracts/[id]/route.ts` to accept `annual_value`**

In `app/api/contracts/[id]/route.ts`, if there is a PATCH handler, find it and ensure it passes `annual_value` through to the update. If only DELETE exists, add a PATCH handler:

```typescript
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contractId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only allow updating specific safe fields
  const allowed: Record<string, unknown> = {};
  if (typeof body.annual_value === "number") allowed.annual_value = body.annual_value;

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("contracts")
    .update(allowed)
    .eq("id", contractId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Run build**

```bash
npm run build 2>&1 | grep -E "^.*error" | head -10
```

- [ ] **Commit**

```bash
git add components/contracts/ContractDetailClient.tsx app/\(dashboard\)/dashboard/contracts/ app/api/contracts/\[id\]/route.ts
git commit -m "feat: annual_value display and renewal outcome section in contract detail"
```

---

### Task 14: DECISIONS.md entry 022 + Section 2 checkpoint

**Files:**
- Modify: `DECISIONS.md`

- [ ] **Add entry 022 to Decision Index table**

```
| 022 | Renewal savings tracking and dashboard | Active | Apr 2026 |
```

- [ ] **Add full entry 022 before "How to add a new entry"**

```markdown
### 022 — Renewal savings tracking and dashboard

**Status:** Active
**Date:** April 2026

**Context:**
To justify Pro pricing and drive retention, users need to see the financial impact of using Renewl. Four new columns track renewal outcomes: annual_value (what the contract costs yearly), renewal_action (what the user did), renewal_savings (result of negotiation or cancellation), original_renewal_price (vendor's ask before negotiation).

**Decision:**
- Schema: four nullable columns added to contracts. renewal_savings defaults to NULL (unknown), not 0.
- Extraction: annual_value added to EXTRACTION_TOOL as type ["number", "null"] — mandatory null union per Decision 019 to avoid extraction failures on contracts without visible pricing.
- Tier gating: SavingsSummary component accepts a tier prop and renders blurred placeholders with upgrade prompt for free users. No data fetch for free tier.
- profiles.plan check constraint expanded to include 'team' alongside 'free' and 'pro'.
- isNearExpiry() added to lib/utils.ts using identical UTC midnight normalisation as isExpired().
- SavingsSummary sits above UploadZone in dashboard; SpendSummary (spend by category) remains inside ContractList — they serve different purposes.

**Alternatives considered:**
- Gate analysis results for free users — rejected; analysis is already built and free users need to see value before upgrading
- Store savings in a separate table — rejected; single row per contract is simpler, savings is a contract-level fact

**Consequences:**
- Savings data is only as good as user input — zero savings shown until first renewal action is recorded
- annual_value must be tested on 10+ contracts before deploying Python changes (Decision 002)
- getUserTier() is the single source of tier truth across dashboard, upload zone, contract detail, and email
```

- [ ] **Run full Section 2 validation**

```bash
npm run build && npm run lint && npx jest
```

Expected: build passes, all tests pass.

- [ ] **Commit**

```bash
git add DECISIONS.md
git commit -m "docs: add decision 022 — renewal savings tracking"
```

---

## SECTION 3 — Homepage Repositioning

### Task 15: Update homepage copy

**Files:**
- Modify: `app/(marketing)/page.tsx`

- [ ] **Update page metadata**

Change:

```typescript
export const metadata: Metadata = {
  title: "Renewl — Contract Renewal Tracking for Small Teams",
  description:
    "AI-powered contract renewal tracking for ops and finance teams. Upload a PDF, confirm the dates, get email alerts before anything expires. Free for up to 20 contracts. No credit card.",
```

To:

```typescript
export const metadata: Metadata = {
  title: "Renewl — Stop Losing Money on Vendor Renewals",
  description:
    "AI-powered contract renewal tracking that shows you exactly how much you're saving. Upload a PDF, confirm the dates, get alerts before you lose negotiation windows. Free for 20 contracts.",
```

- [ ] **Update hero h1**

Change the text inside the `<h1>` from:

```
{`Your Salesforce contract expires ${HERO_EXPIRY_SHORT}. Your deadline was ${HERO_NOTICE_SHORT}.`}
```

To:

```tsx
Stop losing money on vendor renewals you forgot to renegotiate
```

- [ ] **Update hero subheadline**

Change the `<p className="hero-sub">` text to:

```
Companies waste $10,000–$35,000 a year on auto-renewals, missed notice windows, and unchallenged price increases. Renewl catches them before they cost you.
```

- [ ] **Add social proof line below hero (between hero section and first divider)**

After the closing `</section>` of the hero and before `<div className="divider"></div>`, add:

```tsx
{/* ── Social proof ── */}
<section style={{ padding: "24px 0", textAlign: "center" }}>
  <div className="wrap">
    <p style={{
      fontFamily: "var(--font-inter), sans-serif",
      fontSize: "14px",
      color: "#6B7280",
    }}>
      Built for ops and finance teams managing 10–100+ vendor contracts.
    </p>
    {/* TODO: Add real usage stats bar when aggregate numbers are meaningful */}
    {/* Revisit with ISR (revalidate: 3600) when system-wide contract count exceeds 1,000 */}
  </div>
</section>
```

- [ ] **Rewrite the three "How it works" step descriptions**

Find the three `<div className="step ...">` blocks. Keep their structure and numbers. Change only the titles and descriptions:

Step 1 (was "Upload your contract"):
```tsx
<div className="step-title">Never miss a notice window again</div>
<p className="step-desc">
  Tiered alerts at 60, 30, and 7 days track the notice period — not just the expiry date. Most contracts require 30–90 days to cancel or renegotiate. Miss that window and you&apos;re locked in.
</p>
```

Step 2 (was "AI extracts the dates"):
```tsx
<div className="step-title">Upload a PDF, get back money-saving intelligence</div>
<p className="step-desc">
  Expiry, renewal date, notice period, auto-renew clause, and annual value — all extracted and confidence-scored. Contract Intelligence flags risk clauses before they cost you.
</p>
```

Step 3 (was "Get alerts before it matters"):
```tsx
<div className="step-title">Know exactly how much you&apos;re saving</div>
<p className="step-desc">
  Record what happened at renewal. Renewl calculates your savings from renegotiations and cancellations and shows them in your savings dashboard.
</p>
```

- [ ] **Update final CTA section**

Find the `<section className="final-cta-section" ...>` at the bottom. Change the `<h2>` to:

```tsx
<h2 ...>
  How much are you losing to forgotten renewals?
</h2>
```

After `<FinalCtaButton />`, add:

```tsx
<p style={{ fontSize: "14px", color: "#6B7280", marginTop: "16px" }}>
  <a href="/resources/renewal-leak-calculator" style={{ color: "#10B981", textDecoration: "underline" }}>
    Calculate your renewal leak →
  </a>
</p>
<p style={{ fontSize: "13px", color: "#4B5563", marginTop: "8px" }}>
  Or start tracking for free — no credit card required.{" "}
  <a href="/login" style={{ color: "#10B981", textDecoration: "underline" }}>
    Get started →
  </a>
</p>
```

- [ ] **Run build**

```bash
npm run build && npm run lint
```

Expected: clean. Page is static (`○ /`).

- [ ] **Commit**

```bash
git add app/\(marketing\)/page.tsx
git commit -m "feat: homepage repositioning — savings and money framing"
```

---

## SECTION 4 — Conversion Nudges

### Task 16: Add `contracts_remaining` to upload API response + UploadZone tier prop

**Files:**
- Modify: `app/api/upload/route.ts`
- Modify: `components/dashboard/upload-zone.tsx`

- [ ] **Update upload route to return `contracts_remaining`**

In `app/api/upload/route.ts`, find the final success response (the one that returns `contract_id` and `detected_parties`). Before it, after the contract row is inserted, add a count query for free users. Change the final `NextResponse.json(...)` to include `contracts_remaining`:

Find the block where `profile.plan === 'free'` does the count check. Reuse the count logic after insert:

After the insert of the new contract succeeds (find the successful path), add:

```typescript
// Compute contracts_remaining for free-tier banner
let contracts_remaining: number | null = null;
if (profile.plan === 'free') {
  const { count: newCount } = await sessionClient
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('status', 'in', '("expired","renewed")');
  contracts_remaining = Math.max(0, 20 - (newCount ?? 0));
}
```

Then include it in the JSON response alongside `contract_id` and `detected_parties`.

- [ ] **Update UploadZone to accept `tier` prop and mount-fetch contract count**

In `components/dashboard/upload-zone.tsx`, change the component signature:

```typescript
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SubscriptionTier } from "@/lib/subscription";
```

Change:

```typescript
export default function UploadZone() {
```

To:

```typescript
export default function UploadZone({ tier }: { tier: SubscriptionTier }) {
```

Add `contractsRemaining` state after the existing state declarations:

```typescript
const [contractsRemaining, setContractsRemaining] = useState<number | null>(null);
```

Add mount fetch after the existing state hooks:

```typescript
useEffect(() => {
  if (tier !== "free") return;
  const supabase = createClient();
  supabase
    .from("contracts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", (async () => {
      // Can't use server user here — use auth session
      return null;
    })())
    .not("status", "in", '("expired","renewed")')
    .then(({ count }) => {
      setContractsRemaining(Math.max(0, 20 - (count ?? 0)));
    });
}, [tier]);
```

Wait — this won't work directly because we don't have `user_id` in the client component. The Supabase client browser client with RLS will automatically scope to the logged-in user, but `contracts` RLS uses `user_id = auth.uid()`. We can rely on RLS here:

```typescript
useEffect(() => {
  if (tier !== "free") return;
  const supabase = createClient();
  supabase
    .from("contracts")
    .select("*", { count: "exact", head: true })
    .not("status", "in", '("expired","renewed")')
    .then(({ count }) => {
      setContractsRemaining(Math.max(0, 20 - (count ?? 0)));
    });
}, [tier]);
```

Update `handleFile` to also update `contractsRemaining` after a successful upload:

In the success path (after `const { contract_id, detected_parties } = await res.json()`), add:

```typescript
const { contracts_remaining } = await res.json();
// ... existing code ...
if (typeof contracts_remaining === "number") {
  setContractsRemaining(contracts_remaining);
}
```

Note: `res.json()` is already called above — destructure `contracts_remaining` from the same call.

- [ ] **Add the amber warning banner**

In the upload zone's idle/error/limit_reached render (the outer `return (` block), add below the `<input>` and above the drop zone content:

```tsx
{/* Contracts remaining banner — only for free tier */}
{tier === "free" && contractsRemaining !== null && contractsRemaining <= 5 && contractsRemaining > 0 && (
  <div
    onClick={(e) => e.stopPropagation()}
    style={{
      position: "absolute",
      bottom: "-48px",
      left: 0,
      right: 0,
      background: "#111827",
      borderLeft: "3px solid #D97706",
      borderRadius: "0 0 6px 6px",
      padding: "8px 14px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}
  >
    <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#D1D5DB" }}>
      You have {contractsRemaining} free contract{contractsRemaining !== 1 ? "s" : ""} remaining.
    </span>
    <Link
      href="/pricing"
      onClick={(e) => e.stopPropagation()}
      style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#10B981", textDecoration: "underline", whiteSpace: "nowrap" }}
    >
      Upgrade to Pro →
    </Link>
  </div>
)}
```

Also update the `limit_reached` display to link to `/pricing` instead of `/dashboard/settings`:

Find:

```tsx
<Link
  href="/dashboard/settings"
  onClick={(e) => e.stopPropagation()}
  style={{ color: "#10B981", textDecoration: "underline" }}
>
  Upgrade to Pro →
</Link>
```

Change `href` to `"/pricing"` and update the surrounding text to:

```tsx
<p style={{ fontSize: "12px", color: "#F59E0B", marginTop: "8px" }}>
  You&apos;ve reached 20 contracts — the free tier limit.{" "}
  <Link
    href="/pricing"
    onClick={(e) => e.stopPropagation()}
    style={{ color: "#10B981", textDecoration: "underline" }}
  >
    See pricing →
  </Link>
</p>
```

- [ ] **Run build**

```bash
npm run build && npm run lint
```

Expected: clean.

- [ ] **Commit**

```bash
git add app/api/upload/route.ts components/dashboard/upload-zone.tsx
git commit -m "feat: upload zone contract count warning with mount-time fetch"
```

---

## SECTION 5 — Pricing-Anchored CTA Updates

### Task 17: Update blog CTAs

**Files to modify (all 7 blog pages):**
- `app/(marketing)/blog/cost-of-forgotten-renewals/page.tsx`
- `app/(marketing)/blog/ai-contract-risk-analysis/page.tsx`
- `app/(marketing)/blog/auto-renewal-clauses/page.tsx`
- `app/(marketing)/blog/vendor-notice-period-guide/page.tsx`
- `app/(marketing)/blog/renewl-vs-spreadsheet/page.tsx`
- `app/(marketing)/blog/page.tsx`

- [ ] **For each blog page, find the bottom CTA section**

The pattern across blog pages is a `<section>` near the end with a `<a href="/login" className="btn-solid">Try Renewl Free →</a>` or similar. In each file:

1. Find the CTA `<h2>` or tag div (usually "Get started free" or similar)
2. Change the CTA copy to:

```tsx
<h2 ...>Stop losing money on renewals you forgot about.</h2>
```

3. Change the CTA button/link to:

```tsx
<div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap", marginTop: "24px" }}>
  <a href="/" className="btn-solid" style={{ textDecoration: "none", display: "inline-block" }}>
    See how Renewl works →
  </a>
  <a href="/pricing" className="btn-outline" style={{ textDecoration: "none", display: "inline-block" }}>
    Check pricing →
  </a>
</div>
```

Do this for each blog page. The exact location varies per file — search for `btn-solid` or `href="/login"` near the bottom.

- [ ] **Run lint**

```bash
npm run lint 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add app/\(marketing\)/blog/
git commit -m "feat: update blog CTA copy to savings and pricing framing"
```

---

### Task 18: Update resources CTAs

**Files to modify (all resources pages):**
- `app/(marketing)/resources/renewal-leak-calculator/page.tsx`
- `app/(marketing)/resources/vendor-notice-period-guide/page.tsx`
- `app/(marketing)/resources/renewl-vs-spreadsheet/page.tsx`
- `app/(marketing)/resources/contract-renewal-tracker-template/page.tsx`
- `app/(marketing)/resources/saas-audit-checklist/page.tsx`
- `app/(marketing)/resources/saas-renewal-tracker/page.tsx`
- `app/(marketing)/resources/page.tsx`

- [ ] **For each resources page, find the bottom CTA and update**

Same approach as Task 17. Find the bottom CTA (search for `href="/login"` near bottom of each file). Replace CTA text and add pricing link:

```tsx
<p style={{ ... }}>
  Renewl does this automatically — and shows you exactly how much you&apos;re saving.
  Free for your first 20 contracts.{" "}
  <a href="/pricing" style={{ color: "#10B981", textDecoration: "underline" }}>
    See pricing →
  </a>
</p>
```

Keep the existing "Get started" button; add the pricing link as a secondary option below it.

- [ ] **Run build + lint**

```bash
npm run build && npm run lint
```

- [ ] **Commit**

```bash
git add app/\(marketing\)/resources/
git commit -m "feat: update resources CTA copy to savings and pricing framing"
```

---

## SECTION 6 — Annual Value on Contract Cards

### Task 19: Add `annualValue` to ContractCard and ContractList

**Files:**
- Modify: `components/dashboard/contract-card.tsx`
- Modify: `components/dashboard/contract-list.tsx`

- [ ] **Update `CardState` type in contract-card.tsx**

Find the `CardState` type. Add `annualValue?: number | null` to the `active` and `expired` variants:

```typescript
export type CardState =
  | { type: "processing" }
  | { type: "analyzing" }
  | { type: "party_review" }
  | { type: "draft"; unresolvedCount: number }
  | { type: "active"; urgency: "green" | "amber" | "red"; expiryDate: string | null; daysLeft: number | null; partyA: string | null; partyB: string | null; annualValue?: number | null }
  | { type: "expired"; expiryDate: string | null; partyA: string | null; partyB: string | null; annualValue?: number | null }
  | { type: "manual"; message: string };
```

- [ ] **Update `cardStateEqual` comparator to include `annualValue`**

Find the `cardStateEqual` function. Update the `active` and `expired` branches:

```typescript
if (a.type === "active" && b.type === "active") {
  return (
    a.urgency === b.urgency &&
    a.expiryDate === b.expiryDate &&
    a.daysLeft === b.daysLeft &&
    a.partyA === b.partyA &&
    a.partyB === b.partyB &&
    a.annualValue === b.annualValue   // ADD THIS LINE
  );
}
if (a.type === "expired" && b.type === "expired") {
  return (
    a.expiryDate === b.expiryDate &&
    a.partyA === b.partyA &&
    a.partyB === b.partyB &&
    a.annualValue === b.annualValue   // ADD THIS LINE
  );
}
```

- [ ] **Add annual value display in the card render**

Find where `partyA` / `partyB` is rendered in the `active` and `expired` state display. After the party names, add:

```tsx
{(state.type === "active" || state.type === "expired") && state.annualValue != null && (
  <span style={{
    fontFamily: "var(--font-jetbrains), monospace",
    fontSize: "11px",
    color: "#6B7280",
    marginLeft: "8px",
  }}>
    ${state.annualValue.toLocaleString()}/yr
  </span>
)}
```

- [ ] **Update ContractList to select and pass `annual_value`**

In `components/dashboard/contract-list.tsx`, find the Supabase query that fetches contracts (look for `.from("contracts").select(...)`). Add `annual_value` to the select string.

Find where the `ContractCard` `cardState` is computed for active and expired contracts. Add `annualValue: c.annual_value` to both states.

Also add `annual_value: number | null` to the `ContractRow` type (the interface/type that describes the shape of a fetched contract row).

- [ ] **Run build**

```bash
npm run build && npm run lint
```

- [ ] **Commit**

```bash
git add components/dashboard/contract-card.tsx components/dashboard/contract-list.tsx
git commit -m "feat: show annual value on contract cards"
```

---

## SECTION 7 — Email Template Updates

### Task 20: Update email templates + cron query

**Files:**
- Modify: `lib/email.ts`
- Modify: `app/api/cron/send-alerts/route.ts`

- [ ] **Add new fields to `AlertWithContext` type in `lib/email.ts`**

Find:

```typescript
export type AlertWithContext = {
  // ...
  contract_value: string | null;
  notice_period_days: number | null;
  email: string;
};
```

Add:

```typescript
export type AlertWithContext = {
  // ...
  contract_value: string | null;
  notice_period_days: number | null;
  email: string;
  annual_value: number | null;   // ADD
  user_plan: string | null;       // ADD
};
```

- [ ] **Add annual value line and tier CTA to `buildAlertEmail()`**

In `buildAlertEmail()`, find the `noticeBlock` variable. After it, add:

```typescript
const annualValueBlock =
  alert.annual_value != null
    ? `<p style="margin:16px 0 0;font-size:14px;color:#d1d5db;">
         <strong style="color:#ffffff;">This contract is worth $${alert.annual_value.toLocaleString()}/year.</strong>
         Missing the notice deadline could lock you in for another term.
       </p>`
    : "";

const isPro = alert.user_plan === "pro" || alert.user_plan === "team";
const tierCtaBlock = isPro
  ? `<p style="margin:24px 0 0;font-size:13px;color:#6b7280;">
       <a href="https://getrenewl.com/dashboard" style="color:#16a34a;text-decoration:underline;">View your savings dashboard →</a>
     </p>`
  : `<p style="margin:24px 0 0;font-size:13px;color:#6b7280;">
       Track all your renewal savings in one dashboard.
       <a href="https://getrenewl.com/pricing" style="color:#16a34a;text-decoration:underline;">Upgrade to Pro →</a>
     </p>`;
```

Find where the HTML body is assembled (look for the template literal with `noticeBlock`). Insert `${annualValueBlock}` after `${noticeBlock}` and `${tierCtaBlock}` just before the footer/closing `</div>`.

- [ ] **Update cron query to include `annual_value` and `plan`**

In `app/api/cron/send-alerts/route.ts`, find the Supabase select query:

```typescript
.select(`
  id, alert_type, scheduled_for, target_date,
  contract_id, user_id,
  contracts!inner ( name, expiry_date, renewal_date, auto_renew, party_a, party_b, contract_value, notice_period_days ),
  profiles!inner ( email )
`)
```

Change to:

```typescript
.select(`
  id, alert_type, scheduled_for, target_date,
  contract_id, user_id,
  contracts!inner ( name, expiry_date, renewal_date, auto_renew, party_a, party_b, contract_value, notice_period_days, annual_value ),
  profiles!inner ( email, plan )
`)
```

Note: `profiles!inner` joins on `profiles.id = alerts.user_id` — a direct FK join. Each alert row returns only its own user's plan. No cross-user data leakage is possible through this join structure.

- [ ] **Update `AlertRow` type and `buildAlertEmail` call**

Find the `AlertRow` type in the cron route:

```typescript
type AlertRow = {
  // ...
  contracts: {
    name: string; expiry_date: string | null; renewal_date: string | null;
    auto_renew: boolean | null; party_a: string | null; party_b: string | null;
    contract_value: string | null; notice_period_days: number | null;
  };
  profiles: { email: string };
};
```

Change to:

```typescript
type AlertRow = {
  // ...
  contracts: {
    name: string; expiry_date: string | null; renewal_date: string | null;
    auto_renew: boolean | null; party_a: string | null; party_b: string | null;
    contract_value: string | null; notice_period_days: number | null;
    annual_value: number | null;   // ADD
  };
  profiles: { email: string; plan: string | null };  // ADD plan
};
```

Find where `buildAlertEmail` is called and the `AlertWithContext` object is built. Add `annual_value` and `user_plan`:

```typescript
const alertCtx: AlertWithContext = {
  // ... existing fields ...
  annual_value: row.contracts.annual_value,
  user_plan: row.profiles.plan,
};
```

- [ ] **Run full validation**

```bash
npm run build && npm run lint && npx jest
```

Expected: all tests pass, clean build.

- [ ] **Commit**

```bash
git add lib/email.ts app/api/cron/send-alerts/route.ts
git commit -m "feat: enrich alert emails with annual value and tier-specific CTA"
```

---

## Final checkpoint

- [ ] **Run the complete test suite one final time**

```bash
npm run build && npm run lint && npx jest --verbose 2>&1 | tail -30
```

Expected: all tests pass, no build errors, no lint warnings.

- [ ] **Verify key routes in build output**

```bash
npm run build 2>&1 | grep -E "○|λ" | grep -E "pricing|dashboard|faq"
```

Expected:
- `○ /pricing` (static)
- `○ /faq` (static)
- `λ /dashboard` (dynamic — correct, force-dynamic is set)
