# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Commits

Keep commit messages short and to the point — one line, no body unless truly necessary. Do not add `Co-Authored-By` trailers.

## Commands

```bash
docker compose up -d      # Start all 4 containers (web, python, postgres, cron)
docker compose down       # Stop them

npm run dev                # Start Next.js dev server (localhost:3000) — needs postgres reachable
npm run build               # Production build
npm run lint                 # Run ESLint
npm run db:generate       # Generate a new Drizzle migration from schema changes
npm run db:migrate         # Apply migrations (also runs automatically on web container start)

npx jest                          # Run all tests
npx jest __tests__/lib/alerts     # Run a single test file
npx jest --testNamePattern "foo"  # Run tests matching a name pattern

# Python service (from python-service/)
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
pytest tests/
```

For local `npm run dev` / `npm run db:migrate` outside Docker, uncomment the `ports` mapping on the `postgres` service in `docker-compose.yml` first.

## Architecture

OpenRenew is a self-hosted, four-container contract renewal tracker (AGPL-3.0). No external SaaS dependencies are required — everything optional degrades gracefully.

**web — Next.js 16 + React 19**
Handles auth, UI, and API orchestration. Next.js API routes validate input, call the Python service over the internal Docker network, and write results to Postgres via Drizzle. They do not call the Anthropic API directly.

**python — FastAPI**
All PDF extraction and Claude API calls live here. The service is stateless — it only reads PDFs from the shared volume (mounted read-only) and talks to Anthropic. Auth between services uses `Authorization: Bearer <EXTRACTION_SERVICE_SECRET>` shared secret. Endpoints:
- `POST /extract` — pdfplumber text extraction + Claude Sonnet structured field parsing
- `POST /extract-file` — same, given a file path already on the shared volume
- `POST /detect-parties` — Claude Haiku party-name detection from the contract's opening lines
- `POST /analyse` — Claude Haiku risk analysis on extracted fields
- `POST /compare` — compare renewal contract against parent contract
- `POST /draft-action-email` — Claude drafts a vendor email (e.g. cancellation notice)
- `GET /health`

Adding any new AI feature means editing `python-service/main.py`, not `app/api/`.

**postgres — Postgres 16 + Drizzle ORM**
Migrations live in `drizzle/`, generated with `npm run db:generate` and auto-applied on web container start (`scripts/migrate.mjs`, invoked from `docker/entrypoint.sh`).

**Storage — shared Docker volume**
PDFs are written to `/data/contracts` (`DATA_DIR`) by `web`; the `python` container mounts the same volume read-only. Path traversal is guarded on both sides — see `lib/storage.ts` (`pdfAbsolutePath`).

**Auth — local, no external provider**
Email/password with bcrypt, JWT session cookie (`openrenew_session`, `jose` HS256, signed with `SESSION_SECRET`). First run redirects to `/setup` to create the admin. Admins add teammates via Settings (`POST /api/auth/users`). Single shared workspace — no per-user data isolation. `AUTH_DISABLED=true` skips login entirely for localhost-only proof-of-concept use; never set it in production. See `lib/auth/session.ts`.

**Alert delivery — instance-level, not per-user**
Slack webhook URL is stored in the `app_settings` table (configured via Settings UI, validated and test-pinged on save — see `app/api/settings/slack/route.ts`). SMTP is configured via env vars (`SMTP_HOST` etc., `lib/email-smtp.ts`). If neither is configured, alerts stay `pending` and the dashboard shows a banner rather than silently dropping them.

**AI — entirely optional**
Gated on `ANTHROPIC_API_KEY` via `aiEnabled()` in `lib/ai.ts`. Without it: manual entry, alerts, dashboard, and everything else still works — only extraction/analysis/comparison/drafting are unavailable. With it: Haiku detects party names from the contract's opening → user confirms → the full contract text is regex-anonymized (`anonymize_text()` in `python-service/main.py`, replacing both real names with "Party A"/"Party B") before it is ever sent to Claude for extraction, analysis, or comparison.

