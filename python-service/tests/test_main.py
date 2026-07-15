import io
import json
import base64
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

# Minimal valid single-page PDF (base64-encoded)
MINIMAL_PDF_B64 = (
    "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2Jq"
    "CjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPD4KZW5kb2Jq"
    "CjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIg"
    "NzkyXQovQ29udGVudHMgNCAwIFIKL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4g"
    "Pj4KPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NCA+PgpzdHJlYW0KQlQgL0YxIDEyIFRm"
    "IDEwMCA3MDAgVGQgKEhlbGxvIFdvcmxkKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoK"
    "PDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVu"
    "ZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAw"
    "MDAwMDA2OCAwMDAwMCBuIAowMDAwMDAwMTI1IDAwMDAwIG4gCjAwMDAwMDAyNjMgMDAwMDAgbiAK"
    "MDAwMDAwMDM1OSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMSAwIFIKPj4Kc3Rh"
    "cnR4cmVmCjQzNgolJUVPRgo="
)

MINIMAL_PDF = base64.b64decode(MINIMAL_PDF_B64)


# ── Mock helpers ─────────────────────────────────────

def _make_anthropic_tool_mock(fields: dict):
    """Build a mock anthropic.Anthropic() instance whose messages.create returns a tool_use block."""
    mock_tool_block = MagicMock()
    mock_tool_block.type = "tool_use"
    mock_tool_block.input = fields
    mock_response = MagicMock()
    mock_response.content = [mock_tool_block]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    return mock_client


def _make_anthropic_text_mock(text: str):
    """Build a mock anthropic.Anthropic() instance whose messages.create returns a text block."""
    mock_text_block = MagicMock()
    mock_text_block.text = text
    mock_response = MagicMock()
    mock_response.content = [mock_text_block]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response
    return mock_client


# ── extract_text_from_bytes ──────────────────────────

def test_extract_text_from_bytes_returns_string():
    from main import extract_text_from_bytes
    result = extract_text_from_bytes(MINIMAL_PDF)
    assert isinstance(result, str)

def test_extract_text_from_bytes_nonempty():
    from main import extract_text_from_bytes
    result = extract_text_from_bytes(MINIMAL_PDF)
    assert len(result) > 0

def test_extract_text_from_bytes_contains_hello():
    from main import extract_text_from_bytes
    result = extract_text_from_bytes(MINIMAL_PDF)
    assert "Hello" in result


# ── truncate_text ────────────────────────────────────

def test_truncate_short_text_unchanged():
    from main import truncate_text
    text = "A" * 100
    assert truncate_text(text) == text

def test_truncate_exact_boundary_unchanged():
    from main import truncate_text
    text = "A" * 40000
    result = truncate_text(text)
    assert result == text

def test_truncate_long_text_contains_marker():
    from main import truncate_text
    text = "A" * 50000
    result = truncate_text(text)
    assert "[...middle section truncated...]" in result

def test_truncate_long_text_first_chars():
    from main import truncate_text
    text = "S" * 30000 + "M" * 20000 + "E" * 10000
    result = truncate_text(text)
    assert result.startswith("S" * 30000)

def test_truncate_long_text_last_chars():
    from main import truncate_text
    text = "S" * 30000 + "M" * 20000 + "E" * 10000
    result = truncate_text(text)
    assert result.endswith("E" * 10000)


# ── extract_with_claude ──────────────────────────────

def test_extract_with_claude_returns_all_fields():
    """extract_with_claude should return a dict with all 10 required fields."""
    fields = {
        "effective_date": "2024-01-01",
        "expiry_date": "2025-01-01",
        "renewal_date": None,
        "auto_renew": True,
        "notice_period_days": 30,
        "notice_period_text": "30 days written notice",
        "contract_value": "$48,000 per annum",
        "party_a": "Acme Corp",
        "party_b": None,
        "confidence": 0.94,
        "category": "saas",
    }
    mock_client = _make_anthropic_tool_mock(fields)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        from main import extract_with_claude
        result = extract_with_claude("Sample contract text")

    assert result["effective_date"] == "2024-01-01"
    assert result["expiry_date"] == "2025-01-01"
    assert result["auto_renew"] is True
    assert result["notice_period_days"] == 30
    assert result["confidence"] == 0.94
    assert result["category"] == "saas"


