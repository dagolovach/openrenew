## Status

**Last verified:** 2026-03-24
**Build status:** Completed

Python microservice is live on Railway. `/api/extract` route is live. Full extraction pipeline works end-to-end.

**Divergences from plan:**
- Python service uses `anthropic` SDK directly — [UPDATED] litellm was removed after initial plan
- Extraction model is `claude-sonnet-4-6` (not `claude-haiku-4-5` as some early docs suggested)
- `counterparty_name` field was replaced by `party_a` + `party_b` (migration `20260321200000_party_a_party_b.sql`)
- A `/extract-file` endpoint was added for local dev (disabled in Railway production via env check)
- SSRF protection added: private IP rejection + domain allowlist (`SUPABASE_STORAGE_DOMAIN`)

---

# PDF Extraction Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stateless Python FastAPI microservice that extracts contract fields from PDFs using pdfplumber + Claude API tool use, plus a Next.js route that orchestrates the flow and owns all Supabase writes.

**Architecture:** Python service (local FastAPI) receives a signed URL or file upload, extracts text with pdfplumber (first 30k + last 10k chars), calls Claude API via tool use, returns structured JSON. Next.js route generates the signed URL, calls the Python service, branches on result, and writes to Supabase. Python service is stateless — no database credentials.

**Tech Stack:** Python 3.12, FastAPI, pdfplumber, anthropic SDK, httpx, pytest; Next.js 16 App Router, Supabase, TypeScript

---

## Pre-flight: Unique Constraint Migration

**CRITICAL:** The `contract_extractions` table in `supabase/migrations/20260321000000_initial_schema.sql` has **no unique constraint** on `(contract_id, field_name)`. Without it, the upsert in Task 7 (step 7) will fail — Supabase requires a unique constraint to exist for `upsert(..., { onConflict: "contract_id,field_name" })` to work correctly.

**Required action before Task 7:** Create a new migration to add the constraint:

```sql
-- supabase/migrations/20260321000001_contract_extractions_unique.sql
ALTER TABLE public.contract_extractions
  ADD CONSTRAINT contract_extractions_contract_id_field_name_key
  UNIQUE (contract_id, field_name);
```

This migration must be run before the extract route is tested. It can be applied at the start of Task 7 or as a separate pre-task step.

---

### Task 1: Python service scaffold

**Goal:** Create `python-service/` directory with all dependency and configuration files, and a `main.py` skeleton with section comments only. Verify imports work.

- [ ] Create the directory `python-service/` at the repo root (`/Users/dmitrygolovach/code/renewl/python-service/`)
- [ ] Create `python-service/requirements.txt` with exact content:
  ```
  fastapi==0.115.0
  uvicorn[standard]==0.32.0
  pdfplumber==0.11.4
  anthropic==0.40.0
  httpx==0.27.2
  python-dotenv==1.0.1
  ```
- [ ] Create `python-service/requirements-dev.txt` with exact content:
  ```
  pytest==8.3.3
  pytest-asyncio==0.24.0
  httpx==0.27.2
  respx==0.21.1
  ```
- [ ] Create `python-service/.env.example` with exact content:
  ```
  ANTHROPIC_API_KEY=your-key-here
  ```
- [ ] Create `python-service/.env` (gitignored) — copy from `.env.example` and fill in your real `ANTHROPIC_API_KEY`
- [ ] Create `python-service/main.py` with exact content:
  ```python
  """Renewl PDF Extraction Service"""
  import os, io, time
  from typing import Optional
  import pdfplumber
  import anthropic
  import httpx
  from fastapi import FastAPI, UploadFile, File, Request
  from fastapi.responses import JSONResponse
  from pydantic import BaseModel
  from dotenv import load_dotenv

  load_dotenv()

  # ── Response models ───────────────────────────────────

  # ── Custom exceptions ────────────────────────────────

  # ── PDF extraction (pdfplumber) ──────────────────────

  # ── Claude API call ──────────────────────────────────

  # ── FastAPI app ──────────────────────────────────────
  app = FastAPI(title="Renewl PDF Extraction Service")
  ```
- [ ] Create `python-service/tests/` directory
- [ ] Create `python-service/tests/__init__.py` (empty file)
- [ ] From within `python-service/`, run:
  ```bash
  pip install -r requirements.txt -r requirements-dev.txt
  ```
  Expected: all packages install without error.
