# Renewl — Project Handoff Document
**For use in Cowork / Claude Project**
**Date:** March 23, 2026
**Last verified:** 2026-03-24

---

## What is Renewl

Renewl is a live, deployed SaaS product at **getrenewl.com**. It helps ops and finance teams at 10-100 person companies track vendor contract renewal dates and receive alerts before anything auto-renews or expires.

**One-line pitch:** "Renewl alerts your ops team before vendor contracts auto-renew — so you negotiate, not panic."

**Business model:** Side project targeting $5K MRR. Free tier (20 contracts), Pro at $49/month.

---

## Current Status

- ✅ Product is live at getrenewl.com
- ✅ Users can sign up (Google OAuth + Magic link)
- ✅ Full upload → extract → review → confirm → alerts flow working
- ✅ Stripe billing implemented
- ✅ Security hardened (10 critical/high issues fixed)
- ✅ SEO foundation in place
- ✅ Landing page live with CTAs
- ✅ AI Contract Risk Analysis (Contract Intelligence panel) — **complete**
- 🔄 **In progress:** LinkedIn outreach to first beta users

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16.2.1 App Router + inline styles (no Tailwind) |
| Database / Auth | Supabase (Postgres + Auth + Storage) |
| PDF Processing | Python microservice on Railway — pdfplumber + **Anthropic SDK** (not litellm) |
| AI Extraction | `claude-sonnet-4-6` via tool use (configurable via `AI_MODEL` env var) |
| AI Analysis | `claude-haiku-4-5-20251001` (hardcoded in python-service/main.py) |
| File Storage | Supabase Storage (private bucket: `contracts`) |
| Email Alerts | Resend |
| Payments | Stripe + Customer Portal |
| Cron Jobs | Vercel Cron (daily at 08:00 UTC) |
| Hosting | Vercel (frontend) + Railway (Python microservice) |
| Analytics | Google Analytics 4 |
| Fonts | JetBrains Mono + Inter (via next/font) |

**Important:** Python service uses the `anthropic` SDK **directly** — litellm was removed. All Claude calls go through the Python service — NOT from Next.js directly.

**Note:** `python-service/.env.example` has a stale LiteLLM comment — ignore it. The code imports `anthropic` and uses `claude-sonnet-4-6` as the model string directly.

---

## Repository Structure

```
renewl/
├── app/
│   ├── (auth)/login/              # Magic link + Google OAuth
│   ├── auth/callback/             # Auth callback handler
│   ├── (dashboard)/
│   │   ├── dashboard/             # Main dashboard + upload zone
│   │   ├── dashboard/review/[id]/ # Review screen (PDF + fields)
│   │   └── contracts/[id]/        # Contract detail page
│   ├── (marketing)/               # Landing page
│   ├── faq/                       # FAQ page
│   ├── resources/                 # Template download page
│   └── api/
│       ├── upload/                # PDF upload + contract row creation
│       ├── extract/               # Triggers Python microservice
│       ├── confirm/               # Confirms extraction, generates alerts
│       ├── analyse/               # NEW - triggers AI risk analysis
│       ├── reopen/                # Reopen confirmed contract for editing
│       ├── cron/send-alerts/      # Daily alert cron job
│       ├── stripe/                # Checkout + portal
│       └── webhooks/stripe/       # Stripe webhook handler
├── python-service/
│   ├── main.py                    # FastAPI - single file with sections
│   ├── requirements.txt
│   ├── Dockerfile
│   └── railway.toml
├── components/
│   ├── dashboard/                 # ContractCard, UploadZone, etc.
│   ├── contracts/                 # ContractDetailClient
│   ├── review/                    # ReviewClient
│   └── ui/                        # Logo, Button, etc.
├── lib/
│   ├── supabase/client.ts
│   ├── supabase/server.ts
│   ├── supabase/middleware.ts
│   ├── alerts.ts                  # buildAlerts() — pre-generates alert rows
│   ├── analysis.ts                # triggerAnalysis() — calls Python /analyse, persists to DB
│   ├── analytics.ts
│   ├── email.ts                   # Resend email templates (hardcoded hex)
│   ├── ratelimit.ts               # Upstash rate limiting (optional)
│   ├── stripe.ts                  # Stripe client singleton
│   └── utils.ts                   # isExpired(), daysUntil(), validateDateOrder(), etc.
├── middleware.ts                  # Protects /dashboard/* routes
└── docs/superpowers/plans/        # Claude Code plan docs
```

---

## Database Schema

Five tables, all RLS-enabled:

### `profiles`
Extends `auth.users`. Fields: `id`, `email`, `plan` (free/pro), `timezone`, `slack_webhook_url`, `onboarding_completed`, `stripe_customer_id`, `stripe_subscription_id`, `created_at`, `updated_at`