def test_extract_with_claude_uses_correct_model():
    """extract_with_claude must use AI_MODEL and forced tool_choice."""
    fields = {
        "effective_date": None, "expiry_date": None, "renewal_date": None,
        "auto_renew": False, "notice_period_days": None, "notice_period_text": None,
        "contract_value": None, "party_a": None, "party_b": None, "confidence": 0.5,
        "category": "other",
    }
    mock_client = _make_anthropic_tool_mock(fields)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        from main import extract_with_claude, AI_MODEL
        extract_with_claude("text")

        call_kwargs = mock_client.messages.create.call_args[1]
        assert call_kwargs["model"] == AI_MODEL
        assert call_kwargs["tool_choice"] == {"type": "tool", "name": "extract_contract_fields"}


def test_extract_with_claude_tool_schema_has_all_required_fields():
    """EXTRACTION_TOOL schema must declare all required fields (party_a/party_b removed — user-provided now)."""
    from main import EXTRACTION_TOOL

    required = EXTRACTION_TOOL["input_schema"]["required"]
    expected = [
        "effective_date", "expiry_date", "renewal_date", "auto_renew",
        "notice_period_days", "notice_period_text", "contract_value", "confidence", "category",
    ]
    for field in expected:
        assert field in required, f"Missing required field: {field}"


# ── detect_parties ───────────────────────────────────

def _mock_detect_claude(party_a, party_b, confidence=0.9):
    """Return a patched anthropic.Anthropic that yields a detect_parties JSON response."""
    mock_client = MagicMock()
    mock_client.messages.create.return_value.content = [
        MagicMock(text=json.dumps({"party_a": party_a, "party_b": party_b, "confidence": confidence}))
    ]
    return mock_client


def test_detect_returns_party_names():
    from main import detect_parties
    with patch("main.anthropic.Anthropic") as mock_cls:
        mock_cls.return_value = _mock_detect_claude("Acme Inc", "Globex Corporation", 0.9)
        result = detect_parties("This Agreement is by and between Acme Inc and Globex Corporation.")
    assert result["party_a"] == "Acme Inc"
    assert result["party_b"] == "Globex Corporation"
    assert result["confidence"] == 0.9


def test_detect_only_sends_first_1500_chars():
    from main import detect_parties
    long_text = "x" * 5000
    with patch("main.anthropic.Anthropic") as mock_cls:
        mock_client = _mock_detect_claude("A Corp", "B Corp", 0.8)
        mock_cls.return_value = mock_client
        detect_parties(long_text)
    call_kwargs = mock_client.messages.create.call_args
    sent = call_kwargs[1]["messages"][0]["content"]
    assert "x" * 1501 not in sent  # snippet capped at 1500


def test_detect_strips_markdown_fences():
    from main import detect_parties
    mock_client = MagicMock()
    mock_client.messages.create.return_value.content = [
        MagicMock(text='```json\n{"party_a": "Foo LLC", "party_b": "Bar Inc", "confidence": 0.85}\n```')
    ]
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        result = detect_parties("Some contract text.")
    assert result["party_a"] == "Foo LLC"
    assert result["party_b"] == "Bar Inc"


def test_detect_empty_text():
    from main import detect_parties
    result = detect_parties("")
    assert result["party_a"] is None
    assert result["party_b"] is None
    assert result["confidence"] == 0.0


def test_detect_claude_error_returns_nulls():
    from main import detect_parties
    mock_client = MagicMock()
    mock_client.messages.create.side_effect = Exception("network error")
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        result = detect_parties("Some contract text.")
    assert result["party_a"] is None
    assert result["party_b"] is None
    assert result["confidence"] == 0.0


# ── anonymize_text ───────────────────────────────────

def test_anonymize_replaces_party_a():
    from main import anonymize_text
    text = "This agreement is between Acme Inc and Globex Corporation."
    result = anonymize_text(text, "Acme Inc", "Globex Corporation")
    assert "Acme" not in result
    assert "Party A" in result


def test_anonymize_replaces_party_b():
    from main import anonymize_text
    text = "This agreement is between Acme Inc and Globex Corporation."
    result = anonymize_text(text, "Acme Inc", "Globex Corporation")
    assert "Globex" not in result
    assert "Party B" in result


def test_anonymize_case_insensitive():
    from main import anonymize_text
    text = "ACME INC agrees to pay GLOBEX CORP quarterly."
    result = anonymize_text(text, "Acme Inc", "Globex Corp")
    assert "ACME" not in result
    assert "GLOBEX" not in result