- [ ] Verify imports work:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -c "import fastapi, pdfplumber, anthropic; print('OK')"
  ```
  Expected output: `OK`
- [ ] Add `python-service/.env` to root `.gitignore` (or ensure `python-service/.gitignore` lists `.env`)
- [ ] Commit with message: `feat: python-service scaffold with requirements and main.py skeleton`

---

### Task 2: PDF text extraction (pdfplumber + truncation)

**Goal:** TDD — write tests first, then implement `extract_text_from_bytes` and `truncate_text` in `main.py`.

**Write tests first:**

- [ ] Create `python-service/tests/test_main.py` with the following content (tests only for Task 2 — more will be added in subsequent tasks):
  ```python
  """Tests for Renewl PDF Extraction Service"""
  import io
  import sys
  import os
  import base64
  import pytest

  # Add parent dir to path so we can import main
  sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
  from main import extract_text_from_bytes, truncate_text

  # ── Minimal valid PDF fixture ──────────────────────────────────────────────
  # A minimal one-page PDF with the text "Hello Contract World" encoded as base64.
  # Generated with: python -c "import base64; ..."
  # This avoids a binary file in the repo while keeping tests self-contained.
  MINIMAL_PDF_B64 = (
      "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2Jq"
      "CjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPJ4KZW5kb2Jq"
      "CjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIg"
      "NzkyXQovQ29udGVudHMgNCAwIFIKL1Jlc291cmNlcyA8PAovRm9udCA8PAovRjEgNSAwIFIKPj4K"
      "Pj4KPj4KZW5kb2JqCjQgMCBvYmoKPDwKL0xlbmd0aCA0NAo+PgpzdHJlYW0KQlQKL0YxIDEyIFRm"
      "CjcyIDcyMCBUZAooSGVsbG8gQ29udHJhY3QgV29ybGQpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoK"
      "NSAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRp"
      "Y2EKPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAw"
      "MCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI3NiAw"
      "MDAwMCBuIAowMDAwMDAwMzcyIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgNgovUm9vdCAxIDAg"
      "Ugo+PgpzdGFydHhyZWYKNDQ3CiUlRU9G"
  )

  @pytest.fixture
  def minimal_pdf_bytes():
      return base64.b64decode(MINIMAL_PDF_B64)

  # ── extract_text_from_bytes tests ─────────────────────────────────────────

  def test_extract_text_returns_string(minimal_pdf_bytes):
      """extract_text_from_bytes should return a string."""
      result = extract_text_from_bytes(minimal_pdf_bytes)
      assert isinstance(result, str)

  def test_extract_text_non_empty(minimal_pdf_bytes):
      """extract_text_from_bytes should extract non-empty text from a valid PDF."""
      result = extract_text_from_bytes(minimal_pdf_bytes)
      assert len(result) > 0

  # ── truncate_text tests ───────────────────────────────────────────────────

  def test_truncate_short_text_unchanged():
      """Text shorter than first_n + last_n should pass through unchanged."""
      text = "short text"
      assert truncate_text(text) == text

  def test_truncate_exact_boundary_unchanged():
      """Text exactly at first_n + last_n (40000) should pass through unchanged."""
      text = "x" * 40000
      result = truncate_text(text)
      assert result == text
      assert len(result) == 40000

  def test_truncate_one_over_boundary():
      """Text of 40001 chars should be truncated with separator."""
      text = "x" * 40001
      result = truncate_text(text)
      assert "[...middle section truncated...]" in result
      assert result.startswith("x" * 30000)
      assert result.endswith("x" * 10000)

  def test_truncate_long_text_correct_parts():
      """First 30k chars and last 10k chars should be preserved correctly."""
      # Build text where first/last chars are identifiable
      first_part = "A" * 30000
      middle_part = "M" * 20000  # middle — should be truncated
      last_part = "Z" * 10000
      text = first_part + middle_part + last_part
      result = truncate_text(text)
      assert result.startswith("A" * 30000)
      assert result.endswith("Z" * 10000)
      assert "M" not in result

  def test_truncate_separator_present():
      """Separator text should be exactly as specified."""
      text = "x" * 50000
      result = truncate_text(text)
      assert "\n\n[...middle section truncated...]\n\n" in result

  def test_truncate_custom_bounds():
      """truncate_text should respect custom first_n and last_n arguments."""
      text = "A" * 5 + "M" * 10 + "Z" * 5
      result = truncate_text(text, first_n=5, last_n=5)
      assert result.startswith("A" * 5)
      assert result.endswith("Z" * 5)
      assert "M" not in result
  ```

- [ ] Run the tests — they should **fail** (functions not yet implemented):
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -m pytest tests/test_main.py::test_extract_text_returns_string tests/test_main.py::test_truncate_short_text_unchanged -v 2>&1 | head -20
  ```
  Expected: `ImportError` or `AttributeError` — functions don't exist yet.

**Implement the functions:**

- [ ] Edit `python-service/main.py` — replace the `# ── PDF extraction (pdfplumber) ──────────────────────` section with:
  ```python
  # ── PDF extraction (pdfplumber) ──────────────────────

  def extract_text_from_bytes(pdf_bytes: bytes) -> str:
      with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
          pages = [page.extract_text() or "" for page in pdf.pages]
      return "\n\n".join(pages).strip()

  def truncate_text(text: str, first_n: int = 30000, last_n: int = 10000) -> str:
      if len(text) <= first_n + last_n:
          return text
      return text[:first_n] + "\n\n[...middle section truncated...]\n\n" + text[-last_n:]
  ```

