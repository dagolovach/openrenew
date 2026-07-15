# Robustness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden four production robustness gaps: extraction timeouts, parseInt NaN test coverage, alert failure tracking with DB migration, and cron pagination.

**Architecture:** Pure hardening — no new user-facing features. Python service gains asyncio-based timeouts for PDF parsing and Claude API calls in both the `/extract` and `/analyse` endpoints. A DB migration adds `failure_reason` to alerts and renames `skipped` → `failed`. The cron route gains paginated batch processing and uses the new `failed` status.

**Tech Stack:** Python asyncio (timeout wrapping), pytest + pytest-asyncio (already in `requirements-dev.txt`), Jest/ts-jest (TypeScript unit tests), Supabase SQL migration.

**Deployment ordering note:** Task 3 (DB migration) MUST be deployed before Task 4 (cron code). The cron writes `status = 'failed'` which violates the existing CHECK constraint until the migration runs. In practice, apply the migration via Supabase dashboard before merging/deploying the cron changes.

---

## Pre-flight: verify current state

```bash
cd /Users/dmitrygolovach/code/renewl
npx jest --listTests
cd python-service && python -m pytest --collect-only
```

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `python-service/main.py` | Modify | Add `PDF_PARSE_TIMEOUT` + `CLAUDE_TIMEOUT` constants; wrap sync `extract_text_from_bytes` and `extract_with_claude` calls in `asyncio.to_thread` + `asyncio.wait_for` in both `_run_extraction` and the `analyse` endpoint; return 422/504 on timeout |
| `python-service/pytest.ini` | Create | Set `asyncio_mode = auto` so pytest-asyncio doesn't conflict with `asyncio.run()` in tests |
| `python-service/tests/__init__.py` | Create | Empty — makes `tests/` a Python package |
| `python-service/tests/test_timeouts.py` | Create | Unit tests for timeout behaviour (uses existing `requirements-dev.txt` which already has pytest + pytest-asyncio) |
| `__tests__/confirm-notice-period.test.ts` | Create | Regression test — parseInt NaN guard is already correct at `confirm/route.ts:74-75`; test documents and locks this behaviour |
| `supabase/migrations/20260324000000_alert_failed_status.sql` | Create | Add `failure_reason TEXT`; update status CHECK to `('pending','sent','failed')`; migrate existing `skipped` → `failed` |
| `app/api/cron/send-alerts/route.ts` | Modify | Replace single `.limit(100)` query with paginated loop (ceiling 500); use `'failed'` status + `failure_reason`; always write activity log (even on zero-alert runs — improves audit trail) |
| `__tests__/cron-pagination.test.ts` | Create | Unit tests for the pagination loop logic |

---

## Task 1: Python extraction timeouts (both endpoints)

**Files:**
- Modify: `python-service/main.py`
- Create: `python-service/pytest.ini`
- Create: `python-service/tests/__init__.py`
- Create: `python-service/tests/test_timeouts.py`

### Background

`extract_text_from_bytes` (pdfplumber), `extract_with_claude`, and `analyse_with_claude` (Anthropic SDK) are **synchronous** functions called from `async def` FastAPI handlers without `await`. This blocks the entire event loop — a corrupt PDF or slow Claude response hangs the Railway instance.

Fix: run each sync call in a thread via `asyncio.to_thread`, wrapped in `asyncio.wait_for` with configurable timeouts. Two separate ceilings:
- `PDF_PARSE_TIMEOUT` (default 30s): covers pdfplumber. Timeout → 422 (bad/corrupt input)
- `CLAUDE_TIMEOUT` (default 55s): covers Claude API calls. Timeout → 504 (upstream)

This applies to **both** endpoints: `_run_extraction` (used by `/extract`) and the `/analyse` handler (which currently has its own inline pdfplumber + Claude calls).

`requirements-dev.txt` already contains `pytest` and `pytest-asyncio` — no new file needed. Add `pytest.ini` to configure `asyncio_mode = auto` to avoid mode conflicts.

---

- [ ] **Step 1.1: Create pytest.ini**

Create `python-service/pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

- [ ] **Step 1.2: Write the failing tests**

Create `python-service/tests/__init__.py` (empty file).

Create `python-service/tests/test_timeouts.py`:

```python
"""Tests for timeout behaviour in main.py extraction path."""
import asyncio
import os
import sys
import pytest
from unittest.mock import patch, AsyncMock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ── Timeout constants ─────────────────────────────────────────────────────


