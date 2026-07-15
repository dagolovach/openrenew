## Status

**Last verified:** 2026-03-24
**Build status:** Completed

All components are live: `contract_analysis` table exists with RLS, `ContractIntelligencePanel` is rendered on the contract detail page, `/api/analyse` (GET + POST) are live, `lib/analysis.ts` `triggerAnalysis()` is implemented, Python `/analyse` endpoint is live.

**Divergences from plan:**
- Plan said "Python service uses litellm" — [UPDATED] code uses Anthropic SDK directly (`import anthropic`)
- Plan said "fire-and-forget from confirm route" — [UPDATED] `/api/confirm` awaits `triggerAnalysis()` with `.catch()` (not truly fire-and-forget), to complete within the Vercel function's 60s limit
- Analysis model is `claude-haiku-4-5-20251001` (hardcoded in `python-service/main.py` as `ANALYSIS_MODEL`), not `claude-haiku-4-5`

---

# Contract Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI-powered "Contract Intelligence" panel to the contract detail page that automatically surfaces risk flags, unfavourable clauses, and actionable insights after a contract is confirmed.

**Architecture:** Claude Haiku is called from the Python microservice (consistent with existing extraction), which gains a new `/analyse` endpoint. A shared `lib/analysis.ts` helper (`triggerAnalysis`) is called fire-and-forget from the confirm route and on-demand from a new `POST /api/analyse` route. The contract detail page polls `GET /api/analyse?contract_id=` every 3 seconds and renders a collapsible `ContractIntelligencePanel` component.

**Tech Stack:** Python/FastAPI + litellm (analysis prompt, Haiku model), Next.js API routes (thin orchestration), Supabase Postgres (`contract_analysis` table), React (polling component with inline styles matching existing codebase)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/20260323000000_contract_analysis.sql` | Create | `contract_analysis` table, RLS, index |
| `lib/types/database.ts` | Modify | Add `contract_analysis` types; add missing `target_date` to `alerts` |
| `python-service/main.py` | Modify | Add `AnalyseRequest` model, `analyse_with_claude()`, `POST /analyse` endpoint |
| `python-service/tests/test_main.py` | Modify | Tests for `analyse_with_claude` and `/analyse` endpoint |
| `lib/analysis.ts` | Create | `triggerAnalysis()` helper — admin client, idempotency, Python call, DB write |
| `app/api/analyse/route.ts` | Create | `GET` (read existing) + `POST` (trigger + write) handlers |
| `app/api/confirm/route.ts` | Modify | Add `void triggerAnalysis(...)` before `return NextResponse.json({ ok: true })` |
| `components/contracts/ContractIntelligencePanel.tsx` | Create | Self-contained panel with polling, three visual states, copy-to-clipboard |
| `components/contracts/ContractDetailClient.tsx` | Modify | Import and render `ContractIntelligencePanel` below countdown section |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260323000000_contract_analysis.sql`

- [ ] **Step 1.1: Write the migration**

```sql
-- supabase/migrations/20260323000000_contract_analysis.sql

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

- [ ] **Step 1.2: Apply the migration**

```bash
cd /Users/dmitrygolovach/code/renewl
supabase db push
```

Expected: migration applies without error. If `supabase db push` is unavailable (remote-only project), apply via Supabase dashboard SQL editor instead.

- [ ] **Step 1.3: Verify table exists**

```bash
supabase db execute --sql "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'contract_analysis' ORDER BY ordinal_position;"
```

Expected: rows for `id`, `contract_id`, `user_id`, `findings`, `raw_text_used`, `model`, `analysis_version`, `created_at`, `updated_at`.

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/20260323000000_contract_analysis.sql
git commit -m "feat: add contract_analysis table migration"
```

---

## Task 2: Update TypeScript DB Types

**Files:**
- Modify: `lib/types/database.ts`

Two changes in one commit: (a) add `contract_analysis` table types, (b) add the pre-existing missing `target_date` field to `alerts` (housekeeping fix bundled here since the file is already being touched).

- [ ] **Step 2.1: Add `target_date` to the `alerts` table types**

In `lib/types/database.ts`, find the `alerts` section and add `target_date: string` to all three shapes:

```typescript
// alerts Row — add target_date
Row: {
  alert_type: string
  contract_id: string
  created_at: string
  id: string
  scheduled_for: string
  sent_at: string | null
  status: string
  target_date: string   // ← ADD THIS
  user_id: string
}
// alerts Insert — add target_date
Insert: {
  alert_type: string
  contract_id: string
  created_at?: string
  id?: string
  scheduled_for: string
  sent_at?: string | null
  status?: string
  target_date: string   // ← ADD THIS (required — NOT NULL in DB)
  user_id: string
}
// alerts Update — add target_date
Update: {
  alert_type?: string
  contract_id?: string
  created_at?: string
  id?: string
  scheduled_for?: string
  sent_at?: string | null
  status?: string
  target_date?: string  // ← ADD THIS
  user_id?: string
}
```