### `contracts`
Core contract record. Key fields:
- `id`, `user_id`, `name`, `category` (saas/lease/vendor/employment/other)
- `party_a` (vendor/provider), `party_b` (customer/client) — NOTE: replaced `counterparty_name`
- `effective_date`, `expiry_date`, `renewal_date`, `auto_renew`, `notice_period_days`, `notice_period_text`, `contract_value`
- `extraction_confidence`, `extraction_status` (pending/processing/review/confirmed/manual)
- `file_path`, `file_name`
- `status` (processing/review/confirmed/expired)

### `contract_extractions`
Per-field extraction log. Fields: `id`, `contract_id`, `field_name`, `extracted_value`, `confirmed_value`, `confidence`, `was_edited` (trigger-maintained)

### `alerts`
Pre-generated alert rows. Fields: `id`, `contract_id`, `user_id`, `alert_type` (day_60/day_30/day_7/notice_deadline), `scheduled_for`, `target_date`, `status` (pending/sent/skipped), `sent_at`

### `activity_log`
Append-only event log. `user_id` is nullable (for system events like cron).

### `contract_analysis` — **LIVE**
```sql
CREATE TABLE public.contract_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  findings JSONB NOT NULL DEFAULT '[]',
  raw_text_used TEXT,
  model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  analysis_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Findings JSONB structure:
```json
[
  {
    "type": "warning",
    "category": "auto_renewal",
    "title": "Auto-renewal with no price cap",
    "explanation": "The vendor can increase pricing by any amount at renewal.",
    "action": "Ask vendor to add a price escalation cap (e.g. CPI + 3%)",
    "severity": "medium"
  }
]
```

---

## Feature Currently Being Built: AI Contract Risk Analysis

### What it does
After a contract is confirmed, a second Claude pass analyses the full contract text for business risks, unfavourable clauses, and actionable insights. Results appear as a "Contract Intelligence" panel on the contract detail page.

### Architecture decision (IMPLEMENTED)
**Python service handles ALL Claude calls.** Next.js `/api/analyse` is a thin orchestrator. Anthropic SDK is NOT in Next.js.

### Flow (as built)
1. User confirms contract → `/api/confirm` awaits `triggerAnalysis()` (not fire-and-forget — confirm route `maxDuration=60` covers the wait)
2. `lib/analysis.ts` `triggerAnalysis()` calls `PYTHON_SERVICE_URL/analyse`
3. Python service: fetch PDF via signed URL → extract text → call Claude Haiku → return findings JSON
4. Next.js writes findings to `contract_analysis` table
5. Contract detail page polls `GET /api/analyse?contract_id=` (3s interval, 60s timeout)
6. Intelligence panel renders findings

### New Python endpoint needed
`POST /analyse` — takes `{ file_url, contract_id, contract_context }` where contract_context includes already-extracted fields (party_a, party_b, category, auto_renew, notice_period_days etc.)

### Three UI states (mockup APPROVED)
1. **Warnings present** — panel open by default, amber ⚠ warnings with action items (copyable to clipboard), green ✓ positives, muted ℹ info
2. **Analysing** — pulsing green dot, "Analysing contract..." — countdown timer still runs independently above
3. **No warnings** — panel collapsed by default, "No critical flags" visible in header bar

### Copyable action items
On hover over `→ action text`, show subtle copy badge. Click copies to clipboard with "Copied" toast.

### Disclaimer (always visible)
`Powered by Claude · For informational purposes only · Not legal advice`

---

## Key Design Decisions

### Brand
- **Name:** Renewl
- **Domain:** getrenewl.com
- **Logo:** Green `R` block + `enewl` in JetBrains Mono
- **Colour:** `#10B981` emerald (primary accent)
- **Background:** `#0A0F1E` (deep navy)
- **Theme:** Dark only — no light mode in v1

### Colour palette
- `#0A0F1E` — page background
- `#111827` — surface/card
- `#10B981` — primary accent (emerald)
- `#F9FAFB` — primary text
- `#9CA3AF` — secondary text
- `#6B7280` — muted text
- `#EF4444` — red/urgent
- `#F59E0B` — amber/warning
- `#064E3B` — dark green headers

**Note:** marketing.css uses `#00c9a0` (slightly different green) — deferred fix, low priority

### AI models
- **Extraction:** `claude-sonnet-4-6` (configurable via `AI_MODEL` env var in Python service; default `claude-sonnet-4-6`)
- **Analysis (Contract Intelligence):** `claude-haiku-4-5-20251001` (hardcoded in `python-service/main.py` as `ANALYSIS_MODEL`)

### Fonts
JetBrains Mono + Inter only. Geist and Geist_Mono removed. All references use CSS variables (`var(--font-jetbrains)`, `var(--font-inter)`) not literal font names.