- [ ] Run all Task 2 tests and verify they pass:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -m pytest tests/test_main.py -v -k "extract_text or truncate"
  ```
  Expected output (all pass):
  ```
  tests/test_main.py::test_extract_text_returns_string PASSED
  tests/test_main.py::test_extract_text_non_empty PASSED
  tests/test_main.py::test_truncate_short_text_unchanged PASSED
  tests/test_main.py::test_truncate_exact_boundary_unchanged PASSED
  tests/test_main.py::test_truncate_one_over_boundary PASSED
  tests/test_main.py::test_truncate_long_text_correct_parts PASSED
  tests/test_main.py::test_truncate_separator_present PASSED
  tests/test_main.py::test_truncate_custom_bounds PASSED
  8 passed in X.XXs
  ```

- [ ] Commit with message: `feat: implement extract_text_from_bytes and truncate_text with tests`

---

### Task 3: Claude extraction function

**Goal:** TDD — write test using `unittest.mock.patch` first, then implement `extract_with_claude`.

**Write tests first:**

- [ ] Append the following to `python-service/tests/test_main.py`:
  ```python
  # ── extract_with_claude tests ─────────────────────────────────────────────
  from unittest.mock import patch, MagicMock
  from main import extract_with_claude, CLAUDE_MODEL, EXTRACTION_TOOL

  MOCK_FIELDS = {
      "effective_date": "2024-01-01",
      "expiry_date": "2025-01-01",
      "renewal_date": None,
      "auto_renew": True,
      "notice_period_days": 30,
      "notice_period_text": "30 days written notice",
      "contract_value": "$48,000/yr",
      "counterparty_name": "Acme Corp Ltd",
      "confidence": 0.94,
  }

  def _make_mock_anthropic_response(fields: dict):
      """Build a mock anthropic response object matching the SDK structure."""
      tool_use_block = MagicMock()
      tool_use_block.type = "tool_use"
      tool_use_block.input = fields
      response = MagicMock()
      response.content = [tool_use_block]
      return response

  def test_extract_with_claude_uses_correct_model():
      """extract_with_claude should call Claude with the correct model."""
      mock_response = _make_mock_anthropic_response(MOCK_FIELDS)
      with patch("anthropic.Anthropic") as MockAnthropic:
          mock_client = MagicMock()
          MockAnthropic.return_value = mock_client
          mock_client.messages.create.return_value = mock_response
          with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
              extract_with_claude("some contract text")
          call_kwargs = mock_client.messages.create.call_args[1]
          assert call_kwargs["model"] == CLAUDE_MODEL
          assert CLAUDE_MODEL == "claude-sonnet-4-6"

  def test_extract_with_claude_uses_tool_choice():
      """extract_with_claude should force tool use with the correct tool name."""
      mock_response = _make_mock_anthropic_response(MOCK_FIELDS)
      with patch("anthropic.Anthropic") as MockAnthropic:
          mock_client = MagicMock()
          MockAnthropic.return_value = mock_client
          mock_client.messages.create.return_value = mock_response
          with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
              extract_with_claude("some contract text")
          call_kwargs = mock_client.messages.create.call_args[1]
          assert call_kwargs["tool_choice"] == {"type": "tool", "name": "extract_contract_fields"}

  def test_extract_with_claude_tool_schema_has_all_required_fields():
      """The EXTRACTION_TOOL schema should list all 9 fields as required."""
      required = EXTRACTION_TOOL["input_schema"]["required"]
      expected = [
          "effective_date", "expiry_date", "renewal_date", "auto_renew",
          "notice_period_days", "notice_period_text", "contract_value",
          "counterparty_name", "confidence",
      ]
      assert sorted(required) == sorted(expected)

  def test_extract_with_claude_returns_all_9_fields():
      """extract_with_claude should return a dict with all 9 expected keys."""
      mock_response = _make_mock_anthropic_response(MOCK_FIELDS)
      with patch("anthropic.Anthropic") as MockAnthropic:
          mock_client = MagicMock()
          MockAnthropic.return_value = mock_client
          mock_client.messages.create.return_value = mock_response
          with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
              result = extract_with_claude("some contract text")
          assert set(result.keys()) == {
              "effective_date", "expiry_date", "renewal_date", "auto_renew",
              "notice_period_days", "notice_period_text", "contract_value",
              "counterparty_name", "confidence",
          }

  def test_extract_with_claude_passes_text_in_message():
      """extract_with_claude should include the contract text in the user message."""
      mock_response = _make_mock_anthropic_response(MOCK_FIELDS)
      with patch("anthropic.Anthropic") as MockAnthropic:
          mock_client = MagicMock()
          MockAnthropic.return_value = mock_client
          mock_client.messages.create.return_value = mock_response
          with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
              extract_with_claude("UNIQUE_CONTRACT_TEXT_MARKER")
          call_kwargs = mock_client.messages.create.call_args[1]
          messages = call_kwargs["messages"]
          assert any("UNIQUE_CONTRACT_TEXT_MARKER" in str(m) for m in messages)
  ```

- [ ] Run the tests — they should **fail** (functions not yet implemented):
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -m pytest tests/test_main.py -v -k "extract_with_claude or tool_schema" 2>&1 | head -20
  ```
  Expected: `ImportError` — `extract_with_claude`, `CLAUDE_MODEL`, `EXTRACTION_TOOL` not yet defined.

**Implement the function:**

- [ ] Edit `python-service/main.py` — replace the `# ── Claude API call ──────────────────────────────────` section with:
  ```python
  # ── Claude API call ──────────────────────────────────

  CLAUDE_MODEL = "claude-sonnet-4-6"

  EXTRACTION_TOOL = {
      "name": "extract_contract_fields",
      "description": (
          "Extract key dates and terms from contract text. "
          "Use null for fields not clearly present. "
          "Set auto_renew=true only if explicit language like 'shall automatically renew' or 'evergreen' is present."
      ),
      "input_schema": {
          "type": "object",
          "required": [
              "effective_date", "expiry_date", "renewal_date", "auto_renew",
              "notice_period_days", "notice_period_text", "contract_value",
              "counterparty_name", "confidence"
          ],
          "properties": {
              "effective_date":     {"type": ["string", "null"], "description": "Contract start/effective date in ISO 8601, or null"},
              "expiry_date":        {"type": ["string", "null"], "description": "Contract expiry/end date in ISO 8601, or null"},
              "renewal_date":       {"type": ["string", "null"], "description": "Auto-renewal date if different from expiry, ISO 8601, or null"},
              "auto_renew":         {"type": "boolean",          "description": "True only if explicit auto-renewal language present"},
              "notice_period_days": {"type": ["integer", "null"],"description": "Notice period in days, or null"},
              "notice_period_text": {"type": ["string", "null"], "description": "Exact notice period text from contract, or null"},
              "contract_value":     {"type": ["string", "null"], "description": "Contract value exactly as written, or null"},
              "counterparty_name":  {"type": ["string", "null"], "description": "Legal entity name of the other party, or null"},
              "confidence":         {"type": "number", "minimum": 0.0, "maximum": 1.0, "description": "Overall extraction confidence 0.0-1.0"},
          }
      }
  }

  def extract_with_claude(text: str) -> dict:
      client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
      response = client.messages.create(
          model=CLAUDE_MODEL,
          max_tokens=1024,
          tools=[EXTRACTION_TOOL],
          tool_choice={"type": "tool", "name": "extract_contract_fields"},
          messages=[{"role": "user", "content": f"Extract the key contract terms from this contract text:\n\n{text}"}]
      )
      tool_use = next(b for b in response.content if b.type == "tool_use")
      return tool_use.input
  ```

