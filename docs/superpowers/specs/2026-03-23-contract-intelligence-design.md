# Contract Intelligence — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Feature:** Second Claude pass on confirmed contracts surfacing risk flags, unfavourable clauses, and actionable insights.

---

## Overview

A "Contract Intelligence" panel on the contract detail page (`/dashboard/contracts/[id]`) that automatically analyses confirmed contracts using Claude Haiku and surfaces business-level risk findings. This transforms Renewl from a reminder tool into a contract intelligence tool.

Analysis runs asynchronously after confirmation. The panel shows a loading state immediately, then populates findings via client-side polling.

---

## Architecture Decision

**Claude is called from the Python microservice**, not from Next.js directly.

The Python service gains a new `/analyse` endpoint that:
1. Downloads the PDF from a Supabase Storage URL
2. Extracts text via pdfplumber (reusing existing `extract_text_from_bytes` + `truncate_text` helpers)
3. Calls Claude Haiku with the analysis prompt
4. Returns `{ findings: [...] }`

Next.js `/api/analyse` is a thin orchestrator: auth → fetch contract → call Python `/analyse` → write to DB → return findings. No Anthropic SDK added to Next.js.

**Why this approach:** All AI calls stay in the Python service where `litellm`, the Anthropic key, and text-extraction logic already live. Consistent with the existing `/extract` pattern.

---

## Database

### New table: `contract_analysis`

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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, analysis_version)
);

ALTER TABLE public.contract_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access their own contract analysis"
ON public.contract_analysis FOR ALL
USING (user_id = auth.uid());

CREATE INDEX idx_contract_analysis_contract_id
  ON public.contract_analysis(contract_id);
```

The `UNIQUE(contract_id, analysis_version)` constraint makes concurrent duplicate triggers safe — the second insert fails cleanly with a unique violation rather than producing a duplicate row at the same version number.

### `findings` JSONB structure

```json
[
  {
    "type": "warning",
    "category": "auto_renewal",
    "title": "Auto-renewal with no price cap",
    "explanation": "The vendor can increase pricing by any amount at renewal. No ceiling is specified.",
    "action": "Ask vendor to add a price escalation cap (e.g. CPI + 3%) at next renewal",
    "severity": "medium"
  },
  {
    "type": "positive",
    "category": "liability",
    "title": "Liability is capped",
    "explanation": "Liability limited to 12 months of fees paid. Standard for this contract type.",
    "action": null,
    "severity": null
  }
]
```

**Finding types:** `warning` | `positive` | `info`
**Severity (warnings only):** `high` | `medium` | `low`
**Categories:** `auto_renewal` | `notice_period` | `liability` | `payment_terms` | `termination` | `ip_ownership` | `data_privacy` | `price_escalation` | `exclusivity` | `governing_law` | `other`

---

## Python Microservice — New `/analyse` Endpoint

Add `POST /analyse` to `python-service/main.py`. Reuses existing `ExtractRequest` model (same `file_url` + optional `contract_id` shape), or a new `AnalyseRequest` with additional contract metadata fields.

**PDF re-extraction trade-off (v1 decision: re-download):** The `/analyse` endpoint re-downloads and re-extracts the PDF text even though the same text was extracted during `/extract`. This is intentional in v1 — it keeps the two endpoints fully decoupled and allows `/analyse` to run standalone without depending on a prior extraction having stored the text. The stored `raw_text_used` column on `contract_analysis` serves as an audit log of what text was actually analysed. A future optimisation could pass the previously-extracted text directly to `/analyse`, skipping the redundant download, but that would require storing raw text somewhere accessible (e.g. on the `contracts` table or passed through `triggerAnalysis`). Not in scope for v1.

```python
class AnalyseRequest(BaseModel):
    file_url: str
    contract_id: Optional[str] = None
    # Pre-extracted fields passed as context to Claude
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    category: Optional[str] = None
    auto_renew: Optional[bool] = None
    notice_period_days: Optional[int] = None
    contract_value: Optional[str] = None
    expiry_date: Optional[str] = None
