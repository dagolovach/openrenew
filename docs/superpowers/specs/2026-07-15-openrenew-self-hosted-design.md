# OpenRenew — Self-Hosted Open-Source Edition — Design

**Date:** 2026-07-15
**Status:** Approved
**Context:** The Renewl SaaS reached no users. Decision: convert it into a self-hosted
open-source project (distribution/portfolio play, open-core optionality later).
New repo: `github.com/dagolovach/openrenew`, local directory `~/code/openrenew`.

## Goals

- `git clone && docker compose up` installs the entire product with zero external accounts.
- B2B-credible: a company runs its own instance; contracts never leave their server
  (except anonymized text to Anthropic, only if a key is configured).
- Launchable on Show HN / r/selfhosted; README is the marketing asset.
- Keep the open-core door open (AGPL-3.0; OIDC/SSO as the future paid feature).

## Non-Goals (v1)

- OIDC/SSO, LDAP, or any corporate identity integration (roadmap item).
- Ollama / local-model support (roadmap item; good-first-issue magnet).
- Multi-workspace / multi-tenant support — one shared workspace per install.
- Email-invite flows, billing, usage analytics of any kind.
- MS Teams alerts, CSV import/export (roadmap items).

## Repo Bootstrap

- Copy the working tree of `~/code/renewl` (NOT git history — old commits may contain
  secrets, and the history has no public value) into `~/code/openrenew`.
- `git init`, initial commit, push to `git@github.com:dagolovach/openrenew.git`.
- License: **AGPL-3.0** (`LICENSE` file). Prevents third parties from running it as a
  hosted service without open-sourcing changes; standard for B2B OSS (Cal.com, Plausible,
  Documenso).
- Excluded from the copy: `python-service/contract_extraction_agent.py` and the
  `/extract-v2/*` endpoints (experimental LangGraph agent with in-memory checkpointing),
  Stripe/PostHog/Upstash code, marketing pages, blog, waitlist, pricing/FAQ pages,
  Vercel config.
- All "Renewl" branding renamed to "OpenRenew".

## Architecture — docker-compose, 4 containers

| Service    | Image / build                     | Exposure       |
|------------|-----------------------------------|----------------|
| `web`      | Next.js 16 standalone build       | `:3000` (host) |
| `python`   | FastAPI (pdfplumber + Anthropic)  | internal only  |
| `postgres` | `postgres:16` + named volume      | internal only  |
| `cron`     | alpine + crond, curls `web` daily | —              |

- Shared named volume `contracts-data` mounted at `/data/contracts` in both `web` and
  `python` — replaces Supabase Storage.
- `web → python` auth unchanged: `Authorization: Bearer <EXTRACTION_SERVICE_SECRET>`.
- `cron` hits `GET /api/cron/send-alerts` (daily) and `GET /api/cron/send-weekly-digest`
  (Mondays) with `CRON_SECRET`.
- `.env.example`: `POSTGRES_PASSWORD`, `SESSION_SECRET`, `EXTRACTION_SERVICE_SECRET`,
  `CRON_SECRET`, `APP_URL`; optional: `ANTHROPIC_API_KEY`, `SMTP_HOST/PORT/USER/PASS/FROM`,
  `AUTH_DISABLED`.

## Replacement Map

| Renewl (SaaS)                          | OpenRenew                                              |
|----------------------------------------|--------------------------------------------------------|
| Supabase Postgres + RLS                | Plain Postgres via **Drizzle ORM**; migrations run on `web` startup |
| Supabase Auth (Google OAuth, magic link) | Local email/password: bcrypt, signed httpOnly session cookie, middleware guard |
| Supabase Storage signed URLs           | Local disk on shared volume; Python endpoints accept a file **path** (SSRF URL validation retained for URL mode) |
| Resend + Vercel cron                   | Slack incoming webhook (primary) + optional SMTP (nodemailer); cron sidecar |
| Stripe, plans, 20-contract free cap    | Removed — no tiers, no gating                          |
| PostHog                                | Removed — zero telemetry (stated in README)            |
| Upstash rate limiting                  | Removed                                                |
| Marketing pages / blog / waitlist      | Removed — `/` redirects to login or dashboard          |