- [ ] Run all Task 3 tests and verify they pass:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -m pytest tests/test_main.py -v -k "extract_with_claude or tool_schema"
  ```
  Expected output (all pass):
  ```
  tests/test_main.py::test_extract_with_claude_uses_correct_model PASSED
  tests/test_main.py::test_extract_with_claude_uses_tool_choice PASSED
  tests/test_main.py::test_extract_with_claude_tool_schema_has_all_required_fields PASSED
  tests/test_main.py::test_extract_with_claude_returns_all_9_fields PASSED
  tests/test_main.py::test_extract_with_claude_passes_text_in_message PASSED
  5 passed in X.XXs
  ```

- [ ] Run the full test suite to confirm nothing regressed:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -m pytest tests/test_main.py -v
  ```
  Expected: all 13 tests pass.

- [ ] Commit with message: `feat: implement extract_with_claude with tool use schema and tests`

---

### Task 4: Custom exception + FastAPI endpoints

**Goal:** Add `ExtractionError`, register exception handler, implement `/health`, `/extract`, `/extract-file` endpoints. TDD — write tests first.

**Write tests first:**

- [ ] Create `python-service/tests/conftest.py` with the following content:
  ```python
  """pytest configuration for async tests."""
  import pytest

  pytest_plugins = ["pytest_asyncio"]
  ```

- [ ] Append the following to `python-service/tests/test_main.py`:
  ```python
  # ── Endpoint tests ────────────────────────────────────────────────────────
  import respx
  import httpx as httpx_lib
  from httpx import AsyncClient, ASGITransport

  # We'll import app after Task 4 implementation
  # (these tests will fail until implementation is done — that's expected TDD)

  @pytest.mark.asyncio
  async def test_health_endpoint():
      """GET /health should return 200 with status ok."""
      from main import app
      async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
          response = await ac.get("/health")
      assert response.status_code == 200
      assert response.json() == {"status": "ok"}

  @pytest.mark.asyncio
  async def test_extract_file_empty_bytes_returns_422():
      """POST /extract-file with empty/non-PDF bytes should return 422 no_text_extracted."""
      from main import app
      # Send actual empty bytes — pdfplumber will fail to open, but we want no_text_extracted
      # Use a 1-byte payload to trigger extraction failure
      async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
          response = await ac.post(
              "/extract-file",
              files={"file": ("empty.pdf", b"", "application/pdf")},
          )
      assert response.status_code == 422
      assert response.json()["error"] == "no_text_extracted"

  @pytest.mark.asyncio
  async def test_extract_file_with_mocked_claude_returns_fields(minimal_pdf_bytes):
      """POST /extract-file with valid PDF + mocked Claude should return 200 with all fields."""
      from main import app
      mock_fields = {
          "effective_date": "2024-01-01",
          "expiry_date": "2025-01-01",
          "renewal_date": None,
          "auto_renew": False,
          "notice_period_days": 30,
          "notice_period_text": "30 days notice",
          "contract_value": "$10,000",
          "counterparty_name": "Test Corp",
          "confidence": 0.92,
      }
      mock_response = _make_mock_anthropic_response(mock_fields)
      with patch("anthropic.Anthropic") as MockAnthropic:
          mock_client = MagicMock()
          MockAnthropic.return_value = mock_client
          mock_client.messages.create.return_value = mock_response
          with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
              async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                  response = await ac.post(
                      "/extract-file",
                      files={"file": ("test.pdf", minimal_pdf_bytes, "application/pdf")},
                  )
      assert response.status_code == 200
      data = response.json()
      assert "fields" in data
      assert set(data["fields"].keys()) == {
          "effective_date", "expiry_date", "renewal_date", "auto_renew",
          "notice_period_days", "notice_period_text", "contract_value",
          "counterparty_name", "confidence",
      }

  @pytest.mark.asyncio
  async def test_extract_url_calls_download_and_returns_fields(minimal_pdf_bytes):
      """POST /extract with file_url should download file and return fields."""
      from main import app
      mock_fields = {
          "effective_date": "2024-06-01",
          "expiry_date": "2025-06-01",
          "renewal_date": None,
          "auto_renew": True,
          "notice_period_days": 60,
          "notice_period_text": "sixty days",
          "contract_value": "£12,000 per annum",
          "counterparty_name": "Example Ltd",
          "confidence": 0.88,
      }
      mock_response = _make_mock_anthropic_response(mock_fields)
      with respx.mock:
          respx.get("https://example.com/contract.pdf").mock(
              return_value=httpx_lib.Response(200, content=minimal_pdf_bytes)
          )
          with patch("anthropic.Anthropic") as MockAnthropic:
              mock_client = MagicMock()
              MockAnthropic.return_value = mock_client
              mock_client.messages.create.return_value = mock_response
              with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
                  async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                      response = await ac.post(
                          "/extract",
                          json={"file_url": "https://example.com/contract.pdf", "contract_id": "test-uuid"},
                      )
      assert response.status_code == 200
      data = response.json()
      assert data["contract_id"] == "test-uuid"
      assert "fields" in data

  @pytest.mark.asyncio
  async def test_extract_url_download_failure_returns_422():
      """POST /extract with unreachable URL should return 422 file_download_failed."""
      from main import app
      with respx.mock:
          respx.get("https://example.com/bad.pdf").mock(
              side_effect=httpx_lib.ConnectError("Connection refused")
          )
          async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
              response = await ac.post(
                  "/extract",
                  json={"file_url": "https://example.com/bad.pdf"},
              )
      assert response.status_code == 422
      assert response.json()["error"] == "file_download_failed"
  ```

- [ ] Run the tests — they should **fail** (endpoints not yet implemented):
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -m pytest tests/test_main.py -v -k "endpoint or health or extract_file or extract_url" 2>&1 | head -30
  ```
  Expected: tests fail because endpoints don't exist.

**Implement the endpoints:**

- [ ] Edit `python-service/main.py` — replace the `# ── Custom exceptions ────────────────────────────────` section with:
  ```python
  # ── Custom exceptions ────────────────────────────────

  class ExtractionError(Exception):
      def __init__(self, status_code: int, error: str, detail: str | None = None):
          self.status_code = status_code
          self.error = error
          self.detail = detail
  ```

