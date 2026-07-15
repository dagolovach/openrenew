# Renewl Profitability Improvements — Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Sections:** 7 — Pricing Page · Savings Dashboard · Homepage · Nudges · CTA Updates · Annual Value · Email

---

## Context

Renewl currently positions itself as "contract tracking." This work repositions it around "money saved / renewal leak prevention" to justify higher pricing and reach profitability. Changes span product, positioning, and pricing across 7 sections implemented in order.

**Clarifications resolved before this spec was written:**

- `getUserTier()` reads `profiles.plan` (not a new column). `'team'` added to check constraint via migration.
- Homepage social proof: Option B — static page, "Built for ops and finance teams managing 10–100+ vendor contracts." line + TODO comment. Decision 009 preserved.
- Dashboard: `SavingsSummary` (top, headline metrics) and `SpendSummary` (inside ContractList, spend breakdown) coexist as complementary views.

---

## Hard Rules (always follow)

- Inline styles only — no Tailwind classes
- Fonts via `var(--font-jetbrains)` / `var(--font-inter)` only
- Dark theme: bg `#0A0F1E`, surface `#111827`, accent `#10B981`
- All AI calls go to Python service — no Anthropic SDK in Next.js
- `sessionClient` for user DB ops; service role only for Storage signed URLs + cron
- Always add explicit `.eq('user_id', user.id)` alongside RLS
- AI output shown to users: "For informational purposes only. Not legal advice."
- `setInterval` banned — use `setTimeout` chains
- `maxDuration = 60` on `/api/confirm` is load-bearing — do not touch
- `counterparty_name` does not exist — use `party_a` / `party_b`
- `isExpired()` lives in `lib/utils.ts` — import, never duplicate
- Extraction responses are `tool_use` blocks (Decision 019)
- Nullable extraction fields: `["number", "null"]` not `"number"` alone
- Email templates: HTML inline `style` attributes only — no markdown, no CSS variables
- No fake data on marketing pages — real aggregates or nothing

---

## Section 1 — Pricing Page (`/pricing`)

### Goal
Create a public `/pricing` page. Currently pricing is only mentioned in the FAQ — this is the #1 conversion blocker.

### New files

**`app/(marketing)/pricing/page.tsx`** — Server component. Exports metadata (`title: "Pricing — Renewl"`, SEO description). Renders `<PricingCards>` as the only child.

**`app/(marketing)/pricing/PricingCards.tsx`** — `'use client'`. Holds billing toggle state (`useState<'monthly' | 'annual'>('monthly')`). Renders three-column card layout.

### Card structure

| | Free | Pro | Team |
|---|---|---|---|
| Price (monthly) | $0/mo | $59/mo | $149/mo |
| Price (annual) | — | $49/mo billed annually | $125/mo billed annually |
| Contracts | Up to 20 | Unlimited | Unlimited |
| AI extraction | ✓ | ✓ | ✓ |
| Contract Intelligence | ✓ | ✓ | ✓ |
| Email alerts (60/30/7 days) | ✓ | ✓ | ✓ |
| Slack alerts | — | ✓ | ✓ |
| Renewal savings dashboard | — | ✓ | ✓ |
| Team members | 1 | 1 | Up to 5 |
| CSV export | — | ✓ | ✓ |
| Priority support | — | — | ✓ |
| CTA | "Start free →" | "Get started →" | "Get started →" |

All CTAs link to `/login`. No "free trial" language anywhere.

### Design

- Cards: `#111827` background, `1px solid rgba(255,255,255,0.1)` border
- Pro card: `1px solid #10B981` border + "Most Popular" badge above card name
- Annual toggle: when annual selected, show crossed-out monthly price above discounted price
- Prices in `var(--font-jetbrains)`, body in `var(--font-inter)`
- 3-column on desktop (>1024px), single column stacked on mobile
- Fade-up CSS animation on scroll entry (no library — CSS keyframes + `data-reveal` pattern consistent with existing `RevealObserver`)
- Row below cards: "All plans include: 256-bit encryption · No training on your data · Cancel anytime"
- Mini-FAQ section: 4–5 items pulled from existing `/faq` content + new pricing entry

