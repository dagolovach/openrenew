# PDF Extraction Core — Design Spec

**Date:** 2026-03-21
**Status:** Approved
**Scope:** Week 1 — Python microservice (local) + Next.js extract route + accuracy validation harness

---

## Goal

Build the PDF extraction pipeline: a stateless Python FastAPI microservice that takes a PDF URL, extracts text with pdfplumber, calls the Claude API via tool use, and returns structured contract fields as JSON. A Next.js API route orchestrates the flow and owns all database writes. A CLI test harness validates accuracy against real contracts before any UI is built.

---

## Architecture

Two-service architecture already established in the project:

1. **Python microservice** (`python-service/`) — local FastAPI app during Week 1, deployed to Railway in Week 2
2. **Next.js extract route** (`app/api/extract/route.ts`) — auth-gated, orchestrates the flow, owns all Supabase writes

**Data flow:**

```
Browser → POST /api/extract { contract_id }
  → sessionClient: fetch contract, verify ownership
  → adminClient: generate signed URL (60s expiry)
  → Python service POST /extract { file_url, contract_id }
    → httpx downloads PDF from Supabase Storage
    → pdfplumber extracts text (first 30k + last 10k chars)
    → Claude API tool use → structured JSON
    → returns { fields, confidence, model, raw_text_length, extraction_time_ms }
  → Next.js: branch on result (see Error Handling)
  → sessionClient: upsert contract_extractions (one row per field)
  → sessionClient: update contracts.extraction_status + updated_at
  → sessionClient: insert activity_log row
```

The Python service is **stateless** — it receives a URL, returns JSON, touches no database and holds no credentials beyond `ANTHROPIC_API_KEY`.

---

## File Structure

```
python-service/
  main.py              # FastAPI app — single file with section comments
  requirements.txt     # fastapi, uvicorn, pdfplumber, anthropic, httpx, python-dotenv
  test_accuracy.py     # CLI accuracy validation script
  .env                 # ANTHROPIC_API_KEY (gitignored)
  .env.example         # committed template
  Dockerfile           # ready for Railway deployment
  railway.toml         # Railway config
  contracts/           # gitignored — drop test PDFs here

app/api/extract/
  route.ts             # Next.js extract route (existing placeholder, implemented)
```

---

## Python Microservice (`main.py`)

### Structure

Single file with clear section comments to make future modularisation trivial:

```python
# ── Response models ───────────────────────────────────
# ── PDF extraction (pdfplumber) ──────────────────────
# ── Claude API call ──────────────────────────────────
# ── FastAPI app ──────────────────────────────────────
```

### Endpoints

**`POST /extract`** — production endpoint
```json
Request:  { "file_url": "https://...supabase.co/...", "contract_id": "uuid" }
Response: { "contract_id": "uuid", "fields": {...}, "confidence": 0.94,
            "model": "claude-sonnet-4-6", "raw_text_length": 4832, "extraction_time_ms": 2341 }
```

**`POST /extract-file`** — local test endpoint (multipart file upload)
Same extraction function internally. Used by `test_accuracy.py` to avoid needing a local file server.

**`GET /health`** — Railway health check
Returns `{ "status": "ok" }`.

Both `/extract` and `/extract-file` call the **same internal extraction function** — no divergence in code path.

### Text Extraction Strategy

pdfplumber extracts full text. For long contracts, truncate to keep:
- First **30,000 characters** (opening terms, parties, key dates)
- Last **10,000 characters** (schedules, appendices — where notice periods often hide)
- Separator: `\n\n[...middle section truncated...]\n\n`

Total max: 40,000 characters sent to Claude.

### Claude Tool Schema

Tool name: `extract_contract_fields`
Model: `claude-sonnet-4-6`
All 9 fields required in the response:

| Field | Type | Notes |
|-------|------|-------|
| `effective_date` | `string \| null` | ISO 8601 or null |
| `expiry_date` | `string \| null` | ISO 8601 or null |
| `renewal_date` | `string \| null` | ISO 8601 or null; null if same as expiry |
| `auto_renew` | `boolean` | `true` only if explicit auto-renewal language present |
| `notice_period_days` | `integer \| null` | Numeric days or null |
| `notice_period_text` | `string \| null` | Exact text from contract |
| `contract_value` | `string \| null` | Preserve original format (e.g. "£12,000 per annum + VAT") |
| `counterparty_name` | `string \| null` | Legal entity name |
| `confidence` | `number` | 0.0–1.0, single score for whole extraction (v1) |

**Confidence is a single float** for the whole extraction in v1. The review UI applies the same confidence colour to all fields: 🟢 ≥0.90 (one-click confirm), 🟡 0.70–0.89 (highlight fields for review), 🔴 <0.70 (show PDF alongside, encourage manual entry). Per-field confidence is a v1.1 consideration if accuracy testing reveals consistent per-field variation.

### Error Responses

The Python service always returns what it found — good, partial, or nothing. Next.js decides what to do.

| Status | `error` field | Cause |
|--------|--------------|-------|
| `422` | `no_text_extracted` | Scanned PDF / pdfplumber got zero text |
| `422` | `file_download_failed` | httpx could not fetch the URL |
| `503` | `claude_api_error` | Anthropic API error or timeout |

### Environment

```
ANTHROPIC_API_KEY=...   # required
```

---

## Next.js Extract Route (`app/api/extract/route.ts`)

### Route Config

```typescript
export const maxDuration = 60;    // Vercel: extend past 10s default
export const dynamic = "force-dynamic";
```

### Clients

- **`sessionClient`** — `createClient()` from `@/lib/supabase/server` — used for all database reads and writes (RLS enforces ownership automatically)
- **`adminClient`** — `createClient(url, serviceRoleKey)` from `@supabase/supabase-js` — used **only** for generating the storage signed URL (requires storage admin access)

### Handler Steps

1. **Auth** — get user from session; `401` if missing
2. **Fetch contract** — via `sessionClient`; `404` if not found or not owned by user
3. **Guard** — `409` if `status` is already `'review'` or `'confirmed'`
4. **Signed URL** — via `adminClient`, 60-second expiry
5. **Call Python service** — `fetch(PYTHON_SERVICE_URL + '/extract', ...)`, timeout 55s via `AbortController` + `AbortSignal.timeout(55000)`. On `AbortError` or any network error → treat as timeout, apply `'manual'` branch
6. **Branch on result** (see below)
7. **Upsert `contract_extractions`** — one row per field, `upsert` on `(contract_id, field_name)`; `extracted_value` = stringified field value, `confidence` = overall confidence score on every row (v1), `confirmed_value` = null
8. **Update `contracts`** — set `extraction_status`, `extraction_confidence` (overall float), `updated_at`
9. **Insert `activity_log`** — `{ event_type: 'extraction_complete', metadata: { model, confidence, raw_text_length } }` — note: column is `event_type` not `event`

`PYTHON_SERVICE_URL` defaults to `http://localhost:8000` — no config change needed for local dev, one env var change for Railway.

### Error Handling Branches

| Condition | `extraction_status` | `status` | Response to client |
|-----------|--------------------|---------|--------------------|
| Python error / timeout | `'manual'` | `'review'` | `{ status:'manual', message:'Extraction failed. Please enter dates manually.' }` |
| `no_text_extracted` (scanned PDF) | `'manual'` | `'review'` | `{ status:'manual', message:'This looks like a scanned PDF. Please enter the dates manually.' }` |
| `file_download_failed` | `'manual'` | `'review'` | `{ status:'manual', message:'Could not read the file. Please try again or enter dates manually.' }` |
| `confidence < 0.70` (average low) | `'review'` | `'review'` | `{ status:'review', low_confidence: true }` — fields still written; UI shows warning banner |
| Success | `'review'` | `'review'` | `{ status:'review', contract_id }` |