```

**Steps:**
1. `verify_auth` dependency (same shared secret as `/extract`)
2. `validate_file_url(request.file_url)`
3. Download PDF via httpx, extract text via pdfplumber
4. Truncate text using existing `truncate_text()` helper
5. Call Claude Haiku with analysis system prompt + user message (see Prompt section)
6. Parse JSON array from response
7. Return `{ "findings": [...], "raw_text_length": int }`

**Error handling:**
- PDF download fails → HTTP 422 `file_download_failed`
- No text extracted → HTTP 422 `no_text_extracted`
- Claude returns malformed JSON → HTTP 503 `analysis_failed`
- Never raises on empty findings — empty array is a valid result

---

## Analysis Prompt

**Model:** `claude-haiku-4-5` (via `litellm`, consistent with existing extraction)

**System prompt:**
```
You are a contract analysis assistant helping ops and finance teams
understand the business implications of their vendor contracts.

Your job is to identify clauses that could create financial risk,
operational inflexibility, or unexpected obligations.

You are NOT providing legal advice. You are surfacing business-level
observations that a non-lawyer ops or finance person would find useful.

Rules:
- Focus on clauses that affect money, timing, and exit flexibility
- Be specific — quote or paraphrase the relevant clause
- Keep explanations under 2 sentences
- Keep action items practical and concrete
- Do not hallucinate clauses that are not present
- If a clause is standard and acceptable, note it as a positive finding
- Maximum 8 findings total — prioritise the most impactful
- Output ONLY valid JSON array, no markdown wrapper
```

**User message template:**
```
Analyse this contract for business risk and return a JSON array of findings.

Contract details already extracted:
- Party A (vendor): {party_a}
- Party B (customer): {party_b}
- Category: {category}
- Auto-renews: {auto_renew}
- Notice period: {notice_period_days} days
- Contract value: {contract_value}
- Expiry: {expiry_date}

Full contract text:
"""
{contract_text}
"""

Return a JSON array where each item has:
- type: "warning" | "positive" | "info"
- category: one of [auto_renewal, notice_period, liability, payment_terms,
  termination, ip_ownership, data_privacy, price_escalation, exclusivity,
  governing_law, other]
- title: short label (max 8 words)
- explanation: what this means in plain English (max 2 sentences)
- action: what to do about it (max 1 sentence, null for positives)
- severity: "high" | "medium" | "low" | null (null for non-warnings)

Output ONLY the JSON array. No other text.
```

The pre-extracted fields give Claude context to cross-check against, avoiding re-extraction of already-confirmed values.

---

## Next.js API Routes

### `GET /api/analyse?contract_id=<uuid>`

Returns existing analysis from the DB without triggering a new one. Used by the client polling loop.

**Auth:** Required. Return `{ findings: null }` with status 401 if no session. Do not expose findings to unauthenticated callers.

**Response shapes:**

```typescript
// Analysis found:
{ findings: Finding[], analysis_version: number, created_at: string }

// Not yet analysed (keep polling):
{ findings: null }

// Analysed but no findings (stop polling):
{ findings: [] }

// Error state:
{ findings: [], error: string }
```

The `findings: null` response is the "keep polling" sentinel. An empty array `[]` means analysis completed with no findings — the panel should stop polling and show the empty state.

### `POST /api/analyse`

Auth-gated. Called by the confirm route's fire-and-forget trigger to run a new analysis and persist it.

**Request:** `{ contract_id: string }`

**Steps:**
1. Auth check — 401 if no session
2. Verify contract ownership via `sessionClient` — 404 if not found or not owned by user
3. Call `triggerAnalysis(contract_id, userId)` from `lib/analysis.ts`
4. Return `{ findings: [...] }` on success, `{ findings: [], error: 'analysis_failed' }` on failure

**`maxDuration = 60`** set on this route.

The route is intentionally thin. All idempotency, signed URL generation, Python call, and DB writes are handled inside `triggerAnalysis`. The confirm route also calls `triggerAnalysis` directly (fire-and-forget) rather than going through this route.

**Error behaviour:** Analysis failures return gracefully. The confirm flow is never affected.

### `app/api/confirm/route.ts` — async trigger

**Do not place the trigger after the `return` statement** — code after `return` is dead code and will never execute.

Instead, extract the analysis trigger into a shared helper function `triggerAnalysis(contractId: string, userId: string)` in `lib/analysis.ts`. This function:
- Creates its own Supabase admin client internally
- Calls the Python `/analyse` endpoint directly (same pattern as `/api/extract`)
- Writes results to `contract_analysis`
- Inserts `activity_log` row

The confirm route calls this helper with `void` before returning:

```typescript
// In app/api/confirm/route.ts — before the return statement
void triggerAnalysis(contract_id, userId).catch(err =>
  console.error('Analysis trigger failed:', err)
);