### Edits to existing files

**`components/marketing/marketing-nav.tsx`:**
Add `{ href: "/pricing", label: "Pricing", prefix: "/pricing" }` to `navLinks` array. Position: between Resources and FAQ.

**`app/(marketing)/page.tsx`** footer section:
Add Pricing link between FAQ and Free Tools links.

**`app/(marketing)/page.tsx`** JSON-LD offers array:
Update Pro price `"49"` → `"59"`. Add Team offer object.

**`app/(marketing)/faq/page.tsx`** JSON-LD:
Update any reference to `$49` → `$59 Pro / $149 Team`. Add new FAQ entry:
- Q: "How much does Renewl cost?"
- A: "Free for up to 20 contracts with email alerts and AI extraction. Pro is $59/month (or $49/month billed annually) for unlimited contracts, Slack alerts, and renewal savings tracking. Team is $149/month for up to 5 users. See full details on our pricing page."

**`app/(marketing)/faq/faq-accordion.tsx`:**
Update `plan` references: $49 → $59 Pro, add Team tier context. Add "How much does Renewl cost?" entry to visible accordion items.

**`DECISIONS.md`:**
Add entry 021 — Three-tier pricing with annual billing. Document: $59 Pro / $149 Team (up from $49 to improve unit economics), free tier stays at 20 contracts, freemium model only (no free trial).

### Constraints
- Do not use "free trial" anywhere on this page
- FAQ pricing updates must be done in this section to prevent price desync

---

## Section 2 — Renewal Savings Dashboard

### Goal
Show Pro/Team users how much money Renewl has saved them. Highest-leverage feature for retention and upsell. Free users see a locked/blurred preview.

### Tier utility

**`lib/subscription.ts`** (new):
```typescript
export type SubscriptionTier = 'free' | 'pro' | 'team';

export async function getUserTier(userId: string): Promise<SubscriptionTier>
```
- Reads `profiles.plan` via `sessionClient` with `.eq('id', userId)` (RLS + explicit filter)
- Maps `'pro'` → `'pro'`, `'team'` → `'team'`, anything else (null, unknown) → `'free'`
- Used by Sections 2, 4, 6, and 7 — build once here

### Schema migration

**`supabase/migrations/20260403000000_renewal_savings.sql`**:

```sql
-- Add 'team' to profiles.plan check constraint
ALTER TABLE profiles DROP CONSTRAINT profiles_plan_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'pro', 'team'));

-- Add renewal savings columns to contracts
ALTER TABLE contracts
  ADD COLUMN annual_value numeric,
  ADD COLUMN renewal_action text CHECK (renewal_action IN ('renewed', 'renegotiated', 'cancelled', 'pending')),
  ADD COLUMN renewal_savings numeric,
  ADD COLUMN original_renewal_price numeric;
```

Column notes:
- `annual_value`: annual cost, user-entered or AI-extracted
- `renewal_action`: what the user did at renewal time
- `renewal_savings`: NULL by default — unknown savings until user records an action. Only set when action is recorded.
- `original_renewal_price`: vendor's proposed price before negotiation
- Existing RLS policies on `contracts` apply at row level — new columns are automatically covered. Confirm by reading existing migration files before applying.

### Python service — new extraction field

**`python-service/main.py`** — add to `EXTRACTION_TOOL.input_schema.properties`:
```python
"annual_value": {
    "type": ["number", "null"],
    "description": "The total annual value or cost of this contract in the base currency. If the contract shows a monthly rate, multiply by 12. Return null if no monetary value is found."
}
```

**Critical:** type must be `["number", "null"]` — forced tool call (Decision 019) rejects null values for `"type": "number"`, causing extraction failures on contracts without visible pricing.

Test on 10+ real contracts before deploying (Decision 002).

### SavingsSummary component

**`components/dashboard/SavingsSummary.tsx`** — `'use client'` (follows existing pattern: `SpendSummary`, `ContractCard`, etc. all live in `components/dashboard/`):

Props: `{ tier: SubscriptionTier, userId: string }`