### No Tailwind
Inline styles throughout for precise dark theme control.

### party_a / party_b
`counterparty_name` was replaced with `party_a` (vendor/provider) and `party_b` (customer/client). Both extracted by AI and shown in UI with `↔` separator.

---

## Pricing

| Plan | Details |
|------|---------|
| Free | Up to 20 contracts, email alerts, AI extraction. No credit card. |
| Pro — $49/month | Unlimited contracts, email + Slack alerts, CSV export. Cancel anytime. |
| Never | MAU pricing, per-user fees, annual-only commitments |

---

## Security Status

**Fixed:**
- Python service auth: `Authorization: Bearer <EXTRACTION_SERVICE_SECRET>`
- SSRF protection in Python service (URL allowlist + private IP rejection)
- `middleware.ts` active and protecting `/dashboard/*`
- Security headers (CSP, HSTS, X-Frame-Options)
- HTML escaping in email templates
- Timing-safe cron secret comparison
- Slack webhook hostname validation
- Stripe error sanitisation
- Zod validation on all API routes
- Rate limiting via Upstash

**Known limitations:**
- PDF signed URL expires after 600s (review screen)
- Dashboard FCP is 6.25s — fix deferred until 10+ paying customers
- No SOC 2

---

## Performance

- Landing page: static (`○ /`) served from Vercel CDN — ~0.5s FCP
- Dashboard: 6.25s FCP — not yet optimised
- Fonts: 2 requests (JetBrains Mono + Inter) — Geist removed

---

## Environment Variables

### Next.js (.env.local + Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server-side only, never NEXT_PUBLIC_
EXTRACTION_SERVICE_SECRET=          # shared secret with Python service
PYTHON_SERVICE_URL=                 # defaults to http://localhost:8000
CRON_SECRET=                        # Vercel cron auth
APP_URL=                            # https://getrenewl.com
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
ANTHROPIC_API_KEY=                  # NOT used by Next.js — set in Railway for Python service
NEXT_PUBLIC_GA_MEASUREMENT_ID=      # Google Analytics
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### Python service (.env)
```
ANTHROPIC_API_KEY=                  # Used directly by anthropic SDK (not litellm)
EXTRACTION_SERVICE_SECRET=          # Must match Next.js value
SUPABASE_STORAGE_DOMAIN=            # e.g. xxxx.supabase.co (for SSRF allowlist)
AI_MODEL=                           # Optional — defaults to "claude-sonnet-4-6"
```

---

## Prompts Generated (in outputs folder)

All Claude Code prompts are in `/mnt/user-data/outputs/`:

| File | Purpose |
|------|---------|
| `renewl_build_bible_v2.md` | Full PRD + Technical Design + Positioning (v2) |
| `schema.sql` | Full Supabase schema |
| `renewl_claudecode_setup.md` | Next.js + Supabase + Vercel setup |
| `renewl_landing_page_prompt.md` | Landing page |
| `renewl_landing_page_update_prompt.md` | CTA + copy updates |
| `renewl_cta_button_fix_prompt.md` | Button styling fixes |
| `renewl_dashboard_ui_rebuild.md` | Dashboard dark theme |
| `renewl_contract_detail_prompt.md` | Contract detail page |
| `renewl_manual_entry_prompt.md` | Manual contract entry |
| `renewl_party_fields_prompt.md` | party_a + party_b migration |
| `renewl_expired_contracts_prompt.md` | Expired contract display |
| `renewl_open_beta_prompt.md` | Waitlist → open beta switch |
| `renewl_stripe_integration_prompt.md` | Full Stripe billing |
| `renewl_security_fixes_prompt.md` | Security fixes 1-10 |
| `renewl_technical_seo_prompt.md` | Sitemap, OG, structured data |
| `renewl_faq_page_prompt.md` | FAQ page |
| `renewl_template_page_prompt.md` | Free template download page |
| `renewl_google_analytics_prompt.md` | GA4 implementation |
| `renewl_logo_implementation_prompt.md` | Logo + favicon |
| `renewl_to_renewl_rename_prompt.md` | Rename Renewly → Renewl |
| `renewl_performance_fix_prompt.md` | Landing page performance |
| `renewl_ui_consistency_audit_prompt.md` | UI consistency audit |
| `renewl_ai_risk_analysis_prompt.md` | AI Contract Risk Analysis |
| `renewl_contract_renewal_tracker.xlsx` | Free Excel template |
| `renewl_faq.md` | FAQ content |

---

## V2 Roadmap (post 10 paying customers)