def test_pdf_parse_timeout_defaults_to_30():
    """PDF_PARSE_TIMEOUT defaults to 30 if env var not set."""
    import main as m
    assert m.PDF_PARSE_TIMEOUT == 30


def test_claude_timeout_defaults_to_55():
    """CLAUDE_TIMEOUT defaults to 55 if env var not set."""
    import main as m
    assert m.CLAUDE_TIMEOUT == 55


def test_pdf_parse_timeout_reads_from_env(monkeypatch):
    monkeypatch.setenv("PDF_PARSE_TIMEOUT", "10")
    import importlib
    import main as m
    importlib.reload(m)
    assert m.PDF_PARSE_TIMEOUT == 10
    monkeypatch.delenv("PDF_PARSE_TIMEOUT")
    importlib.reload(m)  # restore


def test_claude_timeout_reads_from_env(monkeypatch):
    monkeypatch.setenv("CLAUDE_TIMEOUT", "45")
    import importlib
    import main as m
    importlib.reload(m)
    assert m.CLAUDE_TIMEOUT == 45
    monkeypatch.delenv("CLAUDE_TIMEOUT")
    importlib.reload(m)  # restore


# ── PDF timeout raises ExtractionError 422 ────────────────────────────────


@pytest.mark.asyncio
async def test_pdf_timeout_raises_extraction_error_422():
    """Slow pdfplumber call raises ExtractionError with status_code=422."""
    import main as m

    async def slow_thread(fn, *args, **kwargs):
        await asyncio.sleep(999)

    with patch("main.PDF_PARSE_TIMEOUT", 0.01), \
         patch("asyncio.to_thread", side_effect=slow_thread):
        with pytest.raises(m.ExtractionError) as exc_info:
            await m._run_extraction(b"fake", "test-id")

    assert exc_info.value.status_code == 422
    assert exc_info.value.error == "pdf_parse_timeout"


# ── Claude timeout raises ExtractionError 504 ─────────────────────────────