**Free tier behavior:** Render four cards with blurred/placeholder values and a lock icon overlay. Show: "Unlock your renewal savings dashboard — [Upgrade to Pro →](/pricing)". Do not fetch real data for free users.

**Pro/Team behavior:** Fetch from Supabase and render four metric cards:

1. **Total Savings** — `SUM(renewal_savings)` where `renewal_action IN ('renegotiated', 'cancelled')` AND `renewal_savings IS NOT NULL`. Format as `$X,XXX`. Green number.
2. **Contracts Managed** — count of contracts where `status NOT IN ('expired', 'renewed')` for this user
3. **Alerts Sent** — count of alerts where `sent_at IS NOT NULL` for this user
4. **Renewals Actioned** — count of contracts where `renewal_action IS NOT NULL`

If total savings is $0 for Pro/Team: show "Start tracking savings — mark your first renewal action on any contract" instead of "$0".

**Design:** 4 cards in a row (2×2 on mobile). `#111827` bg, subtle border, inline SVG icon left, number in `var(--font-jetbrains)`, label in `var(--font-inter)`. Total Savings card gets `#10B981` left border accent.

**Dashboard placement:** Add `<SavingsSummary>` above the upload zone in `app/(dashboard)/dashboard/page.tsx`. Requires `getUserTier()` call in the server component to pass `tier` prop — avoids a client-side fetch for tier on every dashboard load. The same `tier` value is also passed to `<UploadZone tier={tier}>` so Nudge 1 (Section 4) can skip the mount fetch for pro/team users. One `getUserTier()` call, two consumers.

### Contract detail — renewal outcome section

**In `ContractDetailClient`** (contract detail page):

Show "Renewal outcome" section when `isExpired(contract)` OR `isNearExpiry(contract.expiry_date, 90)`.

**`lib/utils.ts`** — add alongside `isExpired()`:
```typescript
export function isNearExpiry(expiryDate: string | null, daysThreshold: number = 90): boolean
```
Uses same UTC midnight normalisation as `isExpired()`. Returns false if `expiryDate` is null.

UI elements:
- Dropdown: "What did you do?" → Renewed at same price / Renegotiated / Cancelled / Still deciding
- If Renegotiated: input for "Original renewal price" + auto-calculated savings (`original_renewal_price - annual_value`); user can override
- If Cancelled: savings = `annual_value` (full value saved)
- Save button → `POST /api/contracts/[id]/renewal-action`

### API route

**`app/api/contracts/[id]/renewal-action/route.ts`** — POST:
1. Parse and validate `id` as UUID (reject malformed IDs with 400 before any DB query)
2. Auth: `sessionClient.auth.getUser()` — 401 if unauthenticated
3. Ownership: `.from('contracts').select('id').eq('id', id).eq('user_id', user.id).single()` — 404 if not found
4. Body validation: `renewal_action` must be one of `['renewed', 'renegotiated', 'cancelled', 'pending']` — 400 if invalid
5. Update contract row: `renewal_action`, `renewal_savings`, `original_renewal_price`
6. Insert to `activity_log`: `event_type: 'renewal_action_recorded'`, `contract_id`, `user_id`
7. Return updated contract fields

### Tests

**`__tests__/api/renewal-action.test.ts`:**
- Rejects invalid UUID (400)
- Rejects unauthenticated request (401)
- Rejects request where contract belongs to different user (404)
- Rejects invalid `renewal_action` value (400)
- Accepts valid input, updates contract, returns 200

**`__tests__/lib/subscription.test.ts`:**
- Returns `'pro'` for `plan = 'pro'`
- Returns `'team'` for `plan = 'team'`
- Returns `'free'` for `plan = 'free'`
- Returns `'free'` for `plan = null`
- Returns `'free'` for unknown plan value

**`DECISIONS.md`:** Add entry 022 — Renewal savings tracking and dashboard. Document: schema additions (NULL default on `renewal_savings`), `["number", "null"]` type for `annual_value` extraction field, savings calculation logic, tier gating built into component from day one, `isNearExpiry()` addition, `profiles.plan` check constraint updated to include `'team'`.