1. **Contract ownership + team tracking** — tie contracts to team/function, assign owner, 90-day pre-renewal prompt "Is this still needed?"
2. **Negotiation window indicator** — badge on dashboard when 60-day window opens
3. **Total value tracked** — "$247k in contracts tracked" on dashboard
4. **Per-field confidence scores** — replace single float with per-field
5. **Multi-seat / team accounts**
6. **Negotiation briefing** — one-page brief at 60-day window
7. **Clause comparison** — diff key terms when renewal version uploaded
8. **Scanned PDF OCR support**
9. **Monthly summary email** (NOT weekly — would become spam)
10. **Slack webhook settings UI** (currently set via Supabase dashboard)
11. **Light mode toggle**

---

## SEO Content Plan

| Priority | Page | Keyword | Status |
|----------|------|---------|--------|
| 1 | `/resources/contract-renewal-tracker-template` | vendor contract tracker template | Prompt ready |
| 2 | `/resources/saas-renewal-tracker` | track SaaS renewals | Prompt partially written |
| 3 | `/blog/cost-of-forgotten-renewals` | forgotten SaaS renewals | Not started |
| 4 | `/resources/saas-audit-checklist` | SaaS audit checklist | Not started |
| 5 | `/compare/renewl-vs-spreadsheet` | contract renewal tracker | Not started |
| 6 | `/blog/auto-renewal-clauses` | auto renewal clause | Not started |

---

## GTM Status (March 23, 2026)

**Live outreach:**
- LinkedIn post live (build in public angle)
- Bradford Foley (Finance Manager, Particle Health) — DM sent asking about current workflow
- Klaudia Sawa (SysAid AE, ITSM) — connected, message sent asking about renewal pain in discovery
- Douglas Kim (Head of Legal, built own contract tool) — connected, message sent
- Commented on Kunal Mahajan (Volody CLM) post
- Commented on Kate Vitasek (procurement thought leader) post
- Engaged with Klaudia Sawa / Luciano Corrêa Garcia contract renewal thread

**Key insight from outreach:**
The "notice deadline vs expiry date" distinction is the sharpest insight resonating with procurement and ops professionals. Notice period closes weeks/months before the actual renewal date — most teams don't know this until it's too late.

**Competitive landscape:**
- Juro — enterprise CLM, legal-first, demo-required, not a threat at Renewl's price point
- Volody — enterprise CLM
- ContractSafe — legal-team-first, dated UI
- LeakGuard — early-stage startup (24 followers) building adjacent product
- Douglas Kim's vibe-coded tool — legal-team focused, requires own API key
- renewlyapp.com — consumer iPhone app for personal subscriptions, zero overlap

---

## Immediate Next Actions

1. **Finish AI Contract Risk Analysis** — Claude Code is mid-build, design approved
2. **Publish free template page** — `getrenewl.com/resources/contract-renewal-tracker-template`
3. **Send waitlist email** — everyone who signed up needs to know product is live
4. **Get 3 real people to upload a real contract** — the only metric that matters right now
5. **Write build-in-public LinkedIn post** about AI risk analysis feature as it's built
6. **Fix marketing.css accent colour** — `#00c9a0` → `#10B981` (quick find-replace)

---

## Important Rules / Constraints

- **All Claude calls go through Python service** — never add Anthropic SDK to Next.js
- **No Tailwind** — inline styles only
- **sessionClient for all DB writes** — never use service role key for user data writes (only for Storage signed URLs and webhooks)
- **RLS is not enough** — always add explicit `.eq('user_id', user.id)` on queries as defense-in-depth
- **Fire-and-forget for analysis** — never block user-facing responses with AI calls
- **Email templates use hardcoded hex** — never CSS variables (email clients don't support them)
- **Disclaimer on all AI analysis** — "For informational purposes only. Not legal advice."
- **`isExpired()` defined once in `lib/utils.ts`** — import everywhere, never duplicate

---

## Contacts Worth Following Up

| Person | Role | Status | Next action |
|--------|------|--------|-------------|
| Bradford Foley | Finance Manager, Particle Health | DM sent | Wait for reply about workflow |
| Klaudia Sawa | AE at SysAid, ITSM | Connected + messaged | Wait for reply |
| Douglas Kim | Head of Legal, built own tool | Connected + messaged | Wait for reply |
| Luciano Corrêa Garcia | Strategic Supplier Decision Advisor | Engaged in comments | Connect directly |
| Tristan Tan | Tax Lawyer + CA | Commented on Douglas's post | Send connection request |
| Stephanie Goutos | Employment Lawyer, AI Governance | Commented on Douglas's post | Send connection request |
| Kunal Mahajan | Volody CLM | Commented on his post | Connect directly |
| Jean Bosmans | Energy Consultant, Ascend Energy | Commented on his post | Connect directly |
| Kate Vitasek | Procurement thought leader, author | Engaged with post | Connect directly |

---

*Last updated: March 23, 2026*
*Built in one day using Claude Code*