- [ ] **Step 2.2: Add `contract_analysis` table types**

Add this new table block inside `public: { Tables: { ... } }`, after the `contracts` block:

```typescript
contract_analysis: {
  Row: {
    id: string
    contract_id: string
    user_id: string
    findings: Json
    raw_text_used: string | null
    model: string
    analysis_version: number
    created_at: string
    updated_at: string
  }
  Insert: {
    id?: string
    contract_id: string
    user_id: string
    findings?: Json
    raw_text_used?: string | null
    model?: string
    analysis_version?: number
    created_at?: string
    updated_at?: string
  }
  Update: {
    id?: string
    contract_id?: string
    user_id?: string
    findings?: Json
    raw_text_used?: string | null
    model?: string
    analysis_version?: number
    created_at?: string
    updated_at?: string
  }
  Relationships: [
    {
      foreignKeyName: "contract_analysis_contract_id_fkey"
      columns: ["contract_id"]
      isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    },
    {
      foreignKeyName: "contract_analysis_user_id_fkey"
      columns: ["user_id"]
      isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },
  ]
}
```

- [ ] **Step 2.3: Verify the build still passes**

```bash
npm run build
```

Expected: no TypeScript errors related to `target_date` or `contract_analysis`.

- [ ] **Step 2.4: Commit**

```bash
git add lib/types/database.ts
git commit -m "fix: add contract_analysis types and missing alerts.target_date to DB types"
```

---

## Task 3: Python `/analyse` Endpoint (TDD)

**Files:**
- Modify: `python-service/tests/test_main.py` (tests first)
- Modify: `python-service/main.py` (implementation)

The pattern mirrors existing `extract_with_claude` and `/extract` tests. The `/analyse` endpoint uses `litellm.completion` directly (not tool use) because the output is a free-form JSON array, not a structured tool call.

- [ ] **Step 3.0: Fix `conftest.py` to provide auth header for all endpoint tests**

`main.py` line 17 captures `EXTRACTION_SERVICE_SECRET = os.getenv("EXTRACTION_SERVICE_SECRET")` at **module import time**. `monkeypatch.setenv` runs at test-execution time — after the module is already imported — so it cannot retroactively change the captured value. The correct approach is to patch the module-level binding directly with `monkeypatch.setattr`, which replaces the name in `main`'s namespace where `verify_auth` reads it.

Replace `python-service/tests/conftest.py` with:

```python
# python-service/tests/conftest.py
import pytest
from fastapi.testclient import TestClient

TEST_SECRET = "test-secret"


@pytest.fixture(autouse=True)
def patch_secret(monkeypatch):
    """Patch EXTRACTION_SERVICE_SECRET in main's namespace for every test.

    Cannot use monkeypatch.setenv because the value is captured at import time
    (main.py line 17). Patching the module-level name directly is the correct approach.
    """
    monkeypatch.setattr("main.EXTRACTION_SERVICE_SECRET", TEST_SECRET)


@pytest.fixture
def client():
    """TestClient with the auth header pre-set."""
    from main import app
    return TestClient(app, headers={"Authorization": f"Bearer {TEST_SECRET}"})
```

Run all existing tests to confirm they pass after this change:

```bash
cd python-service
pytest tests/test_main.py -v 2>&1 | tail -20
```

Expected: all tests pass. The `autouse` fixture patches the secret for every test, and the `client` fixture sends the correct header to auth-gated endpoints.

- [ ] **Step 3.1: Write tests for `analyse_with_claude`**

Append to `python-service/tests/test_main.py`:

```python
# ── analyse_with_claude ──────────────────────────────

def _make_analysis_mock(findings: list):
    """Build a mock litellm.completion response that returns findings as JSON."""
    import json
    from unittest.mock import MagicMock
    mock_message = MagicMock()
    mock_message.content = json.dumps(findings)
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]
    return mock_response


def _make_analyse_request(**kwargs):
    """Build a minimal AnalyseRequest for testing."""
    from main import AnalyseRequest
    defaults = {
        "file_url": "https://example.com/file.pdf",
        "contract_id": "test-123",
        "party_a": "Acme Corp",
        "party_b": "Buyer Ltd",
        "category": "saas",
        "auto_renew": True,
        "notice_period_days": 90,
        "contract_value": "$48,000",
        "expiry_date": "2025-12-31",
    }
    defaults.update(kwargs)
    return AnalyseRequest(**defaults)


def test_analyse_with_claude_returns_list():
    """analyse_with_claude returns a list of findings."""
    from unittest.mock import patch
    findings = [
        {
            "type": "warning",
            "category": "auto_renewal",
            "title": "Auto-renewal with no price cap",
            "explanation": "Vendor can raise price at renewal.",
            "action": "Ask for a price cap.",
            "severity": "medium",
        }
    ]
    req = _make_analyse_request()
    with patch("main.litellm.completion", return_value=_make_analysis_mock(findings)):
        from main import analyse_with_claude
        result = analyse_with_claude("Sample contract text", req)
    assert isinstance(result, list)
    assert len(result) == 1
    assert result[0]["type"] == "warning"


def test_analyse_with_claude_uses_haiku_model():
    """analyse_with_claude uses ANALYSIS_MODEL (claude-haiku-4-5)."""
    from unittest.mock import patch
    req = _make_analyse_request()
    with patch("main.litellm.completion", return_value=_make_analysis_mock([])) as mock_completion:
        from main import analyse_with_claude, ANALYSIS_MODEL
        analyse_with_claude("text", req)
        call_kwargs = mock_completion.call_args[1]
        assert call_kwargs["model"] == ANALYSIS_MODEL


def test_analyse_with_claude_raises_on_malformed_json():
    """analyse_with_claude raises ExtractionError when Claude returns non-JSON."""
    from unittest.mock import patch, MagicMock
    from main import ExtractionError

    mock_message = MagicMock()
    mock_message.content = "This is not JSON at all"
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    req = _make_analyse_request()
    with patch("main.litellm.completion", return_value=mock_response):
        from main import analyse_with_claude
        with pytest.raises(ExtractionError) as exc_info:
            analyse_with_claude("text", req)
    assert exc_info.value.status_code == 503
    assert exc_info.value.error == "analysis_failed"


def test_analyse_with_claude_raises_on_non_list_json():
    """analyse_with_claude raises ExtractionError when Claude returns a JSON object, not an array."""
    from unittest.mock import patch, MagicMock
    import json
    from main import ExtractionError

    mock_message = MagicMock()
    mock_message.content = json.dumps({"type": "warning"})  # object, not array
    mock_choice = MagicMock()
    mock_choice.message = mock_message
    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    req = _make_analyse_request()
    with patch("main.litellm.completion", return_value=mock_response):
        from main import analyse_with_claude
        with pytest.raises(ExtractionError) as exc_info:
            analyse_with_claude("text", req)
    assert exc_info.value.error == "analysis_failed"


def test_analyse_with_claude_accepts_empty_findings():
    """analyse_with_claude returns [] when Claude finds nothing — valid result."""
    from unittest.mock import patch
    req = _make_analyse_request()
    with patch("main.litellm.completion", return_value=_make_analysis_mock([])):
        from main import analyse_with_claude
        result = analyse_with_claude("text", req)
    assert result == []


# ── /analyse endpoint ────────────────────────────────

def test_analyse_endpoint_happy_path(client):
    """POST /analyse returns findings when PDF download and analysis both succeed."""
    from unittest.mock import patch, AsyncMock, MagicMock
    import httpx

    findings = [{"type": "positive", "category": "liability", "title": "Liability capped",
                 "explanation": "Standard cap.", "action": None, "severity": None}]

    mock_response = MagicMock()
    mock_response.content = MINIMAL_PDF
    mock_response.raise_for_status = lambda: None

    with patch("main.analyse_with_claude", return_value=findings):
        with patch("main.httpx.AsyncClient") as mock_client_cls:
            mock_client = mock_client_cls.return_value.__aenter__.return_value
            mock_client.get = AsyncMock(return_value=mock_response)

            r = client.post("/analyse", json={
                "file_url": "https://storage.example.com/contract.pdf",
                "contract_id": "test-123",
            })

    assert r.status_code == 200
    data = r.json()
    assert "findings" in data
    assert isinstance(data["findings"], list)
    assert len(data["findings"]) == 1
    assert "raw_text_length" in data


def test_analyse_endpoint_download_failure(client):
    """POST /analyse returns 422 when PDF download fails."""
    from unittest.mock import patch
    import httpx

    with patch("main.httpx.AsyncClient") as mock_client_cls:
        mock_client = mock_client_cls.return_value.__aenter__.return_value
        mock_client.get.side_effect = httpx.ConnectError("connection refused")

        r = client.post("/analyse", json={
            "file_url": "https://storage.example.com/bad.pdf",
        })

    assert r.status_code == 422
    assert r.json()["error"] == "file_download_failed"


def test_analyse_endpoint_empty_pdf_returns_422(client):
    """POST /analyse returns 422 when PDF has no extractable text."""
    from unittest.mock import patch, AsyncMock, MagicMock

    empty_pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000068 00000 n \n0000000125 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n"

    mock_response = MagicMock()
    mock_response.content = empty_pdf
    mock_response.raise_for_status = lambda: None

    with patch("main.httpx.AsyncClient") as mock_client_cls:
        mock_client = mock_client_cls.return_value.__aenter__.return_value
        mock_client.get = AsyncMock(return_value=mock_response)

        r = client.post("/analyse", json={"file_url": "https://storage.example.com/scan.pdf"})

    assert r.status_code == 422
    assert r.json()["error"] == "no_text_extracted"


def test_analyse_endpoint_requires_auth(client):
    """POST /analyse returns 401 without auth header."""
    from fastapi.testclient import TestClient
    from main import app

    # Client without auth header
    unauthed = TestClient(app, headers={})
    r = unauthed.post("/analyse", json={"file_url": "https://storage.example.com/file.pdf"})
    assert r.status_code == 401
```