def test_anonymize_none_party_skipped():
    from main import anonymize_text
    text = "Acme Inc agrees to terms."
    result = anonymize_text(text, "Acme Inc", None)
    assert "Party A" in result
    assert "Acme" not in result


def test_anonymize_empty_text():
    from main import anonymize_text
    assert anonymize_text("", "Acme", "Globex") == ""


def test_anonymize_short_name_skipped():
    from main import anonymize_text
    # "A" is 1 char — base name too short, should not be replaced
    text = "A is the first letter."
    result = anonymize_text(text, "A", "Globex")
    assert "A is" in result  # "A" not replaced


def test_anonymize_strips_parenthetical_abbreviation():
    from main import anonymize_text
    text = 'Amazon Web Services, Inc. ("AWS"), and GlobalTech Corp. AWS shall provide services. AWS is liable.'
    result = anonymize_text(text, "Amazon Web Services, Inc.", "GlobalTech Corp")
    assert "AWS" not in result
    assert "Amazon" not in result
    assert "GlobalTech" not in result
    assert result.count("Party A") >= 2


def test_anonymize_multiple_occurrences():
    from main import anonymize_text
    text = "Acme Inc shall pay. Acme will deliver. Acme's obligations include services."
    result = anonymize_text(text, "Acme Inc", None)
    assert "Acme" not in result


# ── /detect-parties endpoint ─────────────────────────

def test_detect_parties_endpoint_happy_path(client):
    """POST /detect-parties returns detected party names."""
    mock_response = MagicMock()
    mock_response.content = MINIMAL_PDF
    mock_response.raise_for_status = lambda: None

    mock_anthropic = MagicMock()
    mock_anthropic.messages.create.return_value.content = [
        MagicMock(text='{"party_a": "Acme Inc", "party_b": "Globex Corp", "confidence": 0.9}')
    ]

    with patch("main.ALLOWED_STORAGE_DOMAINS", ["storage.example.com"]):
        with patch("main.extract_text_from_bytes", return_value="This Agreement is between Acme Inc and Globex Corp."):
            with patch("main.anthropic.Anthropic", return_value=mock_anthropic):
                with patch("main.httpx.AsyncClient") as mock_client_cls:
                    mock_client = mock_client_cls.return_value.__aenter__.return_value
                    mock_client.get = AsyncMock(return_value=mock_response)

                    r = client.post("/detect-parties", json={
                        "file_url": "https://storage.example.com/contract.pdf",
                    })

    assert r.status_code == 200
    data = r.json()
    assert "party_a" in data
    assert "party_b" in data
    assert "confidence" in data
    assert "Acme" in (data["party_a"] or "")


def test_detect_parties_endpoint_empty_pdf(client):
    """POST /detect-parties returns zeroed result for unextractable PDF."""
    mock_response = MagicMock()
    mock_response.content = MINIMAL_PDF
    mock_response.raise_for_status = lambda: None

    with patch("main.ALLOWED_STORAGE_DOMAINS", ["storage.example.com"]):
        with patch("main.extract_text_from_bytes", return_value=""):
            with patch("main.httpx.AsyncClient") as mock_client_cls:
                mock_client = mock_client_cls.return_value.__aenter__.return_value
                mock_client.get = AsyncMock(return_value=mock_response)

                r = client.post("/detect-parties", json={
                    "file_url": "https://storage.example.com/contract.pdf",
                })

    assert r.status_code == 200
    data = r.json()
    assert data["party_a"] is None
    assert data["party_b"] is None
    assert data["confidence"] == 0.0


def test_detect_parties_requires_auth(client):
    """POST /detect-parties returns 401 without auth header."""
    from fastapi.testclient import TestClient
    from main import app
    unauthed = TestClient(app, headers={})
    r = unauthed.post("/detect-parties", json={"file_url": "https://storage.example.com/file.pdf"})
    assert r.status_code == 401


# ── Endpoint tests ───────────────────────────────────