## Auth & Workspace Model

- Single shared workspace per install: all authenticated users see all contracts.
- First run: empty `users` table → `/setup` page creates the admin account.
- Admin adds teammates (email + initial password) from Settings — no SMTP dependency.
- `user_id` columns renamed/repurposed as `created_by` — retained for `activity_log`
  attribution, no longer used for data scoping.
- Sessions: signed (HMAC via `SESSION_SECRET`) httpOnly cookie; middleware redirects
  unauthenticated requests to `/login`.
- `AUTH_DISABLED=true` env flag skips auth for localhost POC — default off; persistent
  warning banner shown when enabled.
- RLS is gone; authorization is app-level (any logged-in user).

## Alerts

- Generation logic in `lib/alerts.ts` unchanged (60/30/7-day tiers + notice-deadline
  alert; same `alerts` table and idempotent upsert).
- Delivery channels, checked in `/api/cron/send-alerts`:
  1. **Slack webhook** — instance-level setting stored in DB, set via Settings page with
     a "send test message" button. Simple JSON POST, no SDK.
  2. **SMTP email** — optional, env-var configured (nodemailer), reusing existing HTML
     templates from `lib/email.ts`; recipients list is an instance-level setting.
  3. **Dashboard fallback** — if neither is configured, due alerts render as a dashboard
     banner so the product visibly works with zero config.
- Weekly digest kept, same channels.

## AI — Optional `ANTHROPIC_API_KEY`

- **Key absent:** upload stores the PDF; party detection and extraction are skipped;
  review screen starts blank for manual entry (existing manual flow); analysis, compare,
  and draft-email actions render disabled with "Add ANTHROPIC_API_KEY to enable."
- **Key present:** full pipeline — Haiku party detection → user confirms names →
  regex anonymization (party names → "Party A"/"Party B") → Sonnet forced-tool-call
  extraction → Haiku risk analysis / comparison / email drafting.
- Anonymization is highlighted in the README as a privacy feature.
- Model config unchanged: `AI_MODEL` env (default `claude-sonnet-4-6`), `ANALYSIS_MODEL`
  (default `claude-haiku-4-5-20251001`).

## Surviving vs. Retired Hard Rules

Survive: inline styles only; `setTimeout` chains (no `setInterval`); font CSS variables;
advisory (never blocking) date-order warnings; forced tool call for extraction;
`party_a`/`party_b` schema.
Retired: `maxDuration = 60` (Vercel-specific — analysis still runs post-response, but no
platform time limit), free-tier cap, tier gating (`getUserTier` and friends deleted).

## Error Handling

- Python `ExtractionError` → structured JSON contract unchanged.
- Extraction failure/timeout → manual-entry fallback (existing behavior).
- Slack/SMTP send failures mark alert rows `failed` with `failure_reason` (existing
  cron behavior), surfaced in logs.
- Startup fails fast with a clear message if required env vars are missing.

## Testing

- Jest suites (alerts, confirm, cron pagination, middleware) adapted to the Drizzle layer.
- Python `pytest` suite carries over minus extract-v2 tests.
- Release gate: `docker compose up` smoke test — first-run setup → create manual
  contract → verify alert rows → (with key) upload PDF → extraction → analysis.

## README / Launch Assets

Quickstart (3 commands), screenshots, architecture diagram, privacy story (self-hosted,
anonymization, zero telemetry), config reference table, roadmap (OIDC/SSO, Ollama,
MS Teams, CSV import), AGPL notice. Launch: Show HN post-mortem + r/selfhosted +
awesome-selfhosted PR.

## Effort Envelope

Largest item: Supabase→Drizzle migration across ~15 API routes and page loaders
(mechanical, broad). Bounded items: auth (~2–3 days), storage (~1 day), alerts (~1 day),
stripping SaaS code (~1 day), docker + README (~1 day).
