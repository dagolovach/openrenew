# Renewl — Founder Build Bible

**Contract & Renewal Tracking for Ops/Finance Teams**

> Version 2.0 — Post-Launch · March 2026 · Living document

---

# Part 1 — Product Requirements Document

## 1.1 Problem Statement

Companies with 10–100 employees manage an average of 50–100 SaaS subscriptions plus office leases, vendor agreements, and consultant contracts. These renewals are tracked in spreadsheets, shared calendars, or nobody's system at all. When a renewal date is missed, the company either auto-renews a tool they no longer use (direct cost), or misses a negotiation window (opportunity cost). One missed enterprise SaaS renewal can easily cost $5,000–$20,000.

The notice period is the hidden deadline most people miss. A contract expiring December 31st with a 60-day notice period means the real decision deadline was November 1st. That date lives in a PDF nobody opened.

The people who feel this pain most acutely are ops managers and finance leads — not legal teams. Existing tools (ContractSafe, Ironclad, Gatekeeper) are built for legal workflows: contract drafting, redlining, approvals. They are too heavy and too expensive for a 30-person company that just wants to know when things expire.

---

## 1.2 Target User

| Dimension         | Detail                                                                                |
| ----------------- | ------------------------------------------------------------------------------------- |
| Primary buyer     | Ops Manager or Finance Lead at a 10–100 person company                                |
| Secondary buyer   | Founder/CEO at early-stage startups managing their own ops                            |
| Company stage     | Series A or below, or bootstrapped SMB                                                |
| Pain trigger      | Just got surprised by an auto-renewal, or joining a company with no contract tracking |
| Technical comfort | Comfortable with SaaS tools; not a developer                                          |
| Budget authority  | Yes — this is a sub-$100/mo tool, no committee needed                                 |

---

## 1.3 Core Value Proposition

Upload a contract PDF. Renewl extracts the key dates using AI, you confirm in 30 seconds, and from that point forward you get email and Slack alerts at 60, 30, and 7 days before anything expires or renews. You will never be surprised by a vendor renewal again.

---

## 1.4 V1 Feature Scope — SHIPPED

### Shipped

- PDF upload with AI-powered extraction (pdfplumber + Claude Haiku)
- Fields extracted: expiry date, renewal date, notice period, auto-renew flag, contract value, party A, party B
- Human-in-the-loop review screen: side-by-side PDF viewer + fields panel
- Confidence scoring per field, colour-coded (green / amber / red)
- Amber fields pre-expanded on review screen load
- "Looks good" and "Not applicable" affordances per field
- Tiered email alerts at 60, 30, and 7 days before expiry or renewal
- Notice deadline alert: fires 7 days before notice window closes
- Slack webhook alerts (single webhook URL per account)
- Dashboard: contracts sorted by urgency (red → amber → green → review → processing → manual → expired)
- Contract detail page: terminal aesthetic, live countdown timer, gradient progress bar, alert status row
- Contract categories: SaaS, lease, vendor, employment, other
- Manual entry fallback for scanned PDFs or contracts without PDF
- Expired contract handling: muted grey display, sorts to bottom, no negative days shown
- Edit / reopen confirmed contracts — alerts regenerate on re-confirm
- Delete contract: confirmation dialog, deletes PDF from Supabase Storage and DB row
- Two pricing tiers: Free (up to 20 contracts) and Pro ($49/month, unlimited)
- Stripe billing with Customer Portal for self-service subscription management
- Settings page: Slack webhook URL, billing management
- Google OAuth + Magic link authentication
- Row Level Security on all tables

### Explicitly Out of Scope for V1

- Contract drafting or redlining
- Multi-seat / team accounts (v2)
- Bulk CSV import
- Spend analytics or vendor benchmarking
- Mobile app
- API or webhooks for outbound integrations
- SOC 2 compliance
- Per-field confidence scores (single confidence float per extraction in v1)

---

## 1.5 Success Metrics

| Milestone           | Target                                                                   |
| ------------------- | ------------------------------------------------------------------------ |
| Week 4              | Working MVP deployed, 5 beta users onboarded ✅                          |
| Month 2             | First 3 paying customers at $49/month                                    |
| Month 6             | 30 paying customers ($1,470 MRR)                                         |
| Month 12            | 100 paying customers ($4,900 MRR)                                        |
| Retention           | Monthly churn under 3%                                                   |
| Extraction accuracy | 85%+ of fields confirmed without user edits ✅ (achieved 90% in testing) |

---