return NextResponse.json({ ok: true });
```

This avoids the cookie-forwarding self-call pattern, which is unreliable in Next.js App Router (session cookies from an incoming request cannot be reliably forwarded to an outbound self-fetch and re-validated by `createClient()` in a concurrent request). The shared helper keeps auth and DB access within a single request lifecycle using the admin client.

### `lib/analysis.ts` — shared trigger helper

New file. Exports `triggerAnalysis(contractId: string, userId: string): Promise<{ findings: Finding[] }>`.

Use `createClient` from `@supabase/supabase-js` directly with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — matching the admin client pattern in `/api/extract/route.ts` lines 56-58. Do not use `createServerClient` from `@supabase/ssr` here.

**Steps:**
1. **Idempotency check:** Query `contract_analysis WHERE contract_id = X ORDER BY analysis_version DESC LIMIT 1`. If a row exists and its `created_at` is within the last 60 seconds, return its findings immediately (duplicate trigger guard — covers double-confirm clicks). Otherwise compute `next_version = max + 1` (or `1` if no rows exist).
2. Fetch full contract row from DB (admin client) — needed for `file_path` and pre-extracted fields
3. Generate signed URL for `contract.file_path` using the admin client (session client cannot generate signed URLs)
4. Call `PYTHON_SERVICE_URL/analyse` with `file_url` + pre-extracted fields (`party_a`, `party_b`, `category`, `auto_renew`, `notice_period_days`, `contract_value`, `expiry_date`)
5. Write results to `contract_analysis` with `analysis_version = next_version`
6. Insert `activity_log` row: `event_type: 'contract_analysed'`
7. Return `{ findings }`

Both `app/api/confirm/route.ts` (fire-and-forget) and `app/api/analyse/route.ts` (POST handler) call this helper.

### Re-analysis on re-confirm

When a user edits and re-confirms a contract, the confirm route fires `triggerAnalysis` again. The helper:
- Queries max existing `analysis_version` for this contract
- Inserts a new row with `analysis_version = max + 1`
- Previous analysis rows remain in the table for audit

---

## `lib/types/database.ts` update

Add `contract_analysis` table types manually (matching the migration schema).

Also add `target_date: string` to all three shapes (`Row`, `Insert`, `Update`) of the `alerts` table in `lib/types/database.ts` — the column was added in migration `20260322000000_review_ui_schema.sql` but was never added to the TS types.

> **Bundled housekeeping fix** — this is a pre-existing gap unrelated to the analysis feature. It is included here for convenience since `lib/types/database.ts` is being touched anyway, but reviewers should understand it is not part of the Contract Intelligence feature itself.

---

## Frontend — Intelligence Panel

**Location:** `components/contracts/ContractDetailClient.tsx`
**Position:** Below the countdown section (Section 5), above the existing `<Divider />` + `AlertStatusRow` footer.

### Component: `ContractIntelligencePanel`

Extract as a self-contained component (new file: `components/contracts/ContractIntelligencePanel.tsx`). Accepts `contractId: string` as its only prop. Manages its own fetch + polling state internally.

**Polling behaviour:**
- On mount: immediately call `GET /api/analyse?contract_id=<id>`
- If response is `{ findings: null }`: poll every 3 seconds
- If response is `{ findings: [...] }` (including empty array): stop polling, render findings
- Timeout after 60 seconds of `findings: null` responses — show error state
- Stop polling on any network error
- **Cleanup on unmount:** The `useEffect` hook that owns the polling interval/timeout must return a cleanup function that clears both the interval and the timeout. This prevents leaked timers when the user navigates away before analysis completes.

**Three visual states:**

**Loading:**
```
CONTRACT INTELLIGENCE
─────────────────────
● [pulsing]  Analysing contract...
Powered by Claude · For informational purposes only · Not legal advice
```

**Findings present (open by default when any `warning` exists):**
- Header: `CONTRACT INTELLIGENCE` [emerald, 11px, monospace, uppercase] + `▾ HIDE` toggle
- Separator line
- Each finding: icon + title (14px bold) + explanation (13px muted) + optional action (12px emerald, clickable)
- Action items: hover reveals subtle `copy` badge (11px, muted, bordered); click copies action text to clipboard with a "Copied" toast
- Disclaimer at bottom

**No warnings (collapsed by default):**
- Header shows: `CONTRACT INTELLIGENCE` + `No critical flags` (muted, 11px) + `▸ SHOW` toggle
- Body hidden until user expands

### Visual spec

| Element | Value |
|---|---|
| Panel background | `rgba(255,255,255,0.03)` |
| Panel border | `1px solid rgba(255,255,255,0.08)` |
| Section label | `#10B981`, uppercase, monospace, 11px, `0.12em` letter-spacing |
| Warning icon `⚠` | `#F59E0B` |
| Positive icon `✓` | `#10B981` |
| Info icon `ℹ` | `#6B7280` |
| Finding title | 14px bold, `#F9FAFB` |
| Explanation | 13px, `#6B7280`, `line-height: 1.5` |
| Action text | 12px, `#10B981` |
| Copy badge | 11px, `#4B5563`, `1px solid rgba(255,255,255,0.1)`, `border-radius: 3px`, opacity 0 → 1 on hover |
| Copied toast | `background: #10B981`, `color: #0A0F1E`, positioned above action text, fades out after 1.5s |
| Disclaimer | 11px, `#4B5563`, italic |
| Finding separator | `1px solid rgba(255,255,255,0.04)` |
| Toggle label | 11px, `#4B5563` |

