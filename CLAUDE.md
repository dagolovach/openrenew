# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Commits

Keep commit messages short and to the point — one line, no body unless truly necessary. Do not add `Co-Authored-By` trailers.

## Commands

```bash
npm run dev        # Start Next.js dev server (localhost:3000)
npm run build      # Production build
npm run lint       # Run ESLint

npx jest                          # Run all tests
npx jest __tests__/lib/alerts     # Run a single test file
npx jest --testNamePattern "foo"  # Run tests matching a name pattern

# Python service (from python-service/)
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
pytest tests/
```

## Architecture

Renewl is a two-service SaaS app for contract renewal tracking.

**Frontend/Orchestration — Next.js 16 + React 19 (Vercel)**
Next.js API routes are thin orchestrators: they validate input, generate signed Supabase URLs, call the Python service, and write results to Supabase. They do not call the Anthropic API directly.

**AI/PDF Processing — Python FastAPI (Railway)**
All PDF extraction and Claude API calls live here. The service is stateless (no Supabase credentials). Auth between services uses `Authorization: Bearer <EXTRACTION_SERVICE_SECRET>` shared secret. Endpoints:
- `POST /extract` — pdfplumber text extraction + Claude Sonnet structured field parsing
- `POST /analyse` — Claude Haiku risk analysis on extracted fields
- `POST /compare` — compare renewal contract against parent contract
- `GET /health`

Adding any new AI feature means editing `python-service/main.py`, not `app/api/`.

**Database, Auth, Storage — Supabase**
- PostgreSQL with RLS on all tables; session client enforces user isolation, admin client (bypasses RLS) is used only in cron jobs with explicit `.eq('user_id', ...)` as defence-in-depth
- Auth: Google OAuth + Magic Link (no passwords)
- Storage: private `contracts/` bucket, signed URLs (600s validity)

**Key tables:** `profiles`, `contracts`, `contract_extractions`, `contract_analysis`, `contract_comparisons`, `alerts`, `activity_log`

**Contract lifecycle:**
1. Upload PDF → signed URL stored in Supabase
2. `POST /api/extract` → async Python `/extract` → polls every 3s for status
3. User reviews extraction at `/review/new`, confirms party names
4. `POST /api/confirm` → awaits `triggerAnalysis()` within 60s `maxDuration`
5. Contract goes active; alerts are generated (60/30/7 days before expiry + notice deadline)
6. Daily Vercel cron hits `GET /api/cron/send-alerts` → queries `alerts` table, sends via Resend

## Critical Constraints

**Inline styles only** — No Tailwind utility classes on dashboard/review/contract-detail pages. All styles are inline style objects. Tailwind is in devDependencies but produces no output. Never add Tailwind classes without migrating all inline styles first. (Decision 004)

**`maxDuration = 60` on `/api/confirm` is load-bearing** — Do not remove it. Analysis is awaited synchronously there. (Decision 010)

**`setInterval` is banned** — Use `setTimeout` chains everywhere to yield to user input. (Decision 020)

**Fonts via CSS variables** — Use `var(--font-jetbrains)` and `var(--font-inter)` only; never hardcode font names. (Decision 017)

**`counterparty_name` no longer exists** — Schema uses `party_a` / `party_b`. Do not reference the old column. (Decision 006)

**Forced tool call for extraction** — Extraction responses are `tool_use` blocks, never raw text. New extracted fields require updating `EXTRACTION_TOOL.input_schema` in `python-service/main.py`. (Decision 019)

**Date order warnings are advisory** — `validateDateOrder()` shows warnings but never blocks confirmation. (Decision 018)

**Free tier cap** — 20-contract limit enforced in `/api/upload`. (Decision 011)

## AI Models

| Task | Model | Configurable |
|------|-------|-------------|
| Extraction | `claude-sonnet-4-6` | `AI_MODEL` env var in Python service |
| Analysis | `claude-haiku-4-5-20251001` | `ANALYSIS_MODEL` constant in `python-service/main.py` |

Do not swap models without testing on 10+ real contracts first. (Decision 002)

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only — never expose to client |
| `PYTHON_SERVICE_URL` | Railway deployment URL |
| `EXTRACTION_SERVICE_SECRET` | Shared secret — same value in both services |
| `CRON_SECRET` | Vercel cron auth — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `APP_URL` | Base URL used in email templates (`https://getrenewl.com` in prod) |
| `ANTHROPIC_API_KEY` | Python service only (not used in Next.js) |

## Design System

- **Dark theme only** — background `#0A0F1E`, surface `#111827`, accent `#10B981`
- **Email templates** — use hardcoded hex values (`#16a34a`, `#d97706`, `#dc2626`); CSS variables are stripped by email clients
- `marketing.css` uses a slightly different green (`#00c9a0`) — known inconsistency, low priority

## Architecture Decisions

All significant decisions are documented in `DECISIONS.md`. Check it before changing: AI model assignments, schema columns, which service handles a responsibility, or any hard rule listed above.