- [ ] Edit `python-service/main.py` — replace the `# ── FastAPI app ──────────────────────────────────────` section and the line `app = FastAPI(title="Renewl PDF Extraction Service")` with:
  ```python
  # ── FastAPI app ──────────────────────────────────────

  app = FastAPI(title="Renewl PDF Extraction Service")

  @app.exception_handler(ExtractionError)
  async def extraction_error_handler(request: Request, exc: ExtractionError):
      content = {"error": exc.error}
      if exc.detail:
          content["detail"] = exc.detail
      return JSONResponse(status_code=exc.status_code, content=content)

  @app.get("/health")
  def health():
      return {"status": "ok"}

  async def _run_extraction(pdf_bytes: bytes, contract_id: str | None) -> dict:
      start = time.time()
      try:
          text = extract_text_from_bytes(pdf_bytes)
      except Exception:
          text = ""
      if not text.strip():
          raise ExtractionError(422, "no_text_extracted")
      text = truncate_text(text)
      try:
          fields = extract_with_claude(text)
      except ExtractionError:
          raise
      except Exception as e:
          raise ExtractionError(503, "claude_api_error", str(e))
      return {
          "contract_id": contract_id,
          "fields": fields,
          "raw_text_length": len(text),
          "extraction_time_ms": int((time.time() - start) * 1000),
          "model": CLAUDE_MODEL,
      }

  class ExtractRequest(BaseModel):
      file_url: str
      contract_id: str | None = None

  @app.post("/extract")
  async def extract(req: ExtractRequest):
      try:
          async with httpx.AsyncClient(timeout=30.0) as client:
              r = await client.get(req.file_url)
              r.raise_for_status()
      except Exception as e:
          raise ExtractionError(422, "file_download_failed", str(e))
      return await _run_extraction(r.content, req.contract_id)

  @app.post("/extract-file")
  async def extract_file(file: UploadFile = File(...), contract_id: str | None = None):
      return await _run_extraction(await file.read(), contract_id)
  ```

- [ ] Run all Task 4 tests and verify they pass:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -m pytest tests/test_main.py -v -k "endpoint or health or extract_file or extract_url"
  ```
  Expected output (all pass):
  ```
  tests/test_main.py::test_health_endpoint PASSED
  tests/test_main.py::test_extract_file_empty_bytes_returns_422 PASSED
  tests/test_main.py::test_extract_file_with_mocked_claude_returns_fields PASSED
  tests/test_main.py::test_extract_url_calls_download_and_returns_fields PASSED
  tests/test_main.py::test_extract_url_download_failure_returns_422 PASSED
  5 passed in X.XXs
  ```

- [ ] Run the full test suite to confirm all tests pass:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python -m pytest tests/test_main.py -v
  ```
  Expected: all 18 tests pass.

- [ ] Smoke test the running server:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && uvicorn main:app --reload &
  sleep 2 && curl -s http://localhost:8000/health
  ```
  Expected output: `{"status":"ok"}`
  Stop the background server after smoke test: `kill %1` (or `pkill -f "uvicorn main:app"`)

- [ ] Commit with message: `feat: add ExtractionError, /health, /extract, /extract-file endpoints with tests`

---

### Task 5: Dockerfile + railway.toml

**Goal:** Add deployment configuration files and update `.gitignore`.

- [ ] Create `python-service/Dockerfile` with exact content:
  ```dockerfile
  FROM python:3.12-slim

  WORKDIR /app

  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt

  COPY main.py .

  EXPOSE 8080

  CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
  ```

- [ ] Create `python-service/railway.toml` with exact content:
  ```toml
  [build]
  builder = "dockerfile"

  [deploy]
  startCommand = "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"
  healthcheckPath = "/health"
  healthcheckTimeout = 30
  restartPolicyType = "on_failure"
  ```

- [ ] Create `python-service/.gitignore` with exact content:
  ```
  .env
  contracts/
  __pycache__/
  *.pyc
  .pytest_cache/
  ```

- [ ] Add `contracts/` to the root `.gitignore` as well (append to `/Users/dmitrygolovach/code/renewl/.gitignore`):
  ```
  # Python service test contracts (real PDFs — never commit)
  python-service/contracts/
  ```

- [ ] If Docker is available, verify the image builds successfully:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && docker build -t renewl-extraction . 2>&1 | tail -5
  ```
  Expected output: `Successfully built <image_id>` and `Successfully tagged renewl-extraction:latest`
  If Docker is not available, skip this step and note it.

- [ ] Commit with message: `feat: add Dockerfile, railway.toml, and .gitignore for python-service`

---

### Task 6: Accuracy test script (`test_accuracy.py`)

**Goal:** Create the CLI accuracy validation script that calls the running Python service against real PDFs.