---

## Section 3 — Homepage Repositioning

### Goal
Shift copy from "track contracts" to "prevent renewal leakage and save money." Structural layout unchanged.

### Edits to `app/(marketing)/page.tsx` only

**Metadata:**
- `title`: "Renewl — Stop Losing Money on Vendor Renewals"
- `description`: updated for savings positioning

**Hero h1:**
`"Stop losing money on vendor renewals you forgot to renegotiate"`

**Hero subhead (`hero-sub`):**
`"Companies waste $10,000–$35,000 a year on auto-renewals, missed notice windows, and unchallenged price increases. Renewl catches them before they cost you."`

**Social proof line (new — below hero, above divider):**
```
"Built for ops and finance teams managing 10–100+ vendor contracts."
// TODO: Add real usage stats bar when aggregate numbers are meaningful
//       Revisit with ISR (revalidate: 3600) when system-wide contract count exceeds 1,000
```
Static text only — no Supabase query. Decision 009 preserved.

**Value props (rewrite copy, keep structure):**
1. "Never miss a notice window again" — 60/30/7-day tiered alerts copy
2. "Upload a PDF, get back money-saving intelligence" — extraction + Contract Intelligence risk flags copy
3. "Know exactly how much you're saving" — renewal savings dashboard copy

**Final CTA section:**
- h2: `"How much are you losing to forgotten renewals?"`
- Add link: `"Calculate your renewal leak → /resources/renewal-leak-calculator"`
- Secondary: `"Or start tracking for free — no credit card required. → /login"`

**JSON-LD offers:**
- Pro price: `"49"` → `"59"`
- Add Team offer: `{ "@type": "Offer", name: "Team", price: "149", priceCurrency: "USD", description: "Up to 5 users, unlimited contracts, Slack alerts, priority support", billingDuration: "P1M" }`

**Do NOT change:**
- Pain section (incident cards with dollar amounts)
- "How it works" steps
- Trust / human-in-the-loop section
- Any CSS classes, animations, or layout

---

## Section 4 — Conversion Nudges

### Goal
Contextual upgrade prompts at natural friction points for free users. Core features remain ungated.

### Nudge 1: Contract limit warning

**`app/api/upload/route.ts`:**
Add `contracts_remaining` to successful upload response. For free users: `20 - newCount`. For pro/team: `null`.

**`components/dashboard/upload-zone.tsx`:**
- On component mount: fetch contract count from Supabase client (free users only — skip if tier is pro/team). Store as `contractsRemaining` state.
- On successful upload: update `contractsRemaining` from upload response (avoids a re-fetch).
- When `contractsRemaining <= 5`: show amber banner below upload area: "You have {n} free contracts remaining. [Upgrade to Pro →](/pricing) for unlimited contracts."
- When `contractsRemaining === 0`: existing block message + "You've reached 20 contracts — the free tier limit. [See pricing →](/pricing)"
- Banner style: `#D97706` left border, `#111827` background, `var(--font-inter)` text

The mount-time fetch means the warning is visible the moment users land on the dashboard, not only after a successful upload.

### Nudge 2: Post-analysis upsell

**In contract detail client component:**
- Analysis results shown normally (analysis is a free feature — do not gate it)
- After first render of completed analysis, if `tier === 'free'`: show subtle card below analysis: "Renewl Pro includes Slack alerts for every deadline, renewal savings tracking, and CSV export. [Learn more →](/pricing)"
- One-time per session: `const [nudgeShown, setNudgeShown] = useState(false)` — set to true after first view. No sessionStorage.
- Component renders nothing for `tier !== 'free'`

### Implementation notes
- Import `getUserTier` from `lib/subscription.ts` (built in Section 2)
- All nudge components accept `tier: SubscriptionTier` prop
- Never block access to extraction, analysis, or alerts
- The savings dashboard blur for free users is in `SavingsSummary.tsx` (Section 2) — do not rebuild it here

---

## Section 5 — Pricing-Anchored CTA Updates

### Goal
Update CTAs on resources and blog pages to reference pricing and savings positioning.