**Key rule:** `extraction_status = 'manual'` only when there is genuinely nothing to show the user. Low confidence still writes all extracted fields and lets the user verify them.

---

## Test Harness (`test_accuracy.py`)

### Usage

```bash
cd python-service
python test_accuracy.py contracts/          # all PDFs in directory
python test_accuracy.py contracts/aws.pdf   # single file
```

### Output

Per-file table with `✓` (extracted) / `✗` (null or error) per field, plus confidence indicator:

```
┌─────────────────────────┬──────────────┬───────────┬───────────┬──────────┬──────────┬───────────┬───────────────┬────────────┬────────────┐
│ file                    │ counterparty │ eff. date │ exp. date │ ren.date │ auto_ren │ notice    │ value         │ confidence │ time (ms)  │
├─────────────────────────┼──────────────┼───────────┼───────────┼──────────┼──────────┼───────────┼───────────────┼────────────┼────────────┤
│ aws-enterprise.pdf      │ ✓ Amazon     │ ✓ 2024-01 │ ✓ 2025-01 │ ✗ null   │ ✓ true   │ ✓ 30 days │ ✓ $48,000/yr  │ 0.94 🟢    │ 3,241      │
│ office-lease.pdf        │ ✓ WeWork     │ ✓ 2023-06 │ ✓ 2024-06 │ ✗ null   │ ✗ null   │ ✓ 60 days │ ✓ £2,500/mo   │ 0.81 🟡    │ 2,890      │
│ scanned-contract.pdf    │ ✗ error      │ ✗ error   │ ✗ error   │ ✗ error  │ ✗ error  │ ✗ error   │ ✗ error       │ no_text    │ 891        │
└─────────────────────────┴──────────────┴───────────┴───────────┴──────────┴──────────┴───────────┴───────────────┴────────────┴────────────┘

Summary: 2/3 succeeded · avg confidence 0.875 · fields extracted: 13/16 (81%) · avg time 3,066ms
Scanned/failed: 1 (scanned-contract.pdf)
```

**Confidence indicators:** 🟢 ≥0.90 · 🟡 0.70–0.89 · 🔴 <0.70

This is an **inspection tool, not a test suite** — no assertions, no pass/fail. You read the output and decide if accuracy is sufficient before proceeding to the review UI.

---

## Deployment Prep

### `Dockerfile`

Standard Python 3.12 slim image, installs requirements, exposes port 8080.

### `railway.toml`

```toml
[build]
builder = "dockerfile"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
```

`${PORT:-8080}` — uses Railway's injected `PORT` in production, falls back to `8080` locally.

### `.env.example`

```
ANTHROPIC_API_KEY=your-key-here
```

**Port note:** The Python service runs on port **8000** locally (uvicorn default in `.env` / dev command) and on Railway's injected `PORT` (fallback 8080) in production. `PYTHON_SERVICE_URL` in Next.js handles both — `http://localhost:8000` locally, Railway URL in production. No code change needed between environments.

### Railway Environment Variables (set when deploying in Week 2)

- `ANTHROPIC_API_KEY`
- `PORT` — injected automatically by Railway

### Next.js Environment Variables (add before testing locally)

- `PYTHON_SERVICE_URL` — defaults to `http://localhost:8000` if not set (server-side only — never `NEXT_PUBLIC_`)
- `SUPABASE_SERVICE_ROLE_KEY` — already in `.env.local`; used only server-side for generating signed URLs

Add this to `.env.local` (commented out — the default is fine for local dev):
```
# PYTHON_SERVICE_URL=http://localhost:8000  # uncomment to override default
```

---

## What This Does NOT Include

- PDF upload UI (Week 2)
- Review screen / confirmation flow (Week 2)
- Contract dashboard (Week 3)
- Railway deployment (Week 2, after accuracy validation passes)

---

## Accuracy Target

85%+ of fields confirmed without user edits across 20 real contracts, per the build bible. Run `test_accuracy.py` against your contract sample before proceeding to Week 2.