- [ ] Create `python-service/test_accuracy.py` with exact content:
  ```python
  #!/usr/bin/env python3
  """
  Accuracy validation script for the Renewl extraction service.
  Usage: python test_accuracy.py contracts/          # all PDFs in directory
         python test_accuracy.py contracts/aws.pdf   # single file
  """
  import sys, os, time, pathlib
  import httpx

  SERVICE_URL = os.getenv("EXTRACTION_SERVICE_URL", "http://localhost:8000")
  FIELDS = ["counterparty_name", "effective_date", "expiry_date", "renewal_date",
            "auto_renew", "notice_period_days", "contract_value"]

  def run_extraction(pdf_path: pathlib.Path) -> dict:
      with open(pdf_path, "rb") as f:
          r = httpx.post(f"{SERVICE_URL}/extract-file",
                         files={"file": (pdf_path.name, f, "application/pdf")},
                         timeout=120)
      return r.json() if r.status_code == 200 else {"error": r.json().get("error", "unknown")}

  def confidence_emoji(c) -> str:
      if isinstance(c, float):
          if c >= 0.90: return f"{c:.2f} 🟢"
          if c >= 0.70: return f"{c:.2f} 🟡"
          return f"{c:.2f} 🔴"
      return str(c)

  def fmt_field(val) -> str:
      if val is None: return "✗ null"
      s = str(val)
      return f"✓ {s[:10]}" if len(s) > 10 else f"✓ {s}"

  def main():
      if len(sys.argv) < 2:
          print("Usage: python test_accuracy.py <pdf_or_directory>")
          sys.exit(1)

      path = pathlib.Path(sys.argv[1])
      pdfs = sorted(path.glob("*.pdf")) if path.is_dir() else [path]
      if not pdfs:
          print(f"No PDFs found in {path}")
          sys.exit(1)

      results = []
      for pdf in pdfs:
          print(f"Processing {pdf.name}...", end=" ", flush=True)
          t = time.time()
          data = run_extraction(pdf)
          elapsed = int((time.time() - t) * 1000)
          results.append({"file": pdf.name, "data": data, "elapsed_ms": elapsed})
          print("done" if "fields" in data else f"ERROR: {data.get('error')}")

      # Print table
      col_w = 22
      print("\n" + "─" * (col_w + (13 * len(FIELDS)) + 22 + 12))
      header = f"{'file':<{col_w}}" + "".join(f"{f[:11]:<13}" for f in FIELDS) + f"{'confidence':<22}{'time(ms)':<12}"
      print(header)
      print("─" * len(header))

      succeeded, total_confidence, total_fields_extracted, total_fields = 0, 0.0, 0, 0
      errors = []
      total_time = 0

      for r in results:
          data, file, elapsed = r["data"], r["file"], r["elapsed_ms"]
          total_time += elapsed
          if "error" in data and "fields" not in data:
              errors.append(file)
              row = f"{file[:col_w-1]:<{col_w}}" + "".join(f"{'✗ err':<13}" for _ in FIELDS)
              row += f"{data.get('error','error'):<22}{elapsed:<12}"
          else:
              succeeded += 1
              fields = data.get("fields", {})
              conf = fields.get("confidence")
              total_confidence += conf or 0
              extracted = sum(1 for f in FIELDS if fields.get(f) is not None)
              total_fields_extracted += extracted
              total_fields += len(FIELDS)
              row = f"{file[:col_w-1]:<{col_w}}"
              row += "".join(f"{fmt_field(fields.get(f)):<13}" for f in FIELDS)
              row += f"{confidence_emoji(conf):<22}{elapsed:<12}"
          print(row)

      print("─" * len(header))
      n = len(results)
      avg_conf = total_confidence / succeeded if succeeded else 0
      pct = f"{total_fields_extracted}/{total_fields} ({100*total_fields_extracted//total_fields if total_fields else 0}%)"
      avg_time = total_time // n if n else 0
      print(f"\nSummary: {succeeded}/{n} succeeded · avg confidence {avg_conf:.3f} · fields extracted: {pct} · avg time {avg_time:,}ms")
      if errors:
          print(f"Scanned/failed: {len(errors)} ({', '.join(errors)})")

  if __name__ == "__main__":
      main()
  ```

- [ ] Create `python-service/contracts/` directory:
  ```bash
  mkdir -p /Users/dmitrygolovach/code/renewl/python-service/contracts
  ```

- [ ] Drop at least one real contract PDF into `python-service/contracts/` — e.g. `python-service/contracts/sample.pdf`. This file is gitignored.