### Edits

**All pages under `app/(marketing)/resources/`** — update bottom CTA text to:
`"Renewl does this automatically — and shows you exactly how much you're saving. Free for your first 20 contracts. [See pricing →](/pricing)"`

**All pages under `app/(marketing)/blog/`** — update bottom CTA text to:
`"Stop losing money on renewals you forgot about. [See how Renewl works →](/) or [check pricing →](/pricing)"`

**Navigation/footer:** Already handled in Section 1.
**FAQ:** Already handled in Section 1.

---

## Section 6 — Annual Value Display on Contract Cards

### Goal
Make financial stakes visible everywhere contracts appear.

### Edits

**`components/dashboard/contract-card.tsx`:**
- Add `annualValue?: number | null` to `active` and `expired` variants of `CardState`
- When `annualValue` is set: display `"$12,400/yr"` below contract title in `var(--font-jetbrains)` with muted color (`#6B7280`)
- When `annualValue` is null/undefined: display nothing
- Update `cardStateEqual` comparator to include `annualValue` in the `active` and `expired` branches

**`components/dashboard/contract-list.tsx`:**
- Select `annual_value` in the contracts query
- Pass `annualValue: contract.annual_value` through to `ContractCard` state

**Contract detail page:**
- Display `annual_value` in the detail fields if extracted
- If not extracted: show editable input "Annual contract value: $____" with helper text "Adding this helps track your renewal savings"
- Save via existing contract update mechanism (existing `PATCH /api/contracts/[id]` or equivalent)

---

## Section 7 — Email Template Updates

### Goal
Add savings context and tier-specific CTAs to alert emails.

### Edits

**`lib/email.ts`:**

Add to `AlertWithContext` type:
```typescript
annual_value: number | null;
user_plan: string | null;
```

In `buildAlertEmail()`, after the detail rows table, before footer:
- If `annual_value` is set: insert `<strong style="color: #ffffff;">This contract is worth $X/year.</strong> Missing the notice deadline could lock you in for another term.`
- At bottom of every alert email, tier-specific CTA:
  - Free (`user_plan !== 'pro' && user_plan !== 'team'`): `Track all your renewal savings in one dashboard. <a href="https://getrenewl.com/pricing" style="color: #16a34a; text-decoration: underline;">Upgrade to Pro →</a>`
  - Pro/Team: `<a href="https://getrenewl.com/dashboard" style="color: #16a34a; text-decoration: underline;">View your savings dashboard →</a>`

Style rules: HTML inline `style` only. Green: `#16a34a`, Amber: `#d97706`, Red: `#dc2626`. No CSS variables.

**`app/api/cron/send-alerts/route.ts`:**

Update Supabase select query to include:
- `annual_value` from `contracts`
- `plan` from `profiles`

The existing join uses the admin client (correct — cross-user cron query). The join condition on `profiles!inner` already implicitly filters by `user_id` through the FK relationship, but add explicit `.eq('alerts.user_id', ...)` filtering is not needed at the outer query level since we're iterating all pending alerts. **However:** the `profiles!inner` join is on `profiles.id = alerts.user_id` — this is a direct FK join, not a cross-user scan. Each alert row returns only its own user's plan. No cross-user data leakage is possible here. Document this explicitly in a code comment at the join site.

Update `AlertRow` type to include `annual_value: number | null` and `profiles: { email: string; plan: string | null }`.

Pass `annual_value` and `user_plan` through to `buildAlertEmail()`.

---

## Execution Order & Validation

After each section:
```bash
npm run build   # no build errors
npm run lint    # no lint issues
npx jest        # existing + new tests pass
```

Order: 1 → 2 → 3 → 4 (requires Section 2 for `getUserTier`) → 5 (requires Section 1 for `/pricing`) → 6 (requires Section 2 for `annual_value` column) → 7 (requires Sections 1 + 2)

---

## DECISIONS.md Entries to Add

| # | Title | When |
|---|-------|------|
| 021 | Three-tier pricing with annual billing | End of Section 1 |
| 022 | Renewal savings tracking and dashboard | End of Section 2 |
