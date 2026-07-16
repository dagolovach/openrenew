# OpenRenew — Architecture & Product Decisions

> This file records significant decisions made during the design and build of OpenRenew
> (originally built as Renewl, a SaaS, then open-sourced for self-hosting — see 024).
> It answers "why does it work this way?" — the git log answers "what changed?"
>
> **When to add an entry:** any time you make a choice that a future engineer might
> question, reverse, or need to understand before touching that part of the system.
> Takes 3 minutes. Saves hours.

---

## Decision Index

| # | Title | Status | Date |
|---|-------|--------|------|
| 001 | Python microservice for PDF processing | Active | Mar 2026 |
| 002 | Sonnet for extraction, Haiku for analysis | Active | Mar 2026 |
| 003 | Anthropic SDK direct | Active | Mar 2026 |
| 004 | No Tailwind — inline styles throughout | Active | Mar 2026 |
| 005 | Supabase over Neon | Superseded by 024 | Mar 2026 |
| 006 | party_a / party_b replacing counterparty_name | Active | Mar 2026 |
| 007 | Dark theme only in v1 | Active | Mar 2026 |
| 008 | Stripe Customer Portal over custom billing UI | Superseded by 024 | Mar 2026 |
| 009 | Static landing page | Active | Mar 2026 |
| 010 | Async extraction, awaited analysis | Active | Mar 2026 |
| 011 | Free tier capped at 20 contracts | Superseded by 024 | Mar 2026 |
| 012 | Single confidence float per extraction | Active | Mar 2026 |
| 013 | Dashboard FCP fix deferred | Deferred | Mar 2026 |
| 014 | Slack webhook UI deferred | Deferred | Mar 2026 |
| 015 | getrenewl.com domain choice | Active | Mar 2026 |
| 016 | Next.js 16 + React 19 over planned 14/18 | Active | Mar 2026 |
| 017 | JetBrains Mono + Inter only — Geist removed | Active | Mar 2026 |
| 018 | Date order warnings are advisory — never block | Active | Mar 2026 |
| 019 | Forced tool call for extraction schema | Active | Mar 2026 |
| 020 | INP performance partial fix — FCP deferred | Active | Mar 2026 |
| 021 | Three-tier pricing with annual billing | Active | Apr 2026 |
| 022 | Renewal savings tracking and dashboard | Superseded | Apr 2026 |
| 023 | Renewal savings tracking deferred to compare flow | Active | Apr 2026 |
| 024 | OpenRenew self-hosted conversion | Active | Jul 2026 |
| 025 | Triage-first home screen and iCal feed | Active | Jul 2026 |

---

## Decisions

---

### 001 — Python microservice for PDF processing

**Status:** Active (platform changed Railway → Docker container, see 024)
**Date:** March 2026

**Context:**
PDF text extraction (pdfplumber) and Claude API calls needed to run server-side. Next.js API routes on Vercel have a 10s execution limit (60s with `maxDuration`) — not reliable enough for PDF parsing on large contracts. A separate service also keeps Python AI dependencies out of the Node.js tree, and Railway deploys Python with no friction.

**Decision:**
All PDF processing and Claude API calls run in a Python FastAPI microservice on Railway. Next.js API routes are thin orchestrators — they generate signed URLs, call the Python service, and write results to Supabase. Python service is stateless: no Supabase credentials.

**Alternatives considered:**
- Vercel Edge Functions — no Python support
- Serverless Python on AWS Lambda — added deployment complexity for a solo project
- Claude API calls directly from Next.js — rejected to centralise AI logic and avoid Node.js Anthropic SDK dependency

**Consequences:**
- Two services to deploy and monitor (Vercel + Railway)
- Python service auth must be maintained (`Authorization: Bearer <EXTRACTION_SERVICE_SECRET>`)
- Any new AI feature must be added to `python-service/main.py`, not to `app/api/`
- SSRF protection lives in the Python service — keep it when adding new URL-fetching endpoints

---

### 002 — Sonnet for extraction, Haiku for analysis

**Status:** Active
**Date:** March 2026