## 1.6 V2 Roadmap (post first 10 paying customers)

### High priority

- **Contract ownership + relevance check** — tie each contract to a team/function (Engineering, Marketing, Finance etc.) and an owner. Send 90-day pre-renewal prompt: "Is [contract] still needed by [team]? Renew / Cancel / Needs review." Solves ghost subscription problem.
- **Weekly digest email** — every Monday: "Your Renewl week ahead." Contracts expiring in next 90 days, sorted by urgency. Keeps product visible between renewal events.
- **Total value tracked** — show "$247,000 in contracts tracked" on dashboard. Reframes Renewl from alert tool to financial oversight tool.
- **Negotiation window indicator** — "Negotiation window open" badge when contract enters 60-day window.
- **Per-field confidence scores** — replace single float with per-field confidence. Enables proper green/amber/red per field in review UI.
- **Multi-seat / team accounts** — organisations table, per-user roles, shared contract visibility.

### Medium priority

- **AI contract risk analysis** — second Claude pass on confirmed contracts: unfavourable clauses, vendor leverage points, missing buyer protections. Displayed as collapsible panel on contract detail page.
- **Negotiation briefing** — at 60-day window, generate one-page brief: current terms, suggested asks, leverage points, draft opening email to vendor.
- **Clause comparison** — when renewal version uploaded, diff key terms automatically.
- **Slack settings UI** — currently set via Supabase dashboard for beta users. Build proper settings UI in Week 4.
- **Scanned PDF / OCR support** — pytesseract + pdf2image fallback for image-based PDFs.

### Deferred

- **On-premise / local model option** — for privacy-sensitive enterprise buyers
- **PII redaction before Claude API call**
- **Annual billing**
- **SOC 2 Type II**

---

## 1.7 What Success Looks Like for the User

A user uploads their AWS contract on Monday. By Tuesday they have confirmed the renewal date, notice period, and contract value. Six weeks before the renewal date, they receive an email: "Your AWS Enterprise Agreement renews on [date] in 42 days. Notice period: 30 days. Action needed by [date]." They forward it to their CFO and negotiate a 15% discount. That one interaction pays for two years of Renewl.

---

# Part 2 — Technical Design Document

## 2.1 Architecture Overview

Renewl is a full-stack web application with a Python microservice for PDF processing. The stack is deliberately boring — no exotic infrastructure, nothing that requires a second engineer to maintain.

---

## 2.2 Tech Stack — Final

| Layer           | Technology                                            |
| --------------- | ----------------------------------------------------- |
| Frontend        | Next.js 14 (App Router) + inline styles (no Tailwind) |
| Database / Auth | Supabase (Postgres + Auth + Storage)                  |
| PDF Processing  | Python microservice on Railway — pdfplumber           |
| AI Extraction   | Claude Haiku (`claude-haiku-4-5`) via tool use        |
| File Storage    | Supabase Storage (private bucket: `contracts`)        |
| Email Alerts    | Resend                                                |
| Payments        | Stripe + Customer Portal                              |
| Cron Jobs       | Vercel Cron (daily at 08:00 UTC)                      |
| Hosting         | Vercel (frontend) + Railway (Python microservice)     |
| Analytics       | Google Analytics 4                                    |
| Fonts           | JetBrains Mono + Inter (via next/font, no Geist)      |

### Key decisions

- **Claude Haiku over Sonnet** — identical accuracy (90%) at 10-15x lower cost, 2x faster. Validated against 10 test contracts.
- **No Tailwind** — inline styles throughout for precise dark theme control
- **Single confidence float** — per-field confidence deferred to v1.1
- **party_a / party_b** — replaced single `counterparty_name` field with two party fields for clarity
- **Supabase over Neon** — bundled auth + storage saves setup time for v1. Neon for future projects.

---

## 2.3 Core Data Flow

### Upload & Extraction Flow

1. User drops PDF on dashboard upload zone
2. Client validates: PDF only, ≤20MB
3. POST to `/api/upload` — stores at `{user_id}/{contract_id}/original.pdf`, creates contract row
4. Client POSTs `{ contract_id }` to `/api/extract` — fire and forget
5. Python microservice downloads PDF via signed URL (60s expiry), extracts text, calls Claude Haiku via tool use
6. Claude returns structured JSON — written to `contract_extractions` table
7. Contract status → `'review'`, client polling detects change (3s interval, 90s timeout)
8. User confirms on review screen → `/api/confirm` → alerts pre-generated → status → `'confirmed'`