- [ ] **Step 3.2: Run tests to confirm they fail (TDD red phase)**

```bash
cd python-service
pytest tests/test_main.py -k "analyse" -v 2>&1 | tail -30
```

Expected: errors like `ImportError: cannot import name 'AnalyseRequest'` or `FAILED` — that's correct. Proceed.

- [ ] **Step 3.3: Implement the `/analyse` endpoint in `python-service/main.py`**

Add directly after the `EXTRACTION_TOOL` constant and `extract_with_claude` function (before the FastAPI app definition section):

```python
# ── Analysis (risk finding) ──────────────────────────

ANALYSIS_MODEL = "claude-haiku-4-5"

ANALYSIS_SYSTEM_PROMPT = """You are a contract analysis assistant helping ops and finance teams understand the business implications of their vendor contracts.

Your job is to identify clauses that could create financial risk, operational inflexibility, or unexpected obligations.

You are NOT providing legal advice. You are surfacing business-level observations that a non-lawyer ops or finance person would find useful.

Rules:
- Focus on clauses that affect money, timing, and exit flexibility
- Be specific — quote or paraphrase the relevant clause
- Keep explanations under 2 sentences
- Keep action items practical and concrete
- Do not hallucinate clauses that are not present
- If a clause is standard and acceptable, note it as a positive finding
- Maximum 8 findings total — prioritise the most impactful
- Output ONLY valid JSON array, no markdown wrapper"""


class AnalyseRequest(BaseModel):
    file_url: str
    contract_id: Optional[str] = None
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    category: Optional[str] = None
    auto_renew: Optional[bool] = None
    notice_period_days: Optional[int] = None
    contract_value: Optional[str] = None
    expiry_date: Optional[str] = None


def analyse_with_claude(text: str, req: AnalyseRequest) -> list:
    user_message = f"""Analyse this contract for business risk and return a JSON array of findings.

Contract details already extracted:
- Party A (vendor): {req.party_a or 'Unknown'}
- Party B (customer): {req.party_b or 'Unknown'}
- Category: {req.category or 'Unknown'}
- Auto-renews: {req.auto_renew}
- Notice period: {req.notice_period_days} days
- Contract value: {req.contract_value or 'Not stated'}
- Expiry: {req.expiry_date or 'Unknown'}

Full contract text:
\"\"\"
{text}
\"\"\"

Return a JSON array where each item has:
- type: "warning" | "positive" | "info"
- category: one of [auto_renewal, notice_period, liability, payment_terms, termination, ip_ownership, data_privacy, price_escalation, exclusivity, governing_law, other]
- title: short label (max 8 words)
- explanation: what this means in plain English (max 2 sentences)
- action: what to do about it (max 1 sentence, null for positives)
- severity: "high" | "medium" | "low" | null (null for non-warnings)

Output ONLY the JSON array. No other text."""

    response = litellm.completion(
        model=ANALYSIS_MODEL,
        max_tokens=2048,
        system=ANALYSIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    try:
        content = response.choices[0].message.content
        findings = json.loads(content)
        if not isinstance(findings, list):
            raise ValueError("Expected a JSON array")
        return findings
    except (AttributeError, IndexError, TypeError, json.JSONDecodeError, ValueError) as e:
        raise ExtractionError(
            status_code=503,
            error="analysis_failed",
            detail=f"Claude did not return a valid JSON array: {e}",
        )
```

Then add the endpoint at the bottom of `main.py` (after the existing `/extract-file` endpoint):

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

    try:
        text = extract_text_from_bytes(r.content)
    except Exception:
        text = ""
    if not text.strip():
        raise ExtractionError(422, "no_text_extracted")

    text = truncate_text(text)
    findings = analyse_with_claude(text, req)

    return {
        "findings": findings,
        "model": ANALYSIS_MODEL,
        "raw_text_length": len(text),
    }