**Context:**
Two distinct AI tasks with different quality requirements: field extraction (precise, structured, schema-bound) and risk analysis (narrative, heuristic). Early plan docs suggested Haiku for extraction, but testing showed Sonnet produced meaningfully better structured output on edge-case contracts.

**Decision:**
- **Extraction:** `claude-sonnet-4-6` — configurable via `AI_MODEL` env var, defaulting to `claude-sonnet-4-6`. Higher accuracy justified by the low volume per user.
- **Analysis (Contract Intelligence):** `claude-haiku-4-5-20251001` — hardcoded as `ANALYSIS_MODEL` in `python-service/main.py`. Risk analysis is a best-effort narrative pass; Haiku's cost and speed advantage is material here.

**Alternatives considered:**
- Haiku for extraction — originally planned, rejected after testing showed accuracy drop on ambiguous date formats and multi-party contracts
- Sonnet for analysis — identical output quality in testing, 10–15× more expensive, no user-facing benefit

**Consequences:**
- Extraction cost is higher than the original plan assumed — still negligible at current scale
- If accuracy problems emerge with Sonnet, upgrade path is a one-line `AI_MODEL` env var change
- If Haiku accuracy is insufficient for analysis, upgrade path is changing `ANALYSIS_MODEL` constant in `python-service/main.py`
- Do not swap the models without testing on 10+ real contracts first

---

### 003 — Anthropic SDK direct

**Status:** Active
**Date:** March 2026

**Decision:**
All Claude API calls go through the `anthropic` Python SDK (`anthropic>=0.40.0`). `python-service/main.py` imports `anthropic` and instantiates `anthropic.Anthropic()` directly. Model strings use the native format (e.g. `claude-sonnet-4-6`).

**Consequences:**
- Tool use (`tool_choice: {type: "tool", name: "..."}`) works reliably with the native SDK
- No abstraction layer between the code and the API

---

### 004 — No Tailwind — inline styles throughout

**Status:** Active
**Date:** March 2026

**Context:**
The app uses a custom dark theme with precise colour values (`#0A0F1E`, `#111827`, `#10B981` etc.). Tailwind is installed as a devDependency (it was in the original scaffold plan) but was never applied in practice — the decision was made to use inline styles instead.

**Decision:**
All styles are written as inline style objects in Next.js components. No Tailwind, no CSS modules, no styled-components. Tailwind remains in devDependencies but produces no output in the compiled app.

**Alternatives considered:**
- Tailwind — rejected due to dark theme control complexity and the overhead of configuring purge/JIT for a small, dark-only design system
- CSS modules — would work, but inline styles keep component code self-contained, which is better for Claude Code sessions that need to read and modify a single file

**Consequences:**
- Verbose component files — style objects are inline alongside JSX
- No responsive utility classes — breakpoints must be written manually
- Design is precisely controlled — no accidental class overrides
- **Hard rule:** never add Tailwind utility classes to dashboard, review, or contract detail pages without migrating all inline styles first

---

### 005 — Supabase over Neon for database, auth, and storage

**Status:** Superseded by 024
**Date:** March 2026

**Context:**
Needed Postgres + auth + file storage in a single service. The alternative was Neon (Postgres only) + a separate auth provider (Clerk/Auth0) + a separate storage service (S3/R2). Three billing relationships and three configuration surfaces for a solo v1 project.

**Decision:**
Supabase for everything — Postgres, Auth (Google OAuth + Magic Link), and Storage (private `contracts` bucket with signed URL access).

**Alternatives considered:**
- Neon + Clerk + S3 — more composable but three vendors to configure, three billing relationships, more complexity for negligible benefit at this scale
- PlanetScale — MySQL, not Postgres; ruled out immediately
- Firebase — NoSQL, worse fit for relational contract data

**Consequences:**
- Single vendor dependency for critical infrastructure
- Supabase Storage signed URL expiry (600s) is a known limitation on the review screen — very long reviews may find the PDF URL expired
- RLS is enabled on all tables but must be paired with explicit `.eq('user_id', user.id)` on queries as defence-in-depth
- If migrating off Supabase: auth migration is the hard part; Postgres data is standard SQL and portable