- [ ] Start the Python service in one terminal:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && uvicorn main:app --reload
  ```

- [ ] In a second terminal, run the accuracy script against the contracts directory:
  ```bash
  cd /Users/dmitrygolovach/code/renewl/python-service && python test_accuracy.py contracts/
  ```
  Expected output format (example):
  ```
  Processing sample.pdf... done
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  file                  counterpart  effective_  expiry_dat renewal_da auto_renew notice_per contract_v confidence            time(ms)
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  sample.pdf            ✓ Acme Corp  ✓ 2024-01-0 ✓ 2025-01-0 ✗ null    ✓ True     ✓ 30       ✓ $48,000/ 0.94 🟢              3241
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  Summary: 1/1 succeeded · avg confidence 0.940 · fields extracted: 6/7 (85%) · avg time 3,241ms
  ```

- [ ] Commit with message: `feat: add test_accuracy.py CLI script for extraction validation`

---

### Task 7: Next.js extract route

**Goal:** Implement `app/api/extract/route.ts`. Add missing unique constraint migration. Verify TypeScript compiles.

**Pre-task: Add unique constraint migration**

- [ ] Create `supabase/migrations/20260321000001_contract_extractions_unique.sql` with exact content:
  ```sql
  -- Add unique constraint on contract_extractions(contract_id, field_name)
  -- Required for upsert in the extract route to work correctly.
  ALTER TABLE public.contract_extractions
    ADD CONSTRAINT contract_extractions_contract_id_field_name_key
    UNIQUE (contract_id, field_name);
  ```

- [ ] Apply the migration to your local Supabase instance:
  ```bash
  cd /Users/dmitrygolovach/code/renewl && npx supabase db push
  ```
  OR apply directly via the Supabase SQL editor in the dashboard.

**Implement the route:**

- [ ] Create `app/api/extract/route.ts` with exact content:
  ```typescript
  import { NextResponse } from "next/server";
  import { createClient } from "@/lib/supabase/server";
  import { createClient as createAdminClient } from "@supabase/supabase-js";

  export const maxDuration = 60;
  export const dynamic = "force-dynamic";

  const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

  export async function POST(request: Request) {
    // 1. Auth
    const sessionClient = await createClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 2. Parse + validate body
    const { contract_id } = await request.json();
    if (!contract_id) return NextResponse.json({ error: "contract_id required" }, { status: 400 });

    // 3. Fetch contract (RLS enforces ownership)
    const { data: contract, error: contractError } = await sessionClient
      .from("contracts")
      .select("id, status, file_path, file_name")
      .eq("id", contract_id)
      .single();
    if (contractError || !contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    if (["review", "confirmed"].includes(contract.status)) {
      return NextResponse.json({ error: "Already processed" }, { status: 409 });
    }
    if (!contract.file_path) return NextResponse.json({ error: "No file attached" }, { status: 422 });

    // 4. Generate signed URL (admin client — storage requires service role)
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: signedData, error: signError } = await adminClient.storage
      .from("contracts")
      .createSignedUrl(contract.file_path, 60);
    if (signError || !signedData) {
      return NextResponse.json({ error: "Could not generate file URL" }, { status: 500 });
    }

    // 5. Call Python service (55s timeout)
    let extractionResult: any;
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_url: signedData.signedUrl, contract_id }),
        signal: AbortSignal.timeout(55000),
      });
      extractionResult = await res.json();
      if (!res.ok) extractionResult = { error: extractionResult.error ?? "extraction_failed" };
    } catch (e) {
      extractionResult = { error: "timeout_or_network_error" };
    }

    // 6. Branch on result
    const failed = "error" in extractionResult && !("fields" in extractionResult);
    const isScanned = extractionResult.error === "no_text_extracted";
    const fields = extractionResult.fields ?? {};
    const confidence: number = fields.confidence ?? 0;
    const lowConfidence = !failed && confidence < 0.70;

    const extractionStatus = failed ? "manual" : "review";
    const statusMessage = isScanned
      ? "This looks like a scanned PDF. Please enter the dates manually."
      : failed
      ? "Extraction failed. Please enter dates manually."
      : null;

    // 7. Upsert contract_extractions (one row per field, skip if failed)
    if (!failed) {
      const fieldNames = [
        "effective_date", "expiry_date", "renewal_date", "auto_renew",
        "notice_period_days", "notice_period_text", "contract_value",
        "counterparty_name", "confidence",
      ];
      const rows = fieldNames.map((field) => ({
        contract_id,
        field_name: field,
        extracted_value: fields[field] != null ? String(fields[field]) : null,
        confirmed_value: null,
        confidence,
        was_edited: false,
      }));
      await sessionClient.from("contract_extractions").upsert(rows, {
        onConflict: "contract_id,field_name",
      });
    }

    // 8. Update contracts
    await sessionClient.from("contracts").update({
      extraction_status: extractionStatus,
      extraction_confidence: failed ? null : confidence,
      status: "review",
      updated_at: new Date().toISOString(),
    }).eq("id", contract_id);

    // 9. Insert activity_log
    await sessionClient.from("activity_log").insert({
      user_id: user.id,
      contract_id,
      event_type: "extraction_complete",
      metadata: {
        model: extractionResult.model ?? null,
        confidence: failed ? null : confidence,
        raw_text_length: extractionResult.raw_text_length ?? null,
        extraction_status: extractionStatus,
        error: extractionResult.error ?? null,
      },
    });

    // 10. Respond
    if (failed) {
      return NextResponse.json({ status: "manual", message: statusMessage });
    }
    return NextResponse.json({
      status: "review",
      contract_id,
      low_confidence: lowConfidence,
    });
  }
  ```

- [ ] Add `PYTHON_SERVICE_URL` comment to `.env.local`:
  ```
  # PYTHON_SERVICE_URL=http://localhost:8000  # uncomment to override default
  ```

- [ ] Verify TypeScript compiles without errors:
  ```bash
  cd /Users/dmitrygolovach/code/renewl && npx tsc --noEmit
  ```
  Expected: no output (no errors).

- [ ] Commit with message: `feat: implement /api/extract route with auth, signed URL, Python service call, and Supabase writes`

---

### Task 8: Integration smoke test

**Goal:** Verify the full end-to-end flow works: Next.js → Python service → Supabase.

**Prerequisites:**
- Python service running: `cd /Users/dmitrygolovach/code/renewl/python-service && uvicorn main:app --reload`
- Next.js dev server running: `cd /Users/dmitrygolovach/code/renewl && npm run dev`
- A real PDF uploaded to Supabase Storage in the `contracts` bucket

**Steps:**

- [ ] In the Supabase dashboard SQL editor, insert a test contract row (replace `<your-user-id>` and `<file-path>` with actual values):
  ```sql
  INSERT INTO public.contracts (user_id, name, category, status, extraction_status, file_path, file_name)
  VALUES (
    '<your-user-id>',
    'Test Contract',
    'other',
    'processing',
    'pending',
    '<your-user-id>/<contract-id>/contract.pdf',
    'contract.pdf'
  )
  RETURNING id;
  ```
  Note the returned `id` — this is your `contract_id`.

- [ ] Upload a PDF to Supabase Storage in the `contracts` bucket at the path `<your-user-id>/<contract-id>/contract.pdf` (use the dashboard Storage tab).

- [ ] Get your auth token:
  1. Open the Next.js app in the browser (e.g. `http://localhost:3000`)
  2. Open DevTools → Application → Local Storage → find the Supabase token key
  3. Copy the `access_token` value from the JSON

- [ ] Call the extract route:
  ```bash
  curl -X POST http://localhost:3000/api/extract \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <YOUR_ACCESS_TOKEN>" \
    -d '{"contract_id": "<YOUR_CONTRACT_ID>"}'
  ```
  Expected response:
  ```json
  {"status": "review", "contract_id": "<YOUR_CONTRACT_ID>", "low_confidence": false}
  ```
  (or `{"status": "manual", "message": "..."}` if the PDF is scanned)

- [ ] Verify data in Supabase dashboard:
  1. Check `contract_extractions` table — should have 9 rows for your contract_id (one per field)
  2. Check `contracts` table — `status` should be `'review'`, `extraction_status` should be `'review'`, `extraction_confidence` should be populated
  3. Check `activity_log` table — should have one row with `event_type = 'extraction_complete'`

- [ ] If any bugs are found during smoke test, fix them and commit with message: `fix: smoke test corrections for extract route`