```

- [ ] **Step 3.4: Run all Python tests and verify they pass**

```bash
cd python-service
pytest tests/test_main.py -v 2>&1 | tail -40
```

Expected: all tests pass. The `test_analyse_endpoint_requires_auth` test requires the `conftest.py` client to send the auth header — check that the existing `conftest.py` client fixture includes the auth header. If not, the test may need adjustment to use a client with `headers={"Authorization": f"Bearer {os.getenv('EXTRACTION_SERVICE_SECRET', 'test-secret')}"}`.

> **conftest.py check:** Look at `python-service/tests/conftest.py`. The existing `client` fixture is `TestClient(app)` with no headers. The `verify_auth` dependency checks the `Authorization` header, so tests hitting auth-gated endpoints need the header. Update the fixture or use `pytest.mark.parametrize` to pass headers inline.

If the existing tests are already passing (they use `/extract-file` which is auth-gated), the client likely has headers set via env or the `EXTRACTION_SERVICE_SECRET` is `None` (which triggers the 500 path). Verify and adjust as needed to make the auth test pass cleanly.

- [ ] **Step 3.5: Commit**

```bash
git add python-service/main.py python-service/tests/test_main.py python-service/tests/conftest.py
git commit -m "feat: add /analyse endpoint to Python service"
```

---

## Task 4: `lib/analysis.ts` — Shared `triggerAnalysis` Helper

**Files:**
- Create: `lib/analysis.ts`

- [ ] **Step 4.1: Create `lib/analysis.ts`**

```typescript
// lib/analysis.ts
import { createClient } from "@supabase/supabase-js";

export type Finding = {
  type: "warning" | "positive" | "info";
  category: string;
  title: string;
  explanation: string;
  action: string | null;
  severity: "high" | "medium" | "low" | null;
};

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
const IDEMPOTENCY_WINDOW_MS = 60_000; // 60 seconds

export async function triggerAnalysis(
  contractId: string,
  userId: string
): Promise<{ findings: Finding[] }> {
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Idempotency: if a row was written within the last 60 seconds, return it
  //    This guards against double-confirm clicks firing two concurrent analyses.
  const { data: existing } = await adminClient
    .from("contract_analysis")
    .select("id, findings, created_at, analysis_version")
    .eq("contract_id", contractId)
    .order("analysis_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (ageMs < IDEMPOTENCY_WINDOW_MS) {
      return { findings: existing.findings as Finding[] };
    }
  }

  const nextVersion = existing ? (existing.analysis_version as number) + 1 : 1;

  // 2. Fetch contract fields (admin client bypasses RLS — contractId already verified upstream)
  const { data: contract, error: contractError } = await adminClient
    .from("contracts")
    .select(
      "file_path, party_a, party_b, category, auto_renew, notice_period_days, contract_value, expiry_date"
    )
    .eq("id", contractId)
    .single();

  if (contractError || !contract || !contract.file_path) {
    throw new Error("Contract not found or has no attached file");
  }

  // 3. Generate signed URL — storage requires service role key (session client cannot do this)
  const { data: signedData, error: signError } = await adminClient.storage
    .from("contracts")
    .createSignedUrl(contract.file_path, 120); // 120s validity — enough for the Python call

  if (signError || !signedData) {
    throw new Error("Could not generate signed URL for contract file");
  }

  // 4. Call Python /analyse
  let findings: Finding[];
  let modelUsed = "claude-haiku-4-5";
  try {
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/analyse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.EXTRACTION_SERVICE_SECRET}`,
      },
      body: JSON.stringify({
        file_url: signedData.signedUrl,
        contract_id: contractId,
        party_a: contract.party_a,
        party_b: contract.party_b,
        category: contract.category,
        auto_renew: contract.auto_renew,
        notice_period_days: contract.notice_period_days,
        contract_value: contract.contract_value,
        expiry_date: contract.expiry_date,
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!pyRes.ok) {
      const err = await pyRes.json().catch(() => ({}));
      throw new Error(`Python /analyse returned ${pyRes.status}: ${err.error ?? "unknown"}`);
    }

    const body = await pyRes.json();
    findings = Array.isArray(body.findings) ? body.findings : [];
    modelUsed = typeof body.model === "string" ? body.model : "claude-haiku-4-5";
  } catch (err) {
    // Log and re-throw — callers decide whether to surface or swallow
    console.error("[triggerAnalysis] Python call failed:", err);
    throw err;
  }

  // 5. Persist to contract_analysis
  //    UNIQUE(contract_id, analysis_version) constraint: concurrent triggers that race past
  //    the idempotency window will hit a unique violation (code "23505") on the second insert —
  //    that's acceptable. Any other error is a real problem and should surface.
  const { error: insertError } = await adminClient.from("contract_analysis").insert({
    contract_id: contractId,
    user_id: userId,
    findings,
    model: modelUsed,
    analysis_version: nextVersion,
  });
  if (insertError && insertError.code !== "23505") {
    throw new Error(`Failed to persist analysis: ${insertError.message}`);
  }

  // 6. Activity log
  await adminClient.from("activity_log").insert({
    user_id: userId,
    contract_id: contractId,
    event_type: "contract_analysed",
    metadata: { analysis_version: nextVersion, finding_count: findings.length },
  });

  return { findings };
}
```