---

### 006 — party_a / party_b replacing counterparty_name

**Status:** Active
**Date:** March 2026

**Context:**
Initial schema used a single `counterparty_name` field. In practice, contracts involve two named legal entities and displaying both is more informative. The term "counterparty" also implies a perspective (us vs them) that doesn't fit all contract categories — employment contracts, for example, don't have a "counterparty."

**Decision:**
Replace `counterparty_name` with `party_a` (vendor/supplier/lessor/employer) and `party_b` (customer/tenant/employee). Both are extracted by Claude and shown in UI with a `↔` separator. Migration: `supabase/migrations/20260321200000_party_a_party_b.sql`.

**Alternatives considered:**
- Keep `counterparty_name` — rejected, loses information; one-field approach is ambiguous for two-party display
- Add `our_company_name` — deferred; users know their own company name, this adds extraction complexity for low UX gain

**Consequences:**
- Migration applied post-launch — any session resuming from old schema history must know `counterparty_name` no longer exists; do not reference it
- Claude extraction prompt defines party_a and party_b roles explicitly to avoid role-assignment errors

---

### 007 — Dark theme only in v1

**Status:** Active
**Date:** March 2026

**Context:**
Target users are ops managers and finance leads — professional context, desktop-primary. A dark terminal aesthetic was chosen to differentiate from generic SaaS tools and reinforce "serious operations software" positioning.

**Decision:**
Dark only in v1. No light mode toggle. Background: `#0A0F1E`. If users request light mode in feedback, add toggle in v2.

**Alternatives considered:**
- System-preference-based theme (`prefers-color-scheme`) — adds CSS variable complexity and doubles the amount of colour values to maintain, for zero v1 benefit
- Light mode default — rejected; contradicts brand positioning