**Key tables:** `users`, `contracts`, `contract_extractions`, `contract_analysis`, `contract_comparisons`, `alerts` (no user column — instance-wide), `activity_log`, `app_settings`.

**Contract lifecycle:**
1. Upload PDF → saved to the shared volume, row created in `contracts`
2. **With AI:** `POST /api/extract` → Python `/detect-parties` → user confirms party names at `/review/new` → `POST /api/extract` (full run) → user reviews extracted fields
   **Without AI:** straight to manual entry at `/review/new`
3. `POST /api/confirm` → alerts generated (60/30/7 days before expiry + notice-period deadline), analysis triggered if AI is enabled
4. Contract goes active
5. Daily cron sidecar (`docker/cron`) curls `GET /api/cron/send-alerts` and weekly `GET /api/cron/send-weekly-digest` with `Authorization: Bearer $CRON_SECRET` → delivered via Slack webhook and/or SMTP

## Critical Constraints

**Inline styles only** — No Tailwind utility classes on dashboard/review/contract-detail pages. All styles are inline style objects. Tailwind is in devDependencies but produces no output. Never add Tailwind classes without migrating all inline styles first. (Decision 004)

**`setInterval` is banned** — Use `setTimeout` chains everywhere to yield to user input. (Decision 020)

**Fonts via CSS variables** — Use `var(--font-jetbrains)` and `var(--font-inter)` only; never hardcode font names. (Decision 017)

**`counterparty_name` no longer exists** — Schema uses `party_a` / `party_b`. Do not reference the old column. (Decision 006)

**Forced tool call for extraction** — Extraction responses are `tool_use` blocks, never raw text. New extracted fields require updating `EXTRACTION_TOOL.input_schema` in `python-service/main.py`. (Decision 019)

**Date order warnings are advisory** — `validateDateOrder()` shows warnings but never blocks confirmation. (Decision 018)

**snake_case at service boundaries** — JSON payloads between `web` and `python`, and between API routes and the frontend, stay snake_case (matching the extraction schema and Python conventions). The Drizzle layer (`lib/db/schema.ts`) is camelCase — mapping happens at the API route boundary, not in the DB layer.

## AI Models

| Task | Model | Configurable |
|------|-------|-------------|
| Extraction | `claude-sonnet-4-6` | `AI_MODEL` env var in Python service |
| Party detection / Analysis | `claude-haiku-4-5-20251001` | `ANALYSIS_MODEL` constant in `python-service/main.py` |

Do not swap models without testing on 10+ real contracts first. (Decision 002)

## Environment Variables

See `.env.example` for the full list; the README's Configuration table documents each one. Key ones to know when working on the code:

| Variable | Notes |
|----------|-------|
| `SESSION_SECRET` | JWT signing key for the session cookie — must be ≥32 chars |
| `EXTRACTION_SERVICE_SECRET` | Shared secret — same value in both `web` and `python` |
| `CRON_SECRET` | Auth token the cron sidecar sends to `/api/cron/*` |
| `ANTHROPIC_API_KEY` | Optional — read independently by both `web` (`lib/ai.ts`, to decide whether to render AI UI) and `python` (to actually call Claude) |
| `AUTH_DISABLED` | `true` bypasses login — dev/localhost only |
| `DATA_DIR` | Contract PDF storage root — `/data/contracts` inside containers |

## Design System

- **Dark theme only** — background `#0A0F1E`, surface `#111827`, accent `#10B981`
- **Email templates** — use hardcoded hex values (`#16a34a`, `#d97706`, `#dc2626`); CSS variables are stripped by email clients
- `marketing.css` uses a slightly different green (`#00c9a0`) — known inconsistency, low priority

## Architecture Decisions

All significant decisions are documented in `DECISIONS.md`. Check it before changing: AI model assignments, schema columns, which service handles a responsibility, or any hard rule listed above.