- [ ] **Step 4.2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors referencing `lib/analysis.ts`.

- [ ] **Step 4.3: Commit**

```bash
git add lib/analysis.ts
git commit -m "feat: add triggerAnalysis helper (lib/analysis.ts)"
```

---

## Task 5: `app/api/analyse/route.ts` — GET + POST Handlers

**Files:**
- Create: `app/api/analyse/route.ts`

- [ ] **Step 5.1: Create the route file**

```typescript
// app/api/analyse/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerAnalysis } from "@/lib/analysis";
import { z } from "zod";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// GET /api/analyse?contract_id=<uuid>
// Returns existing analysis without triggering a new one. Used by client polling loop.
export async function GET(request: Request) {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    // findings: null signals "keep polling" — reused here for simplicity
    return NextResponse.json({ findings: null }, { status: 401 });
  }

  const url = new URL(request.url);
  const contractId = url.searchParams.get("contract_id");
  if (!contractId) {
    return NextResponse.json({ findings: null }, { status: 400 });
  }

  // RLS on contract_analysis enforces that user can only see their own rows
  const { data } = await sessionClient
    .from("contract_analysis")
    .select("findings, analysis_version, created_at")
    .eq("contract_id", contractId)
    .order("analysis_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    // Analysis not yet run — client should keep polling
    return NextResponse.json({ findings: null });
  }

  return NextResponse.json({
    findings: data.findings,
    analysis_version: data.analysis_version,
    created_at: data.created_at,
  });
}

// POST /api/analyse
// Triggers a new analysis and persists it. Thin route — all logic in triggerAnalysis().
const analyseSchema = z.object({
  contract_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = analyseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { contract_id } = parsed.data;

  // Verify contract ownership via session client (RLS enforces this)
  const { data: contract } = await sessionClient
    .from("contracts")
    .select("id")
    .eq("id", contract_id)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  try {
    const { findings } = await triggerAnalysis(contract_id, user.id);
    return NextResponse.json({ findings });
  } catch (err) {
    console.error("[POST /api/analyse] Analysis failed:", err);
    return NextResponse.json({ findings: [], error: "analysis_failed" });
  }
}
```

- [ ] **Step 5.2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add app/api/analyse/route.ts
git commit -m "feat: add GET/POST /api/analyse route"
```

---

## Task 6: Wire Analysis Trigger into Confirm Route

**Files:**
- Modify: `app/api/confirm/route.ts`

- [ ] **Step 6.1: Add the import and fire-and-forget trigger**

At the top of `app/api/confirm/route.ts`, add the import:

```typescript
import { triggerAnalysis } from "@/lib/analysis";
```

Find the last line before `return NextResponse.json({ ok: true })` (currently the `activity_log` insert, line ~129). Place the trigger immediately before the return:

```typescript
  // Fire-and-forget analysis — must be before the return statement
  // void prevents unhandled promise warning; .catch prevents uncaught rejection
  void triggerAnalysis(contract_id, userId).catch((err) =>
    console.error("[confirm] Analysis trigger failed:", err)
  );

  return NextResponse.json({ ok: true });
```

The full closing of the `POST` function should look like:

```typescript
  await sessionClient.from("activity_log").insert({
    user_id: userId,
    contract_id,
    event_type: "contract_confirmed",
    metadata: { contract_id, alert_count: alertCount },
  });

  // Fire-and-forget analysis — must be before the return statement
  void triggerAnalysis(contract_id, userId).catch((err) =>
    console.error("[confirm] Analysis trigger failed:", err)
  );

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6.2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: clean build. If TypeScript complains about `void` on a promise, the pattern is correct — `void` is intentional to signal fire-and-forget.

- [ ] **Step 6.3: Commit**

```bash
git add app/api/confirm/route.ts
git commit -m "feat: trigger contract analysis fire-and-forget after confirmation"
```

---

## Task 7: `ContractIntelligencePanel` Component

**Files:**
- Create: `components/contracts/ContractIntelligencePanel.tsx`

- [ ] **Step 7.1: Create the component**