### Alert Delivery Flow

1. Vercel Cron runs daily at 08:00 UTC
2. Queries `alerts` WHERE `scheduled_for <= TODAY AND status = 'pending'` LIMIT 100
3. Sends concurrently via `Promise.allSettled()` — one failure doesn't abort others
4. Updates `status: 'sent'`, logs to `activity_log`

---

## 2.4 Claude Extraction — Final Prompt

**Model:** `claude-haiku-4-5`

**System prompt rules:**

- Extract dates exactly as written
- party_a = vendor/supplier/lessor/employer (first named party)
- party_b = customer/tenant/employee (second named party)
- Use null for fields not clearly present
- auto_renew: true only if "shall automatically renew" or "evergreen" present
- Prioritize first 30k + last 10k characters of long contracts
- Output via tool use schema — guaranteed valid JSON

**Tool schema fields:** `party_a`, `party_b`, `effective_date`, `expiry_date`, `renewal_date`, `auto_renew`, `notice_period_days`, `notice_period_text`, `contract_value`, `confidence`

**Accuracy:** 90% field extraction across 10 test contracts (target was 85%)

---

## 2.5 Database Schema

Five tables, all RLS-enabled:

- **profiles** — extends `auth.users` with plan, timezone, slack_webhook_url, stripe IDs, onboarding_completed
- **contracts** — core record with extracted dates, file metadata, dual status columns (status + extraction_status), party_a, party_b
- **contract_extractions** — per-field log with extracted_value, confirmed_value, confidence, was_edited (trigger-maintained)
- **alerts** — pre-generated rows with alert_type (day_60/day_30/day_7/notice_deadline), target_date, scheduled_for
- **activity_log** — append-only event log (user_id nullable for system events)

Key migrations applied post-launch:

- `party_a` / `party_b` replacing `counterparty_name`
- `target_date` added to `alerts` table
- `notice_deadline` added to `alert_type` CHECK constraint
- `alerts` unique constraint on `(contract_id, alert_type, target_date)`
- `was_edited` trigger updated with `TG_OP = 'UPDATE'` guard

---

## 2.6 Security

Status as of launch:

**Fixed (P1-P2):**

- Python service auth: `Authorization: Bearer <EXTRACTION_SERVICE_SECRET>` on all endpoints
- SSRF protection: URL allowlist + private IP range rejection in Python service
- `middleware.ts` active (was incorrectly named `proxy.ts` — fixed)
- Security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- HTML escaping in email templates: `escapeHtml()` on all user-controlled values
- Timing-safe cron secret comparison: `crypto.timingSafeEqual()`
- Slack webhook URL validation: hostname check not startsWith
- Stripe error sanitisation: generic messages to client, full errors server-side only
- Zod input validation on all API routes
- Rate limiting: Upstash on `/api/waitlist`, `/api/upload`, `/api/extract`

**Known limitations (v1):**

- PDF signed URL expires after 600s — iframe shows error for long review sessions
- Fire-and-forget `/api/extract` POST: 90s polling timeout recovers to manual entry
- No SOC 2 certification

---

## 2.7 Performance

| Route            | Before              | After                   |
| ---------------- | ------------------- | ----------------------- |
| / (landing page) | 1.86s FCP (dynamic) | ~0.5s FCP (static, CDN) |
| /dashboard       | 6.25s FCP           | Not yet optimised       |
| /login           | 2.02s FCP           | Not yet optimised       |

Landing page is now fully static (`○ /` in build output). Two font requests removed (Geist, Geist_Mono). Supabase auth check moved from page component to middleware cookie check.

Dashboard performance fix deferred until first 10 paying customers.

---

# Part 3 — Positioning Document

## 3.1 One-Line Pitch

> _"Renewl alerts your ops team before vendor contracts auto-renew — so you negotiate, not panic."_

---

## 3.2 Positioning Statement

For ops managers and finance leads at 10–100 person companies who are losing money on forgotten vendor renewals, Renewl is a contract expiry tracker that uses AI to extract key dates from PDFs and sends tiered alerts before anything expires. Unlike ContractSafe or Ironclad, which are built for legal teams managing contract drafting and approvals, Renewl is built for the ops/finance person who just needs to know what's renewing and when — with zero legal workflow overhead.

---

## 3.3 Competitive Positioning