**Consequences:**
- Simpler CSS (no theme switching logic)
- `marketing.css` uses `#00c9a0` (slightly different green vs app's `#10B981`) — known inconsistency, low priority fix
- Email templates use hardcoded hex colours (`#16a34a`, `#d97706`, `#dc2626`) — CSS variables are stripped by email clients

---

### 008 — Stripe Customer Portal over custom billing UI

**Status:** Superseded by 024
**Date:** March 2026

**Context:**
Building a custom subscription management UI (upgrade, downgrade, cancel, update payment method, view invoices) is significant frontend work with high surface area for billing bugs. Stripe's hosted Customer Portal handles all of this with zero UI code required.

**Decision:**
Use Stripe Customer Portal for all subscription management. Renewl's UI shows a single "Manage billing" button that generates a portal session server-side and redirects to it. No custom billing screens.

**Alternatives considered:**
- Custom billing UI — weeks of work for table-stakes functionality; Stripe's portal is production-hardened
- Paddle — would have worked, but Stripe was already the chosen processor

**Consequences:**
- Stripe-branded portal UI — acceptable at a $49/month price point
- Portal URL is session-specific — generated server-side on each click, not stored anywhere
- Stripe webhook handler (`/api/webhooks/stripe`) must stay in sync with portal-triggered subscription events

---

### 009 — Static landing page

**Status:** Active
**Date:** March 2026

**Context:**
Landing page initially rendered dynamically (server component fetching Supabase session on every request), causing ~1.86s FCP. The page has no user-specific content — it doesn't need to be dynamic.

**Decision:**
Move the Supabase auth check out of the landing page component and into the middleware cookie check. Result: `○ /` in Vercel build output — fully static, CDN-served. Landing page FCP dropped to ~0.5s.

**Alternatives considered:**
- Keep dynamic, optimise with ISR — rejected; static is strictly better for a marketing page with no user-specific content

**Consequences:**
- Landing page serves from Vercel CDN globally with no cold-start latency
- Any personalised content on the landing page (e.g. "Welcome back, {name}") would require reverting to dynamic — avoid

---

### 010 — Async extraction with polling; awaited analysis from confirm

**Status:** Active (`maxDuration` no longer applies outside Vercel — see 024)
**Date:** March 2026

**Context:**
Initial plan called for fire-and-forget on all AI calls. In practice, two different AI operations have different latency profiles and UX requirements:
- **Extraction** (pdfplumber + Sonnet): 5–30s, returns before user reaches review screen if started immediately after upload
- **Analysis** (Haiku risk analysis): 3–15s, must be triggered after confirmation, result needed on the contract detail page

The confirm route has `maxDuration = 60`, making it safe to await analysis there.

**Decision:**
- **Extraction** (`/api/extract`): async — returns `contract_id` immediately, frontend polls for status changes every 3 seconds. User falls back to manual entry if extraction fails or times out.
- **Analysis** (`triggerAnalysis()` called from `/api/confirm`): awaited with `.catch()` to swallow errors without breaking the confirm response. Analysis completes within the 60s `maxDuration`. Contract detail page polls `GET /api/analyse?contract_id=` at 3s intervals with a 60s client-side timeout.

**Alternatives considered:**
- Server-sent events / websockets — more elegant but adds infrastructure complexity not justified at current scale
- Background job queue (e.g. BullMQ, Inngest) — overkill; Railway + Vercel `maxDuration` is sufficient

**Consequences:**
- Polling logic required in every component waiting for AI results
- `maxDuration = 60` on `/api/confirm` is load-bearing — do not remove it
- If analysis regularly exceeds 60s (large contracts, slow model), move to true background queue

---

### 011 — Free tier capped at 20 contracts

**Status:** Superseded by 024
**Date:** March 2026

**Context:**
Needed a free tier to reduce signup friction, but with a limit that creates natural upgrade pressure. 20 contracts covers a typical early-stage company's core vendor stack without being enough for a mid-size ops team that manages 30–100+ contracts.

**Decision:**
Free: up to 20 contracts, email alerts, AI extraction — no credit card required.
Pro: $49/month, unlimited contracts. Slack alerts and CSV export planned for Pro (not yet implemented).

**Alternatives considered:**
- 5 contracts — too restrictive; users can't evaluate the product meaningfully
- Unlimited free — no upgrade trigger
- Per-contract pricing — adds friction and billing unpredictability for users

**Consequences:**
- Limit enforcement lives in `/api/upload` — check count before creating contract row
- Validate the 20-contract threshold with beta users before tightening or loosening

---

### 012 — Single confidence float per extraction

**Status:** Active (per-field confidence deferred to v1.1)
**Date:** March 2026

**Context:**
`contract_extractions` stores per-field rows, so per-field confidence is structurally possible. However, the review UI colour-codes the entire extraction based on a single threshold (green ≥0.90, amber 0.70–0.89, red <0.70), and the extraction prompt returns one overall `confidence` float. Building per-field confidence requires a more complex prompt schema and more nuanced UI.

**Decision:**
Single `extraction_confidence` float on the `contracts` table for v1. Per-field confidence deferred — the `contract_extractions.confidence` column exists in the schema for future use but is not yet populated per-field by the AI.

**Alternatives considered:**
- Per-field confidence from day one — builds the correct schema immediately but more complex prompt and UI work; deferred as premature

**Consequences:**
- All fields receive the same confidence colour in the review screen regardless of per-field quality
- Migration needed when per-field confidence is implemented to populate `contract_extractions.confidence`

---

### 013 — Dashboard FCP fix deferred

**Status:** Deferred
**Date:** March 2026

**Context:**
Dashboard FCP is 6.25s. Root cause is likely a blocking Supabase query on page load. Fixing properly requires profiling the server component waterfall and potentially restructuring RSC data fetching.

**Decision:**
Defer until first 10 paying customers. Landing page performance matters for acquisition; dashboard performance matters for retention. Fix it when retention becomes the metric that matters.

**When to revisit:** When monthly churn increases, users cite slowness in feedback, or paying customer count reaches 10.

---

### 014 — Slack webhook UI deferred

**Status:** Deferred
**Date:** March 2026

**Context:**
`slack_webhook_url` is stored in `profiles` and the cron handler has the infrastructure to send Slack alerts — but actual Slack delivery is not wired in the cron job, and there is no settings UI for users to enter their webhook URL. Currently set directly via Supabase dashboard for beta users.

**Decision:**
Defer Slack webhook settings UI and Slack cron delivery until first paying Pro customer requests it. Email delivery covers the core value proposition.

**When to revisit:** When first paying Pro customer asks how to configure Slack alerts.

---

### 015 — getrenewl.com domain choice

**Status:** Active
**Date:** March 2026

**Context:**
`renewly.com` was taken. `renewl.io` was available ($35) but switching from an already-registered domain wasn't worth the disruption. `renewlyapp.com` exists but is a consumer iPhone app for personal subscriptions — zero overlap, not a brand conflict.

**Decision:**
Keep `getrenewl.com`. Use "Renewl" as the product name throughout.

**Consequences:**
- Minor brand/domain mismatch (product is "Renewl", domain is "getrenewl") — acceptable at this stage
- `APP_URL=https://getrenewl.com` is hardcoded in several email templates — update in one place if domain changes

---

### 016 — Next.js 16 + React 19 over originally planned 14/18

**Status:** Active
**Date:** March 2026

**Context:**
Original scaffolding plan targeted Next.js 14 (the stable LTS at the time of planning). By the time the app was built, Next.js 16.2.1 with React 19 was available and provided better App Router stability and React Server Components improvements.

**Decision:**
Use Next.js 16.2.1 + React 19.2.4. The scaffolding plan's references to "Next.js 14" are outdated and should be read as referring to the App Router pattern, not the version number.

**Consequences:**
- Plan docs reference "Next.js 14" in their Tech Stack sections — ignore those version numbers, the pattern (App Router, RSC, Route Handlers) is the same
- React 19 concurrent features are available but not yet explicitly used — no risk, but be aware when reading React 18-era docs

---

### 017 — JetBrains Mono + Inter only — Geist removed

**Status:** Active
**Date:** March 2026

**Context:**
Initial scaffold used Next.js defaults (Geist + Geist_Mono). These were replaced to better match the brand aesthetic: JetBrains Mono for code/monospace elements (reinforces the terminal/ops tool identity) and Inter for body text (clean, professional).

**Decision:**
Load only JetBrains Mono and Inter via `next/font`. Geist and Geist_Mono are removed. Font CSS variables are `var(--font-jetbrains)` and `var(--font-inter)` — never reference literal font names in inline styles.

**Alternatives considered:**
- Geist — Next.js default, zero config, but doesn't match brand aesthetic
- System font stack — no font requests but loses the JetBrains Mono identity

**Consequences:**
- Two font requests on every page load (already minimised by next/font preloading)
- All new components must use `var(--font-jetbrains)` or `var(--font-inter)`, never hardcoded font names

---

### 018 — Date order warnings are advisory — never block confirmation

**Status:** Active
**Date:** March 2026

**Context:**
AI extraction sometimes returns dates in unusual order (e.g. effective_date after expiry_date) due to OCR ambiguity or unconventional contract formatting. Blocking confirmation on these warnings would frustrate users with unusual-but-valid contracts.

**Decision:**
`validateDateOrder()` in `lib/utils.ts` surfaces inline amber/red warnings on the review screen, but never prevents confirmation. Anomalies are logged to `activity_log` server-side for extraction quality observability.

**Consequences:**
- Users can confirm contracts with date order anomalies — downstream alert logic handles null/edge-case dates gracefully
- `activity_log` rows with `event_type: 'date_order_warning'` can be queried to identify systematic extraction problems

---

### 019 — Forced tool call for extraction schema

**Status:** Active
**Date:** March 2026

**Context:**
Early extraction approaches used JSON-only prompts ("return a JSON object with these fields"). These produced inconsistent output — Claude would sometimes wrap JSON in markdown fences, omit fields, or return free text. Tool use with `tool_choice: {type: "tool", name: "extract_contract_fields"}` forces schema-valid structured output on every call.

**Decision:**
Claude extraction uses a named tool call (`extract_contract_fields`) with `tool_choice` set to force that specific tool. The response is always a structured `tool_use` block with validated inputs — never raw text.

**Alternatives considered:**
- JSON mode / structured outputs — available in some models but less reliable than explicit tool use for enforcing required fields
- JSON prompt + post-processing — rejected; fragile, requires regex/parse fallbacks

**Consequences:**
- Extraction response handling must look for `tool_use` blocks in `response.content`, not text
- Adding new extracted fields requires updating `EXTRACTION_TOOL.input_schema` in `python-service/main.py`

---

### 020 — INP performance partial fix — FCP deferred

**Status:** Active
**Date:** March 2026

**Context:**
Two distinct performance problems were identified: (1) **INP** (Interaction to Next Paint) — inputs feeling sluggish due to heavy re-renders, worst on review screen (6184ms INP). (2) **FCP** (First Contentful Paint) — dashboard loads slowly (6.25s FCP), likely a blocking Supabase query.

**Decision:**
Fix INP immediately (affects all users interacting with the app); defer FCP fix (see Decision 013). INP fixes implemented:
- `loading="lazy"` on PDF iframe in review screen
- `requestIdleCallback` in `RevealObserver`
- `React.memo` with custom comparator on `FieldRow` and `ContractCard`
- `CountdownDisplay` extracted as isolated component to stop 1Hz setInterval from re-rendering entire `ContractDetailClient`
- `setInterval` → `setTimeout` chains in `ContractIntelligencePanel` and `ContractList`

**Consequences:**
- Review screen INP reduced substantially
- Dashboard FCP remains ~6.25s — tracked in Decision 013
- `setInterval` is no longer used in any component — always use `setTimeout` chains to yield to user input

---

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

---

### 022 — Renewal savings tracking and dashboard

**Status:** Superseded by Decision 023
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

---

### 023 — Renewal savings tracking deferred to compare flow

**Status:** Active
**Date:** April 2026

**Context:**
Savings tracking was implemented as a manual dropdown on the contract detail page ("What happened at renewal?") with Total Savings and Renewals Actioned dashboard cards. User testing showed this was unclear — users didn't understand what a "renewal action" was or why they should fill it in. The natural place to capture savings is after the compare flow, where users upload a renewal contract and see price/term changes side by side.

**Decision:**
Remove all savings tracking UI, API endpoint, and schema columns (renewal_action, renewal_savings, original_renewal_price). Keep annual_value column and extraction field. Redesign savings capture as a post-compare prompt in a separate spec.

**Alternatives considered:**
- Keep the manual dropdown as a secondary path — rejected; confusing UX that dilutes the dashboard with empty-state messaging
- Ship both manual and compare-flow paths simultaneously — rejected; two ways to do the same thing, neither done well

**Consequences:**
- Dashboard shows Contracts Managed and Alerts Sent only (no savings metrics until compare-flow savings ships)
- Pricing page no longer lists "renewal savings dashboard" as a feature
- Compare flow spec must include schema additions for renewal_action, renewal_savings, original_renewal_price

---

### 024 — OpenRenew self-hosted conversion

**Status:** Active
**Date:** July 2026

**Context:**
Renewl (the SaaS) had gone months without acquiring users despite being fully built and working. Rather than let a working product sit unused, it was open-sourced as OpenRenew: a self-hosted contract renewal tracker anyone can run on their own infrastructure with `docker compose up`, with AI extraction as an optional add-on instead of the product's core value proposition.

**Decision:**
Rebuild the deployment and infrastructure layer for self-hosting while keeping the product logic intact:
- `docker-compose.yml` with four containers — `web` (Next.js), `python` (FastAPI), `postgres`, and a `cron` sidecar — replacing Vercel + Railway + Supabase
- Drizzle ORM over Postgres 16, migrations auto-applied on `web` container start, replacing Supabase's managed Postgres + RLS
- Local email/password auth (bcrypt + JWT session cookie), first-run `/setup` creates the admin, replacing Google OAuth + Magic Link
- Contract PDFs stored on a shared Docker volume (`/data/contracts`), `python` mounts it read-only, replacing Supabase Storage signed URLs
- Alert delivery moved to instance-level: Slack webhook configured in-app (Settings, stored in `app_settings`) and/or SMTP via env vars, replacing Resend
- AI (extraction, analysis, comparison, drafting) gated entirely behind an optional `ANTHROPIC_API_KEY` — the app is fully functional as a manual tracker without it
- Licensed AGPL-3.0 instead of closed-source SaaS

**Alternatives considered:**
- Keep running it as a hosted SaaS — rejected; no users, and continued Vercel/Railway/Supabase/Stripe billing for an unused product made no sense
- MIT license — rejected; MIT would let a third party take this code and run it as a competing hosted service without contributing changes back. AGPL closes that loophole while keeping self-hosting completely free

**Consequences:**
- Supabase, Stripe, Vercel, and Railway are gone entirely — no external SaaS dependencies except the optional Anthropic API and the operator's own SMTP server
- Single shared workspace, no per-user data isolation — acceptable for a self-hosted single-team tool, but a multi-tenant story (OIDC/SSO, isolated workspaces) is the natural next paid-tier feature if this is ever offered as a hosted product again
- Decisions 005 (Supabase), 008 (Stripe Customer Portal), and 011 (free tier cap) no longer apply and are marked Superseded above
- Decisions 001 (Python microservice) and 010 (async extraction / awaited analysis) remain architecturally correct — only the deployment platform changed, not the pattern

---

### 025 — Triage-first home screen and iCal feed

**Status:** Active
**Date:** July 2026

**Context:**
As an internal tool, the home screen's job is "what needs action now," not selling value back to the user the way a SaaS dashboard does — metric cards (contracts managed, alerts sent) were SaaS vanity metrics with no action attached to them.

**Decision:**
Redesign the home screen around a triage queue (30-day window, notice-deadline-first — see `lib/triage.ts`), a 12-month horizon timeline, and a dense contract table. Decisions (Renewing/Canceling/Negotiating) and snoozes are recorded directly on `contracts`. Add an instance-wide, token-authenticated iCal feed so deadlines can be subscribed to from any calendar app.

**Alternatives considered:**
- Keep the metrics dashboard — rejected; vanity numbers with no action attached
- Per-user calendar feeds — rejected; this is a shared workspace, per-user tokens add plumbing with no benefit
- Full cancel/renew workflows launched from the queue — rejected for v1; the queue only marks status, the existing upload/renewal/cron flows still own the actual lifecycle

**Consequences:**
- The home screen now depends on the triage rules in `lib/triage.ts` — changing the queue window or decision-point priority changes what "NEEDS ACTION" means
- The feed token is a capability URL — anyone holding it can read all deadlines; Regenerate invalidates the old URL immediately
- Marking a contract Renewing/Canceling/Negotiating removes it from the queue but does not change contract lifecycle — expiry alerts, cron, and renewal upload behave exactly as before

---

## How to add a new entry

When you make a decision worth recording — a new architectural choice, a deliberate deferral, or a change that reverses a previous decision — add an entry here before closing the PR or ending the Claude Code session.

**Checklist for a good entry:**
- [ ] Title is a noun phrase describing the decision, not the outcome
- [ ] Status is set correctly (`Active` / `Superseded` / `Deferred`)
- [ ] Context explains the *problem*, not just the solution
- [ ] Alternatives considered includes at least one rejected option with a reason
- [ ] If superseding an older decision, old entry Status updated to `Superseded` with a note

**Template (copy this):**

```
### [number] — [title]

**Status:** Active
**Date:** [Month Year]

**Context:**
[2–4 sentences. What problem or constraint prompted this?]

**Decision:**
[One or two sentences. What was chosen?]

**Alternatives considered:**
- [Option] — [why rejected]

**Consequences:**
[What does this make easier or harder?]
```

---

## Trigger list — when to add an entry

Add an entry any time you:

- Choose between two technologies or libraries
- Decide to defer something to v2
- Change a decision that already has an entry (mark old as Superseded, add new)
- Add a new "hard rule" to CLAUDE.md
- Make a schema change that removes or renames columns
- Change which service handles a responsibility (e.g. moving Claude calls from Python to Next.js)
- Make a pricing or free tier change
- Choose not to implement a security feature (with reasoning)
- Change which AI model handles a task