```tsx
// components/contracts/ContractIntelligencePanel.tsx
"use client";

import { useEffect, useRef, useState } from "react";

export type Finding = {
  type: "warning" | "positive" | "info";
  category: string;
  title: string;
  explanation: string;
  action: string | null;
  severity: "high" | "medium" | "low" | null;
};

// Sort: warnings (high → medium → low), then positives, then info
const TYPE_RANK = { warning: 0, positive: 1, info: 2 } as const;
const SEV_RANK = { high: 0, medium: 1, low: 2 } as const;

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const ta = TYPE_RANK[a.type] ?? 3;
    const tb = TYPE_RANK[b.type] ?? 3;
    if (ta !== tb) return ta - tb;
    const sa = a.severity ? (SEV_RANK[a.severity] ?? 3) : 3;
    const sb = b.severity ? (SEV_RANK[b.severity] ?? 3) : 3;
    return sa - sb;
  });
}

const ICON_MAP = {
  warning: { icon: "⚠", color: "#F59E0B" },
  positive: { icon: "✓", color: "#10B981" },
  info: { icon: "ℹ", color: "#6B7280" },
} as const;

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <span
      onClick={handleCopy}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontSize: "12px",
        color: "#10B981",
        letterSpacing: "0.02em",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        position: "relative",
        fontFamily: "var(--font-jetbrains), monospace",
      }}
    >
      {"→ "}
      {text}
      <span
        style={{
          fontSize: "11px",
          color: "#4B5563",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "3px",
          padding: "1px 5px",
          letterSpacing: "0.04em",
          opacity: hovered ? 1 : 0,
          transition: "opacity 150ms ease",
        }}
      >
        copy
      </span>
      {copied && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: "-24px",
            background: "#10B981",
            color: "#0A0F1E",
            fontSize: "10px",
            padding: "2px 8px",
            borderRadius: "3px",
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          Copied
        </span>
      )}
    </span>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const { icon, color } = ICON_MAP[finding.type];
  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        padding: "14px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ color, fontSize: "14px", flexShrink: 0, marginTop: "1px", fontFamily: "var(--font-jetbrains), monospace" }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "14px",
            fontWeight: 700,
            color: "#F9FAFB",
            marginBottom: "4px",
            letterSpacing: "0.02em",
          }}
        >
          {finding.title}
        </div>
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#6B7280",
            lineHeight: 1.5,
            marginBottom: finding.action ? "6px" : 0,
          }}
        >
          {finding.explanation}
        </div>
        {finding.action && <CopyAction text={finding.action} />}
      </div>
    </div>
  );
}

function Disclaimer() {
  return (
    <div
      style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "11px",
        color: "#4B5563",
        fontStyle: "italic",
        padding: "14px 20px 16px",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        letterSpacing: "0.02em",
      }}
    >
      Powered by Claude · For informational purposes only · Not legal advice
    </div>
  );
}

function PanelShell({
  children,
  header,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    >
      {header}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "0 20px" }} />
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: "11px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#10B981",
};

const toggleStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: "11px",
  color: "#4B5563",
  letterSpacing: "0.08em",
  cursor: "pointer",
};

const headerBaseStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
};

export default function ContractIntelligencePanel({ contractId }: { contractId: string }) {
  const [status, setStatus] = useState<"loading" | "found" | "empty" | "error">("loading");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let done = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/analyse?contract_id=${contractId}`);
        if (res.status === 401) {
          // Session expired — stop polling, don't spin for 60 seconds
          done = true;
          if (intervalId) clearInterval(intervalId);
          if (timeoutId) clearTimeout(timeoutId);
          setStatus("error");
          return;
        }
        if (!res.ok) return; // other transient error — keep polling
        const data = await res.json();
        if (data.findings !== null) {
          done = true;
          if (intervalId) clearInterval(intervalId);
          if (timeoutId) clearTimeout(timeoutId);
          const sorted = sortFindings(data.findings as Finding[]);
          setFindings(sorted);
          const hasWarnings = sorted.some((f) => f.type === "warning");
          setIsOpen(hasWarnings);
          setStatus(sorted.length > 0 ? "found" : "empty");
        }
      } catch {
        // Network error — stop polling
        done = true;
        if (intervalId) clearInterval(intervalId);
        if (timeoutId) clearTimeout(timeoutId);
        setStatus("error");
      }
    }

    poll();
    intervalId = setInterval(() => { if (!done) poll(); }, 3000);
    timeoutId = setTimeout(() => {
      if (!done) {
        done = true;
        if (intervalId) clearInterval(intervalId);
        setStatus("error");
      }
    }, 60_000);

    // Cleanup: clear timers when component unmounts or contractId changes
    return () => {
      done = true;
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [contractId]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <PanelShell
        header={
          <div style={headerBaseStyle}>
            <span style={labelStyle}>Contract Intelligence</span>
          </div>
        }
      >
        <div
          style={{
            padding: "20px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#4B5563",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#10B981",
              flexShrink: 0,
              animation: "pulse 1.4s ease-in-out infinite",
            }}
          />
          Analysing contract...
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
        <Disclaimer />
      </PanelShell>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <PanelShell
        header={
          <div style={headerBaseStyle}>
            <span style={labelStyle}>Contract Intelligence</span>
          </div>
        }
      >
        <div
          style={{
            padding: "20px",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#4B5563",
          }}
        >
          Analysis unavailable. Try refreshing the page.
        </div>
        <Disclaimer />
      </PanelShell>
    );
  }

  // ── Empty state (no findings) ─────────────────────────────────────────────
  if (status === "empty") {
    return (
      <PanelShell
        header={
          <div style={headerBaseStyle}>
            <span style={labelStyle}>Contract Intelligence</span>
          </div>
        }
      >
        <div
          style={{
            padding: "20px",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#4B5563",
          }}
        >
          No significant risk flags detected. Standard terms throughout.
        </div>
        <Disclaimer />
      </PanelShell>
    );
  }

  // ── Findings state ────────────────────────────────────────────────────────
  const hasWarnings = findings.some((f) => f.type === "warning");

  return (
    <PanelShell
      header={
        <div
          style={{ ...headerBaseStyle, cursor: "pointer" }}
          onClick={() => setIsOpen((o) => !o)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={labelStyle}>Contract Intelligence</span>
            {!hasWarnings && (
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "11px",
                  color: "#4B5563",
                  letterSpacing: "0.06em",
                }}
              >
                No critical flags
              </span>
            )}
          </div>
          <span style={toggleStyle}>{isOpen ? "▾ HIDE" : "▸ SHOW"}</span>
        </div>
      }
    >
      {isOpen && (
        <div style={{ padding: "0 20px 4px" }}>
          {findings.map((finding, i) => (
            <FindingRow
              key={`${finding.category}-${i}`}
              finding={finding}
            />
          ))}
        </div>
      )}
      <Disclaimer />
    </PanelShell>
  );
}
```

- [ ] **Step 7.2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: clean build.

- [ ] **Step 7.3: Commit**

```bash
git add components/contracts/ContractIntelligencePanel.tsx
git commit -m "feat: add ContractIntelligencePanel component"
```

---

## Task 8: Wire Panel into Contract Detail Page

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`