| Competitor            | Their gap — our angle                                         |
| --------------------- | ------------------------------------------------------------- |
| ContractSafe          | Legal-first, ops-last. Heavy UI, dated AI.                    |
| Ironclad / Icertis    | Enterprise CLM. Hundreds to thousands per month.              |
| Gatekeeper            | Complex onboarding, opaque pricing.                           |
| Google Sheets         | Manual, no alerts, dies when someone leaves.                  |
| Torii / Zluri / Vendr | SaaS-only via SSO/bank feeds. We cover all contract types.    |
| renewlyapp.com        | Consumer iPhone app for personal subscriptions. Zero overlap. |

---

## 3.4 Brand

- **Product name:** Renewl
- **Domain:** getrenewl.com
- **Logo:** Green `R` block + `enewl` in JetBrains Mono
- **Favicon:** Green square with `R`
- **Colour:** `#10B981` emerald green (primary accent)
- **Theme:** Dark (`#0A0F1E` background) — intentional, no light mode in v1

---

## 3.5 Pricing

| Plan            | Details                                                                |
| --------------- | ---------------------------------------------------------------------- |
| Free            | Up to 20 contracts. Email alerts only. No credit card required.        |
| Pro — $49/month | Unlimited contracts. Email + Slack alerts. CSV export. Cancel anytime. |
| Never           | MAU-based pricing. Per-user fees. Annual-only commitments.             |

---

## 3.6 SEO Content Strategy

| Priority | Content Piece                                 | Target Keyword                   | Status                       |
| -------- | --------------------------------------------- | -------------------------------- | ---------------------------- |
| 1        | Free vendor contract renewal tracker template | vendor contract tracker template | ✅ Built + page prompt ready |
| 2        | How to track SaaS subscription renewals       | track SaaS renewals              | Prompt partially written     |
| 3        | The true cost of forgotten software renewals  | forgotten SaaS renewals          | Not started                  |
| 4        | How to audit your SaaS stack                  | SaaS audit checklist             | Not started                  |
| 5        | Best contract expiry tracking tools           | contract expiry tracker          | Not started                  |
| 6        | Vendor contract notice periods explained      | contract notice period           | Not started                  |

Technical SEO implemented: sitemap.xml, robots.txt, JSON-LD structured data, OG image route, Google Analytics 4, Google Search Console.

---

## 3.7 Go-To-Market — Current Status

**Launched:** March 22, 2026

**Active outreach:**

- LinkedIn post live (build in public angle)
- Bradford Foley (Finance Manager, Particle Health) — DM sent, asking about current workflow
- Klaudia Sawa (Agentic AI Advocate) — connected
- Klaudia Sawa / Luciano Corrêa Garcia post — comment posted on contract renewal discussion
- Kate Vitasek (procurement thought leader) — post engaged

**Next actions:**

- Send waitlist email to all signups
- DM 10 more ops/finance connections
- Post in Indie Hackers, r/SaaS
- Publish free template page
- Reply to all LinkedIn comments within 1 hour

**First goal:** 3 real people upload a real contract and confirm it.

---

## 3.8 Decisions Log

| Decision                  | Rationale                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Haiku over Sonnet         | Same 90% accuracy, 10-15x cheaper, 2x faster                                           |
| party_a + party_b         | Clearer than single counterparty — both parties matter                                 |
| getrenewl.com             | renewly.com taken. renewl.io available at $35 but kept existing domain for consistency |
| Dark theme, no light mode | Intentional product positioning. Add toggle in v2 if users request it                  |
| Stripe Customer Portal    | No custom billing UI needed. Self-service via Stripe handles everything                |
| Supabase over Neon        | Bundled auth + storage saves setup. Neon better for multi-project portfolio            |
| No Tailwind               | Inline styles give precise dark theme control without purge/config complexity          |
| Static landing page       | Supabase auth check moved to middleware. CDN-served HTML, near-instant FCP             |
| Slack UI deferred         | Set via Supabase dashboard for beta users. Build settings UI after first 10 customers  |

---

## 3.9 Open Questions

- **Free tier limit:** 20 contracts — validate with beta users before tightening
- **Dashboard performance:** 6.25s FCP — fix after first 10 paying customers
- **marketing.css accent colour:** `#00c9a0` vs app `#10B981` — one find-replace to fix, low priority
- **Scanned PDF handling:** pdfplumber can't read image PDFs. Add OCR (pytesseract) in v1.1
- **Email alert format:** HTML vs plain text — test both with first beta users
- **Onboarding flow:** prompt to upload first contract vs empty dashboard

---

_End of Renewl Founder Build Bible v2.0 — updated March 22, 2026_