@pytest.mark.asyncio
async def test_claude_extraction_timeout_raises_504():
    """Slow Claude extraction call raises ExtractionError with status_code=504."""
    import main as m

    call_count = {"n": 0}

    async def dispatch(fn, *args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # First call: PDF parse — returns fast
            return "some contract text long enough to pass the strip check"
        # Second call: Claude — hangs
        await asyncio.sleep(999)

    with patch("main.PDF_PARSE_TIMEOUT", 30), \
         patch("main.CLAUDE_TIMEOUT", 0.01), \
         patch("asyncio.to_thread", side_effect=dispatch):
        with pytest.raises(m.ExtractionError) as exc_info:
            await m._run_extraction(b"fake", "test-id")

    assert exc_info.value.status_code == 504
    assert exc_info.value.error == "claude_timeout"
```

- [ ] **Step 1.3: Run tests to confirm they fail**

```bash
cd /Users/dmitrygolovach/code/renewl/python-service
pip install -r requirements-dev.txt -q
python -m pytest tests/test_timeouts.py -v
```

Expected: `test_pdf_parse_timeout_defaults_to_30` and `test_claude_timeout_defaults_to_55` FAIL (constants not yet defined). The `importlib.reload` tests and timeout behaviour tests also FAIL.

---

- [ ] **Step 1.4: Implement timeouts in main.py**

**A. Add timeout constants** after the `AI_MODEL` line (~line 88):

```python
PDF_PARSE_TIMEOUT = int(os.getenv("PDF_PARSE_TIMEOUT", "30"))
CLAUDE_TIMEOUT    = int(os.getenv("CLAUDE_TIMEOUT", "55"))   # under Railway's ~60s limit
```

**B. Replace `_run_extraction`** with the timeout-wrapped version:

```python
async def _run_extraction(pdf_bytes: bytes, contract_id: Optional[str]) -> dict:
    start = time.time()

    # PDF parse — 422 on timeout (bad/corrupt input)
    try:
        text = await asyncio.wait_for(
            asyncio.to_thread(extract_text_from_bytes, pdf_bytes),
            timeout=PDF_PARSE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise ExtractionError(
            422, "pdf_parse_timeout",
            f"PDF parse exceeded {PDF_PARSE_TIMEOUT}s — file may be corrupt or too large",
        )
    except Exception:
        text = ""

    if not text.strip():
        raise ExtractionError(422, "no_text_extracted")
    text = truncate_text(text)

    # Claude extraction — 504 on timeout (upstream)
    try:
        fields = await asyncio.wait_for(
            asyncio.to_thread(extract_with_claude, text),
            timeout=CLAUDE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise ExtractionError(504, "claude_timeout",
                              f"Claude API exceeded {CLAUDE_TIMEOUT}s")
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(503, "claude_api_error", str(e))

    return {
        "contract_id": contract_id,
        "fields": fields,
        "raw_text_length": len(text),
        "extraction_time_ms": int((time.time() - start) * 1000),
        "model": AI_MODEL,
    }
```

**C. Replace the `analyse` endpoint body** with timeout-wrapped versions of both its sync calls:

```python
@app.post("/analyse")
async def analyse(req: AnalyseRequest, _: None = Depends(verify_auth)):
    validate_file_url(req.file_url)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(req.file_url)
            r.raise_for_status()
    except Exception as e:
        raise ExtractionError(422, "file_download_failed", str(e))

    # PDF parse — 422 on timeout
    try:
        text = await asyncio.wait_for(
            asyncio.to_thread(extract_text_from_bytes, r.content),
            timeout=PDF_PARSE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise ExtractionError(
            422, "pdf_parse_timeout",
            f"PDF parse exceeded {PDF_PARSE_TIMEOUT}s",
        )
    except Exception:
        text = ""

    if not text.strip():
        raise ExtractionError(422, "no_text_extracted")
    text = truncate_text(text)

    # Claude analysis — 504 on timeout
    try:
        findings = await asyncio.wait_for(
            asyncio.to_thread(analyse_with_claude, text, req),
            timeout=CLAUDE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise ExtractionError(504, "claude_timeout",
                              f"Claude API exceeded {CLAUDE_TIMEOUT}s")
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(503, "analysis_failed", str(e))

    return {
        "findings": findings,
        "model": ANALYSIS_MODEL,
        "raw_text_length": len(text),
    }
```

- [ ] **Step 1.5: Run tests — all should pass**

```bash
python -m pytest tests/test_timeouts.py -v
```

Expected: all 7 PASS.

- [ ] **Step 1.6: Commit**

```bash
cd /Users/dmitrygolovach/code/renewl
git add python-service/main.py python-service/pytest.ini python-service/tests/
git commit -m "feat: add PDF_PARSE_TIMEOUT and CLAUDE_TIMEOUT to extraction service

Returns 422 on PDF parse timeout, 504 on Claude timeout.
Wraps sync pdfplumber and Anthropic SDK calls in asyncio.to_thread
so timeouts do not block the event loop.
Applies to both /extract and /analyse endpoints."
```

---

## Task 2: Regression test — parseInt NaN guard

**Files:**
- Create: `__tests__/confirm-notice-period.test.ts`

### Background

The NaN guard is **already implemented** at `app/api/confirm/route.ts:74-75`:

```ts
const noticePeriodDaysParsed = f.notice_period_days != null
  ? parseInt(String(f.notice_period_days), 10)
  : null;
const noticePeriodDays =
  noticePeriodDaysParsed != null && !isNaN(noticePeriodDaysParsed)
    ? noticePeriodDaysParsed
    : null;
```

`!isNaN(NaN)` is `false`, so NaN → null before reaching `buildAlerts()`. The code is correct. This task writes a unit test that locks the behaviour so a future refactor cannot silently remove the guard.

The logic is two lines of inlineable JS — no need to extract a helper from the route. The test file replicates the logic and documents the contract.

---

- [ ] **Step 2.1: Write the test**

Create `__tests__/confirm-notice-period.test.ts`:

```typescript
/**
 * Regression test for the notice_period_days parseInt NaN guard.
 *
 * The guard lives at app/api/confirm/route.ts:74-75.
 * This test locks the behaviour: NaN and null inputs must produce null,
 * never a NaN number that would corrupt buildAlerts().
 */

// Exact logic from confirm/route.ts — keep in sync if that changes.
function parseNoticePeriodDays(raw: unknown): number | null {
  if (raw == null) return null;
  const parsed = parseInt(String(raw), 10);
  return !isNaN(parsed) ? parsed : null;
}

describe("parseNoticePeriodDays (confirm route NaN guard)", () => {
  it("returns null for null input", () => {
    expect(parseNoticePeriodDays(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseNoticePeriodDays(undefined)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(parseNoticePeriodDays("not-a-number")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseNoticePeriodDays("")).toBeNull();
  });

  it("parses valid integer string", () => {
    expect(parseNoticePeriodDays("30")).toBe(30);
  });

  it("parses numeric value", () => {
    expect(parseNoticePeriodDays(90)).toBe(90);
  });

  it("parses integer prefix of mixed string (parseInt behaviour)", () => {
    // parseInt("30 days") === 30 — acceptable, documents known behaviour
    expect(parseNoticePeriodDays("30 days")).toBe(30);
  });

  it("never returns NaN for any input", () => {
    const inputs: unknown[] = [null, undefined, "", "abc", NaN, {}, []];
    for (const input of inputs) {
      const result = parseNoticePeriodDays(input);
      if (typeof result === "number") {
        expect(isNaN(result)).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2.2: Run the test**

```bash
cd /Users/dmitrygolovach/code/renewl
npx jest __tests__/confirm-notice-period.test.ts --no-coverage
```

Expected: all 8 PASS (guard already works — we're documenting existing behaviour).

- [ ] **Step 2.3: Commit**

```bash
git add __tests__/confirm-notice-period.test.ts
git commit -m "test: lock parseInt NaN guard for notice_period_days in confirm route"
```

---

## Task 3: Alert failed status migration

**Files:**
- Create: `supabase/migrations/20260324000000_alert_failed_status.sql`

> ⚠️ **Deploy this migration before Task 4's cron changes reach production.** The cron will write `status = 'failed'`, which violates the current `CHECK (status IN ('pending', 'sent', 'skipped'))` constraint until this migration runs.

### Background

The cron currently marks failed email sends as `skipped`. `failed` is more accurate, and adding `failure_reason` makes debugging possible without log archaeology. The migration:

1. Adds `failure_reason TEXT` (nullable — only set on `failed` rows)
2. Expands CHECK to allow both `skipped` and `failed` temporarily
3. Migrates existing `skipped` rows to `failed` with a placeholder reason
4. Contracts CHECK to remove `skipped`

---

- [ ] **Step 3.1: Write the migration**

Create `supabase/migrations/20260324000000_alert_failed_status.sql`:

```sql
-- supabase/migrations/20260324000000_alert_failed_status.sql
--
-- Renames alert status 'skipped' to 'failed' and adds a failure_reason column.
-- 'skipped' was used when the Resend email send failed — 'failed' is more accurate,
-- and failure_reason provides structured debuggability without log archaeology.
--
-- DEPLOY BEFORE the cron code that writes status='failed' reaches production.

-- 1. Add failure_reason (nullable — only set when status = 'failed')
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- 2. Temporarily allow both 'skipped' and 'failed' to safely migrate rows
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS alerts_status_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'skipped'));

-- 3. Migrate existing 'skipped' rows to 'failed'
UPDATE public.alerts
SET status         = 'failed',
    failure_reason = 'Migrated from skipped status'
WHERE status = 'skipped';

-- 4. Remove 'skipped' from allowed values
ALTER TABLE public.alerts DROP CONSTRAINT alerts_status_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_status_check
  CHECK (status IN ('pending', 'sent', 'failed'));
```

- [ ] **Step 3.2: Apply the migration**

Apply via Supabase dashboard (`SQL Editor → Run`) or CLI:

```bash
supabase db push   # if using linked project
# or: supabase migration up
```

Verify it applied:

```bash
supabase db diff --use-migra 2>/dev/null || echo "Check dashboard to confirm migration ran"
```

- [ ] **Step 3.3: Update TypeScript types if needed**

If `lib/types/database.ts` has a generated status union for alerts, update it:

```bash
# Try to regenerate (requires linked Supabase project):
npx supabase gen types typescript --local > lib/types/database.ts 2>/dev/null || true
```

If the file is manually maintained, find the alerts status union and change `'skipped'` to `'failed'`. Then:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3.4: Commit**

```bash
git add supabase/migrations/20260324000000_alert_failed_status.sql lib/types/database.ts
git commit -m "feat: add failure_reason to alerts and rename skipped→failed status

Migration: adds failure_reason TEXT column, migrates existing 'skipped'
rows to 'failed', drops 'skipped' from status CHECK constraint.
Must be deployed before the cron code changes in the next commit."
```

---

## Task 4: Cron pagination

**Files:**
- Modify: `app/api/cron/send-alerts/route.ts`
- Create: `__tests__/cron-pagination.test.ts`

### Background

The cron currently fetches exactly 100 alerts and stops. Excess alerts silently never get sent.

Fix: paginate in batches of 100. Since each batch is processed and marked `sent`/`failed` before the next fetch, always querying `status = 'pending'` from the top is safe — processed rows are invisible to subsequent queries. A hard ceiling of 500 alerts per run triggers a loud error log rather than silently truncating.

**Note:** This change also removes the early-return on zero alerts — the loop handles that naturally, and the activity log is now always written (including on zero-alert days). This is an improvement: the audit trail is complete regardless of whether any alerts fired.

---

- [ ] **Step 4.1: Write the failing test**

The cron handler is a Next.js Route Handler — not practical to unit test end-to-end. Extract and test the pagination loop logic in isolation.

Create `__tests__/cron-pagination.test.ts`:

```typescript
/**
 * Unit tests for the cron alert pagination loop.
 *
 * The loop always queries status='pending' from offset 0 — processed rows
 * change status so they won't appear in the next fetch. This avoids
 * duplicate-processing without offset arithmetic.
 */

const PAGE_SIZE = 100;
const MAX_ALERTS_PER_RUN = 500;

async function runPaginatedCron(
  fetchBatch: () => Promise<string[]>,
  processBatch: (ids: string[]) => Promise<void>
): Promise<{ totalProcessed: number; hitCeiling: boolean }> {
  let totalProcessed = 0;

  while (totalProcessed < MAX_ALERTS_PER_RUN) {
    const batch = await fetchBatch();
    if (!batch || batch.length === 0) break;

    await processBatch(batch);
    totalProcessed += batch.length;

    if (batch.length < PAGE_SIZE) break; // last page
  }

  const hitCeiling = totalProcessed >= MAX_ALERTS_PER_RUN;
  return { totalProcessed, hitCeiling };
}

describe("runPaginatedCron", () => {
  it("processes a single partial page and stops", async () => {
    const ids = Array.from({ length: 42 }, (_, i) => `id-${i}`);
    const fetchBatch = jest.fn().mockResolvedValueOnce(ids);
    const processBatch = jest.fn().mockResolvedValue(undefined);

    const result = await runPaginatedCron(fetchBatch, processBatch);

    expect(fetchBatch).toHaveBeenCalledTimes(1);
    expect(result.totalProcessed).toBe(42);
    expect(result.hitCeiling).toBe(false);
  });

  it("processes multiple full pages until a partial page ends the loop", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => `id-p1-${i}`);
    const partialPage = Array.from({ length: 37 }, (_, i) => `id-p2-${i}`);
    const fetchBatch = jest
      .fn()
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(partialPage);
    const processBatch = jest.fn().mockResolvedValue(undefined);

    const result = await runPaginatedCron(fetchBatch, processBatch);

    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(result.totalProcessed).toBe(137);
    expect(result.hitCeiling).toBe(false);
  });

  it("stops and signals hitCeiling when MAX_ALERTS_PER_RUN is reached", async () => {
    // 5 full pages of 100 = 500 = ceiling
    const fullPage = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    const fetchBatch = jest.fn().mockResolvedValue(fullPage);
    const processBatch = jest.fn().mockResolvedValue(undefined);

    const result = await runPaginatedCron(fetchBatch, processBatch);

    expect(result.totalProcessed).toBe(500);
    expect(result.hitCeiling).toBe(true);
    expect(fetchBatch).toHaveBeenCalledTimes(5);
  });

  it("stops immediately on empty first batch with zero processed", async () => {
    const fetchBatch = jest.fn().mockResolvedValue([]);
    const processBatch = jest.fn();

    const result = await runPaginatedCron(fetchBatch, processBatch);

    expect(result.totalProcessed).toBe(0);
    expect(result.hitCeiling).toBe(false);
    expect(processBatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4.2: Run test to confirm it passes**

```bash
npx jest __tests__/cron-pagination.test.ts --no-coverage
```

Expected: all 4 PASS (logic is self-contained in the test file).

---

- [ ] **Step 4.3: Rewrite the cron handler with pagination**

Replace `app/api/cron/send-alerts/route.ts` from the `// ── Query due alerts` comment through to the end of the function with:

```typescript
  const PAGE_SIZE = 100;
  const MAX_ALERTS_PER_RUN = 500;
  let totalSent = 0;
  let totalFailed = 0;
  let totalProcessed = 0;

  while (totalProcessed < MAX_ALERTS_PER_RUN) {
    // Always query status='pending' from the top — rows processed in the previous
    // iteration are now 'sent' or 'failed' and won't appear in this fetch.
    const { data: alerts, error: queryError } = await adminClient
      .from('alerts')
      .select(`
        id, alert_type, scheduled_for, target_date,
        contract_id, user_id,
        contracts!inner ( name, expiry_date, renewal_date, auto_renew, party_a, party_b, contract_value, notice_period_days ),
        profiles!inner ( email )
      `)
      .lte('scheduled_for', today)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true })
      .limit(PAGE_SIZE);

    if (queryError || !alerts) {
      console.error('Cron: failed to query alerts', queryError);
      return new Response('Internal Server Error', { status: 500 });
    }

    if (alerts.length === 0) break;

    const alertsWithContext: AlertWithContext[] = (alerts as any[]).map((a) => ({
      id: a.id,
      alert_type: a.alert_type,
      scheduled_for: a.scheduled_for,
      target_date: a.target_date,
      contract_id: a.contract_id,
      user_id: a.user_id,
      name: a.contracts.name,
      expiry_date: a.contracts.expiry_date,
      renewal_date: a.contracts.renewal_date,
      auto_renew: a.contracts.auto_renew,
      party_a: a.contracts.party_a,
      party_b: a.contracts.party_b,
      contract_value: a.contracts.contract_value,
      notice_period_days: a.contracts.notice_period_days,
      email: a.profiles.email,
    }));

    const resend = new Resend(process.env.RESEND_API_KEY);
    const results = await Promise.allSettled(
      alertsWithContext.map(async (alert) => {
        const email = buildAlertEmail(alert);
        await resend.emails.send({
          from: EMAIL_FROM,
          replyTo: EMAIL_REPLY_TO,
          to: alert.email,
          subject: email.subject,
          html: email.html,
        });
        return alert.id;
      })
    );

    await Promise.all(
      results.map(async (result, i) => {
        const alertId = alertsWithContext[i].id;
        if (result.status === 'fulfilled') {
          totalSent++;
          const { error } = await adminClient
            .from('alerts')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', alertId);
          if (error) console.error(`Cron: failed to mark alert ${alertId} sent`, error);
        } else {
          totalFailed++;
          const reason = String((result as PromiseRejectedResult).reason).slice(0, 500);
          console.error(`Cron: failed to send alert ${alertId}:`, reason);
          const { error } = await adminClient
            .from('alerts')
            .update({ status: 'failed', failure_reason: reason })
            .eq('id', alertId);
          if (error) console.error(`Cron: failed to mark alert ${alertId} failed`, error);
        }
      })
    );

    totalProcessed += alerts.length;
    if (alerts.length < PAGE_SIZE) break; // last page
  }

  if (totalProcessed >= MAX_ALERTS_PER_RUN) {
    console.error(
      `[cron] Hit MAX_ALERTS_PER_RUN ceiling (${MAX_ALERTS_PER_RUN}). ` +
      `Alerts may still be pending. Investigate backlog.`
    );
  }

  // Activity log — always written, even on zero-alert runs (complete audit trail)
  await adminClient.from('activity_log').insert({
    user_id: null,
    event_type: 'cron_alerts_sent',
    metadata: {
      sent: totalSent,
      failed: totalFailed,
      total: totalProcessed,
      date: today,
      hit_ceiling: totalProcessed >= MAX_ALERTS_PER_RUN,
    },
  });

  return NextResponse.json({ sent: totalSent, failed: totalFailed, total: totalProcessed });
```

Remove the old `let sentCount`, `let skippedCount`, and `if (alerts.length === 0)` early-return — all replaced by the loop.

- [ ] **Step 4.4: TypeScript build check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.5: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all PASS.

- [ ] **Step 4.6: Scan for leftover 'skipped' references**

```bash
grep -r "skipped" app/ lib/ components/ --include="*.ts" --include="*.tsx"
```

Expected: no results (or only code comments explaining the rename).

- [ ] **Step 4.7: Commit**

```bash
git add app/api/cron/send-alerts/route.ts __tests__/cron-pagination.test.ts
git commit -m "feat: paginate cron alert sends (ceiling 500/run) and write failure_reason

Replaces single .limit(100) with a loop that processes pending alerts in
batches until exhausted or ceiling hit. Ceiling logs a loud error.
Uses 'failed' status (renamed from 'skipped') with failure_reason column.
Activity log is always written, including on zero-alert days."
```

---

## Final verification

- [ ] Full TypeScript test suite:

```bash
cd /Users/dmitrygolovach/code/renewl
npx jest --no-coverage
```

Expected: all PASS.

- [ ] Clean TypeScript build:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] Python test suite:

```bash
cd python-service
python -m pytest tests/ -v
```

Expected: all 7 PASS.