- [ ] Final commit (if no bugs): `feat: pdf extraction core complete — python service + next.js route + smoke test verified`

---

## Complete `main.py` Reference

The final `python-service/main.py` after all tasks should contain exactly:

```python
"""Renewl PDF Extraction Service"""
import os, io, time
from typing import Optional
import pdfplumber
import anthropic
import httpx
from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# ── Response models ───────────────────────────────────
# (No Pydantic response models needed in v1 — FastAPI serializes dicts directly)

# ── Custom exceptions ────────────────────────────────

class ExtractionError(Exception):
    def __init__(self, status_code: int, error: str, detail: str | None = None):
        self.status_code = status_code
        self.error = error
        self.detail = detail

# ── PDF extraction (pdfplumber) ──────────────────────

def extract_text_from_bytes(pdf_bytes: bytes) -> str:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n\n".join(pages).strip()

def truncate_text(text: str, first_n: int = 30000, last_n: int = 10000) -> str:
    if len(text) <= first_n + last_n:
        return text
    return text[:first_n] + "\n\n[...middle section truncated...]\n\n" + text[-last_n:]

# ── Claude API call ──────────────────────────────────

CLAUDE_MODEL = "claude-sonnet-4-6"

EXTRACTION_TOOL = {
    "name": "extract_contract_fields",
    "description": (
        "Extract key dates and terms from contract text. "
        "Use null for fields not clearly present. "
        "Set auto_renew=true only if explicit language like 'shall automatically renew' or 'evergreen' is present."
    ),
    "input_schema": {
        "type": "object",
        "required": [
            "effective_date", "expiry_date", "renewal_date", "auto_renew",
            "notice_period_days", "notice_period_text", "contract_value",
            "counterparty_name", "confidence"
        ],
        "properties": {
            "effective_date":     {"type": ["string", "null"], "description": "Contract start/effective date in ISO 8601, or null"},
            "expiry_date":        {"type": ["string", "null"], "description": "Contract expiry/end date in ISO 8601, or null"},
            "renewal_date":       {"type": ["string", "null"], "description": "Auto-renewal date if different from expiry, ISO 8601, or null"},
            "auto_renew":         {"type": "boolean",          "description": "True only if explicit auto-renewal language present"},
            "notice_period_days": {"type": ["integer", "null"],"description": "Notice period in days, or null"},
            "notice_period_text": {"type": ["string", "null"], "description": "Exact notice period text from contract, or null"},
            "contract_value":     {"type": ["string", "null"], "description": "Contract value exactly as written, or null"},
            "counterparty_name":  {"type": ["string", "null"], "description": "Legal entity name of the other party, or null"},
            "confidence":         {"type": "number", "minimum": 0.0, "maximum": 1.0, "description": "Overall extraction confidence 0.0-1.0"},
        }
    }
}

def extract_with_claude(text: str) -> dict:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        tools=[EXTRACTION_TOOL],
        tool_choice={"type": "tool", "name": "extract_contract_fields"},
        messages=[{"role": "user", "content": f"Extract the key contract terms from this contract text:\n\n{text}"}]
    )
    tool_use = next(b for b in response.content if b.type == "tool_use")
    return tool_use.input

# ── FastAPI app ──────────────────────────────────────

app = FastAPI(title="Renewl PDF Extraction Service")

@app.exception_handler(ExtractionError)
async def extraction_error_handler(request: Request, exc: ExtractionError):
    content = {"error": exc.error}
    if exc.detail:
        content["detail"] = exc.detail
    return JSONResponse(status_code=exc.status_code, content=content)

@app.get("/health")
def health():
    return {"status": "ok"}

async def _run_extraction(pdf_bytes: bytes, contract_id: str | None) -> dict:
    start = time.time()
    try:
        text = extract_text_from_bytes(pdf_bytes)
    except Exception:
        text = ""
    if not text.strip():
        raise ExtractionError(422, "no_text_extracted")
    text = truncate_text(text)
    try:
        fields = extract_with_claude(text)
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(503, "claude_api_error", str(e))
    return {
        "contract_id": contract_id,
        "fields": fields,
        "raw_text_length": len(text),
        "extraction_time_ms": int((time.time() - start) * 1000),
        "model": CLAUDE_MODEL,
    }

class ExtractRequest(BaseModel):
    file_url: str
    contract_id: str | None = None

@app.post("/extract")
async def extract(req: ExtractRequest):
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(req.file_url)
            r.raise_for_status()
    except Exception as e:
        raise ExtractionError(422, "file_download_failed", str(e))
    return await _run_extraction(r.content, req.contract_id)

@app.post("/extract-file")
async def extract_file(file: UploadFile = File(...), contract_id: str | None = None):
    return await _run_extraction(await file.read(), contract_id)
```

---

## File Tree After All Tasks

```
/Users/dmitrygolovach/code/renewl/
├── app/
│   └── api/
│       ├── extract/
│       │   └── route.ts                        # NEW — Task 7
│       └── waitlist/
│           └── route.ts
├── python-service/                             # NEW — Task 1
│   ├── main.py                                 # Tasks 1-4
│   ├── requirements.txt                        # Task 1
│   ├── requirements-dev.txt                    # Task 1
│   ├── .env                                    # Task 1 (gitignored)
│   ├── .env.example                            # Task 1
│   ├── Dockerfile                              # Task 5
│   ├── railway.toml                            # Task 5
│   ├── .gitignore                              # Task 5
│   ├── test_accuracy.py                        # Task 6
│   ├── contracts/                              # Task 6 (gitignored — drop real PDFs here)
│   └── tests/
│       ├── __init__.py                         # Task 1
│       ├── conftest.py                         # Task 4
│       └── test_main.py                        # Tasks 2-4
└── supabase/
    └── migrations/
        ├── 20260321000000_initial_schema.sql   # Existing
        └── 20260321000001_contract_extractions_unique.sql  # NEW — Task 7 pre-task
```