- [ ] **Step 8.1: Add the import**

At the top of `ContractDetailClient.tsx`, add:

```typescript
import ContractIntelligencePanel from "./ContractIntelligencePanel";
```

- [ ] **Step 8.2: Render the panel below the countdown section**

In `ContractDetailClient.tsx`, find the existing comment `{/* ── Section 6: Footer status bar */}` (the exact text is `{/* ── Section 6: Footer status bar ──────────────────────────────────── */}`) and the `<Divider />` immediately above it. Replace that block:

```tsx
        <Divider />

        {/* ── Section 6: Footer status bar ──────────────────────────────────── */}
        <AlertStatusRow autoRenew={contract.auto_renew} alerts={alerts} />
```

with:

```tsx
        <Divider />

        {/* ── Section 6: Contract Intelligence panel ────────────────────────── */}
        <ContractIntelligencePanel contractId={contract.id} />

        <Divider />

        {/* ── Section 7: Footer status bar ──────────────────────────────────── */}
        <AlertStatusRow autoRenew={contract.auto_renew} alerts={alerts} />
```

Use the comment text as the search anchor — it is unique in the file and will match precisely.

- [ ] **Step 8.3: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: clean build.

- [ ] **Step 8.4: Commit**

```bash
git add components/contracts/ContractDetailClient.tsx
git commit -m "feat: render ContractIntelligencePanel on contract detail page"
```

---

## Task 9: End-to-End Smoke Test

Manual verification checklist — run the dev server and confirm each item works:

```bash
npm run dev
```

- [ ] **9.1** Navigate to a confirmed contract's detail page — intelligence panel shows "Analysing contract..." with pulsing green dot
- [ ] **9.2** Wait up to 60 seconds — findings appear; countdown timer continues ticking normally (unaffected)
- [ ] **9.3** If warnings present: panel is open by default (amber `⚠` icons visible)
- [ ] **9.4** If no warnings: panel is collapsed with "No critical flags" in header; click `▸ SHOW` expands it
- [ ] **9.5** Hover an action item (`→` line) — `copy` badge appears; click it — toast says "Copied"; paste confirms the text
- [ ] **9.6** Re-confirm a contract (use "Edit contract" link, change a field, confirm) — panel returns to "Analysing..." then shows fresh findings
- [ ] **9.7** Confirm a contract, immediately navigate away then back — no JS errors in console (timer cleanup working)
- [ ] **9.8** Disclaimer "Powered by Claude · For informational purposes only · Not legal advice" visible at bottom in all states

- [ ] **Step 9.9: Final build check**

```bash
npm run build
```

Expected: exit code 0, no errors.

- [ ] **Step 9.10: Final commit**

```bash
git add -A
git commit -m "feat: contract intelligence — end-to-end complete"
```

---

## Environment Variables Required

These must be set in `.env.local` (dev) and Vercel (prod) — they should already exist from the extraction feature:

| Variable | Used by |
|---|---|
| `PYTHON_SERVICE_URL` | `lib/analysis.ts` — URL of Railway Python service |
| `EXTRACTION_SERVICE_SECRET` | `lib/analysis.ts` — shared secret for Python service auth |
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/analysis.ts` — admin client |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/analysis.ts` — admin client (storage signed URLs) |

No new environment variables are required.