def test_health_endpoint(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_extract_file_success(client):
    """POST /extract-file returns extraction result for a valid PDF."""
    mock_fields = {
        "effective_date": "2024-01-01",
        "expiry_date": "2025-01-01",
        "renewal_date": None,
        "auto_renew": True,
        "notice_period_days": 30,
        "notice_period_text": "30 days notice",
        "contract_value": "$48,000",
        "party_a": "Acme Corp",
        "party_b": None,
        "confidence": 0.95,
        "category": "saas",
    }

    with patch("main.extract_with_claude", return_value=mock_fields):
        pdf_bytes = base64.b64decode(MINIMAL_PDF_B64)
        r = client.post(
            "/extract-file",
            files={"file": ("test.pdf", pdf_bytes, "application/pdf")},
        )

    assert r.status_code == 200
    data = r.json()
    assert "fields" in data
    assert data["fields"]["confidence"] == 0.95
    assert data["fields"]["category"] == "saas"
    assert "model" in data
    assert "raw_text_length" in data
    assert "extraction_time_ms" in data


def test_extract_file_scanned_pdf_returns_422(client):
    """POST /extract-file returns 422 for a PDF with no extractable text."""
    empty_pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000068 00000 n \n0000000125 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n"
    r = client.post(
        "/extract-file",
        files={"file": ("empty.pdf", empty_pdf, "application/pdf")},
    )
    assert r.status_code == 422
    assert r.json()["error"] == "no_text_extracted"


def test_extract_endpoint_download_failure(client):
    """POST /extract returns 422 when file download fails."""
    import httpx

    with patch("main.ALLOWED_STORAGE_DOMAINS", ["invalid.example.com"]):
        with patch("main.httpx.AsyncClient") as mock_client_cls:
            mock_client = mock_client_cls.return_value.__aenter__.return_value
            mock_client.get.side_effect = httpx.ConnectError("connection refused")

            r = client.post(
                "/extract",
                json={"file_url": "https://invalid.example.com/file.pdf", "contract_id": "test-123"},
            )

    assert r.status_code == 422
    assert r.json()["error"] == "file_download_failed"


# ── analyse_with_claude ──────────────────────────────

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
    mock_client = _make_anthropic_text_mock(json.dumps(findings))
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        from main import analyse_with_claude
        result = analyse_with_claude("Sample contract text", req)
    assert isinstance(result, list)
    assert len(result) == 1
    assert result[0]["type"] == "warning"


def test_analyse_with_claude_uses_haiku_model():
    """analyse_with_claude uses ANALYSIS_MODEL (claude-haiku-4-5)."""
    req = _make_analyse_request()
    mock_client = _make_anthropic_text_mock(json.dumps([]))
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        from main import analyse_with_claude, ANALYSIS_MODEL
        analyse_with_claude("text", req)
        call_kwargs = mock_client.messages.create.call_args[1]
        assert call_kwargs["model"] == ANALYSIS_MODEL


def test_analyse_with_claude_raises_on_malformed_json():
    """analyse_with_claude raises ExtractionError when Claude returns non-JSON."""
    from main import ExtractionError

    mock_client = _make_anthropic_text_mock("This is not JSON at all")
    req = _make_analyse_request()
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        from main import analyse_with_claude
        with pytest.raises(ExtractionError) as exc_info:
            analyse_with_claude("text", req)
    assert exc_info.value.status_code == 503
    assert exc_info.value.error == "analysis_failed"


def test_analyse_with_claude_raises_on_non_list_json():
    """analyse_with_claude raises ExtractionError when Claude returns a JSON object, not an array."""
    from main import ExtractionError

    mock_client = _make_anthropic_text_mock(json.dumps({"type": "warning"}))
    req = _make_analyse_request()
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        from main import analyse_with_claude
        with pytest.raises(ExtractionError) as exc_info:
            analyse_with_claude("text", req)
    assert exc_info.value.error == "analysis_failed"


def test_analyse_with_claude_accepts_empty_findings():
    """analyse_with_claude returns [] when Claude finds nothing — valid result."""
    req = _make_analyse_request()
    mock_client = _make_anthropic_text_mock(json.dumps([]))
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        from main import analyse_with_claude
        result = analyse_with_claude("text", req)
    assert result == []


# ── /analyse endpoint ────────────────────────────────

def test_analyse_endpoint_happy_path(client):
    """POST /analyse returns findings when PDF download and analysis both succeed."""
    import httpx

    findings = [{"type": "positive", "category": "liability", "title": "Liability capped",
                 "explanation": "Standard cap.", "action": None, "severity": None}]

    mock_response = MagicMock()
    mock_response.content = MINIMAL_PDF
    mock_response.raise_for_status = lambda: None

    with patch("main.ALLOWED_STORAGE_DOMAINS", ["storage.example.com"]):
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
    import httpx

    with patch("main.ALLOWED_STORAGE_DOMAINS", ["storage.example.com"]):
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
    import httpx

    empty_pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000068 00000 n \n0000000125 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF\n"

    mock_response = MagicMock()
    mock_response.content = empty_pdf
    mock_response.raise_for_status = lambda: None

    with patch("main.ALLOWED_STORAGE_DOMAINS", ["storage.example.com"]):
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


# ── compare_with_claude ──────────────────────────────

def _make_comparison_mock(result: dict):
    """Build a mock Anthropic response returning comparison JSON."""
    import json
    mock_block = MagicMock()
    mock_block.type = "text"
    mock_block.text = json.dumps(result)
    mock_response = MagicMock()
    mock_response.content = [mock_block]
    return mock_response


def _make_compare_request(**kwargs):
    """Build a minimal CompareRequest for testing."""
    from main import CompareRequest
    defaults = {
        "current_text": "Current contract text here.",
        "previous_text": "Previous contract text here.",
        "current_fields": {
            "party_a": "Acme Corp",
            "party_b": "Buyer Ltd",
            "contract_value": "$2,400/yr",
            "expiry_date": "2027-12-31",
            "auto_renew": True,
            "notice_period_days": 30,
        },
        "previous_fields": {
            "party_a": "Acme Corp",
            "party_b": "Buyer Ltd",
            "contract_value": "$1,200/yr",
            "expiry_date": "2026-12-31",
            "auto_renew": False,
            "notice_period_days": 60,
        },
    }
    defaults.update(kwargs)
    return CompareRequest(**defaults)


def test_compare_with_claude_returns_dict():
    """compare_with_claude returns a dict with field_changes, clause_changes, summary."""
    from unittest.mock import patch
    result = {
        "field_changes": [
            {
                "field": "contract_value",
                "previous": "$1,200/yr",
                "current": "$2,400/yr",
                "change_type": "increase",
                "percentage": "+100%",
                "severity": "high",
            }
        ],
        "clause_changes": [
            {
                "category": "auto_renewal",
                "title": "Auto-renewal clause added",
                "previous_state": "No auto-renewal",
                "current_state": "Auto-renews annually",
                "severity": "high",
            }
        ],
        "summary": "Price doubled. Auto-renewal clause added. Notice period halved.",
    }
    req = _make_compare_request()
    with patch("main.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _make_comparison_mock(result)
        from main import compare_with_claude
        output = compare_with_claude(req)
    assert "field_changes" in output
    assert "clause_changes" in output
    assert "summary" in output
    assert len(output["field_changes"]) == 1
    assert output["field_changes"][0]["field"] == "contract_value"


def test_compare_with_claude_raises_on_malformed_json():
    """compare_with_claude raises ExtractionError on non-JSON response."""
    from main import ExtractionError
    mock_block = MagicMock()
    mock_block.type = "text"
    mock_block.text = "This is not JSON"
    mock_response = MagicMock()
    mock_response.content = [mock_block]

    req = _make_compare_request()
    with patch("main.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = mock_response
        from main import compare_with_claude
        with pytest.raises(ExtractionError) as exc_info:
            compare_with_claude(req)
    assert exc_info.value.status_code == 503
    assert exc_info.value.error == "comparison_failed"


# ── /compare endpoint ────────────────────────────────

def test_compare_endpoint_happy_path(client):
    """POST /compare returns field_changes, clause_changes, summary."""
    result = {
        "field_changes": [],
        "clause_changes": [],
        "summary": "No significant changes.",
    }
    with patch("main.compare_with_claude", return_value=result):
        r = client.post("/compare", json={
            "current_text": "New contract text.",
            "previous_text": "Old contract text.",
            "current_fields": {"contract_value": "$2,400/yr"},
            "previous_fields": {"contract_value": "$1,200/yr"},
        })
    assert r.status_code == 200
    body = r.json()
    assert "field_changes" in body
    assert "clause_changes" in body
    assert "summary" in body


def test_compare_endpoint_requires_auth(client):
    """POST /compare returns 401 without auth header."""
    from fastapi.testclient import TestClient
    from main import app
    unauthed = TestClient(app, headers={})
    r = unauthed.post("/compare", json={
        "current_text": "a",
        "previous_text": "b",
        "current_fields": {},
        "previous_fields": {},
    })
    assert r.status_code == 401