**Finding sort order:** warnings (high → medium → low), then positives, then info.

---

## Files to Create / Modify

| File | Change |
|---|---|
| `supabase/migrations/YYYYMMDD_contract_analysis.sql` | New table migration |
| `python-service/main.py` | Add `POST /analyse` endpoint |
| `app/api/analyse/route.ts` | New POST (trigger/write) + GET (read existing) handlers |
| `lib/analysis.ts` | New `triggerAnalysis` helper — admin client via `@supabase/supabase-js`, idempotency guard, Python call, DB write |
| `app/api/confirm/route.ts` | Add `void triggerAnalysis(...)` fire-and-forget **before** `return NextResponse.json({ ok: true })` |
| `components/contracts/ContractIntelligencePanel.tsx` | New self-contained panel component |
| `components/contracts/ContractDetailClient.tsx` | Import and render `ContractIntelligencePanel` below countdown section |
| `lib/types/database.ts` | Add `contract_analysis` table types |

---

## Do Not Change

- Existing extraction flow (`/api/extract`, `/extract` Python endpoint)
- Contract confirmation logic (other than the async trigger addition)
- Alert generation (`lib/alerts.ts`)
- Any other dashboard components

---

## Tier Access

Available on **both Free and Pro** tiers in v1. Analysis is a core value driver that helps free users understand why Renewl is worth upgrading.

---

## Verification Checklist

- [ ] Migration runs cleanly in Supabase
- [ ] Confirm a contract → analysis triggers in background automatically
- [ ] Contract detail page shows "Analysing..." then findings appear (via polling)
- [ ] Countdown section is unaffected during analysis loading
- [ ] Warnings render in amber, positives in green, info in muted
- [ ] Action item → hover shows copy badge; click copies text; "Copied" toast appears
- [ ] Panel open by default when warnings present
- [ ] Panel collapsed by default when no warnings; "No critical flags" visible in header
- [ ] Re-confirming an edited contract triggers fresh analysis at incremented version
- [ ] Analysis failure returns gracefully — confirm flow unaffected
- [ ] Disclaimer visible at bottom of panel in all states
- [ ] `npm run build` passes
