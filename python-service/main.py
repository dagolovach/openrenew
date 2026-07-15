"""OpenRenew PDF Extraction Service"""
import asyncio
import re, os, io, time, json, hmac, ipaddress, pathlib
from typing import Literal, Optional
from urllib.parse import urlparse
import pdfplumber
import anthropic
import httpx
from fastapi import FastAPI, UploadFile, File, Request, Header, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

# ── Auth ─────────────────────────────────────────────

EXTRACTION_SERVICE_SECRET = os.getenv("EXTRACTION_SERVICE_SECRET")

ALLOWED_STORAGE_DOMAINS = [
    d for d in [os.getenv("SUPABASE_STORAGE_DOMAIN", "")] if d
]

def validate_file_url(url: str) -> None:
    """Reject internal IPs, localhost, and non-allowlisted domains."""
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid URL")

    # Must be HTTPS
    if parsed.scheme != "https":
        raise HTTPException(status_code=422, detail="URL must use HTTPS")

    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(status_code=422, detail="Invalid URL hostname")

    # Reject localhost and loopback
    if hostname in ("localhost", "127.0.0.1", "::1"):
        raise HTTPException(status_code=422, detail="Internal URLs not allowed")

    # Reject private IP ranges
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(status_code=422, detail="Private IP ranges not allowed")
    except ValueError:
        pass  # Not an IP address, continue to domain check

    # Allowlist is required — fail closed if SUPABASE_STORAGE_DOMAIN env var is not set
    if not ALLOWED_STORAGE_DOMAINS:
        raise HTTPException(status_code=500, detail="Storage domain allowlist not configured")
    if not any(hostname == d or hostname.endswith(f'.{d}') for d in ALLOWED_STORAGE_DOMAINS):
        raise HTTPException(status_code=422, detail="URL domain not allowed")

DATA_DIR = pathlib.Path(os.getenv("DATA_DIR", "/data/contracts")).resolve()

def validate_file_path(rel_path: str) -> pathlib.Path:
    """Resolve a relative contract path inside DATA_DIR; reject traversal/absolute paths."""
    if not rel_path or rel_path.startswith(("/", "\\")):
        raise HTTPException(status_code=422, detail="file_path must be relative")
    abs_path = (DATA_DIR / rel_path).resolve()
    if not str(abs_path).startswith(str(DATA_DIR) + os.sep):
        raise HTTPException(status_code=422, detail="file_path escapes data directory")
    return abs_path

async def load_pdf_bytes(file_url: Optional[str], file_path: Optional[str]) -> bytes:
    """Load PDF from a local path (preferred, self-hosted) or an allowlisted URL."""
    if file_path:
        abs_path = validate_file_path(file_path)
        try:
            return await asyncio.to_thread(abs_path.read_bytes)
        except FileNotFoundError:
            raise ExtractionError(422, "file_not_found", file_path)
    if not file_url:
        raise ExtractionError(422, "missing_input", "file_url or file_path is required")
    validate_file_url(file_url)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(file_url)
            r.raise_for_status()
            return r.content
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(422, "file_download_failed", str(e))

def verify_auth(authorization: Optional[str] = Header(None)):
    if not EXTRACTION_SERVICE_SECRET:
        raise HTTPException(status_code=500, detail="Service secret not configured")
    expected = f"Bearer {EXTRACTION_SERVICE_SECRET}"
    if not authorization or not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")

# ── Response models ───────────────────────────────────
# (No Pydantic response models needed in v1 — FastAPI serializes dicts directly)

# ── Custom exceptions ────────────────────────────────

class ExtractionError(Exception):
    def __init__(self, status_code: int, error: str, detail: Optional[str] = None):
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

# ── Party detection (AI, first paragraph only) ───────────────────

# Legal suffixes to strip or match (used by anonymize_text)
LEGAL_SUFFIXES = r'(?:\s*,?\s*(?:Inc\.?|LLC|Corp\.?|Corporation|Ltd\.?|Limited|L\.?P\.?|LLP|PLC|GmbH|S\.?A\.?|Co\.?|AG|N\.?V\.?))?'

def detect_parties(text: str) -> dict:
    """Detect Party A and Party B from contract opening using Claude AI.

    Sends only the first 1500 chars to Claude Haiku — party names are always
    in the preamble. User confirms the result before any anonymization occurs.

    Returns {"party_a": str|None, "party_b": str|None, "confidence": float}
    """
    if not text or not text.strip():
        return {"party_a": None, "party_b": None, "confidence": 0.0}

    snippet = text[:1500].strip()

    client = anthropic.Anthropic()
    try:
        response = client.messages.create(
            model=ANALYSIS_MODEL,
            max_tokens=256,
            messages=[{
                "role": "user",
                "content": (
                    "From the contract opening below, identify the two contracting parties.\n"
                    "Party A is typically the vendor, provider, or licensor.\n"
                    "Party B is typically the customer, client, or licensee.\n\n"
                    "Return ONLY a JSON object:\n"
                    '{"party_a": "full legal name or null", "party_b": "full legal name or null", '
                    '"confidence": 0.0}\n\n'
                    "Include legal suffixes in the name (e.g. \"Amazon Web Services, Inc.\").\n"
                    "Set confidence to 0.9 if clearly identified, 0.7 if somewhat ambiguous, "
                    "lower if uncertain. Set a party to null if not found.\n\n"
                    f"Contract opening:\n\"\"\"\n{snippet}\n\"\"\""
                ),
            }],
        )
        content = response.content[0].text.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
            content = content.rsplit("```", 1)[0].strip()
        result = json.loads(content)
        party_a = (result.get("party_a") or "").strip()[:150] or None
        party_b = (result.get("party_b") or "").strip()[:150] or None
        confidence = float(result.get("confidence", 0.0))
        return {"party_a": party_a, "party_b": party_b, "confidence": confidence}
    except Exception as e:
        print(f"[detect-parties] Claude call failed: {e}", flush=True)
        return {"party_a": None, "party_b": None, "confidence": 0.0}


def anonymize_text(text: str, party_a: Optional[str], party_b: Optional[str]) -> str:
    """Replace company names with Party A / Party B before sending to Claude.

    Handles case-insensitive matching and common legal suffix variations.
    Also strips parenthetical abbreviations like ("AWS") that follow a party name.
    Processes Party A first (longest match wins).
    """
    if not text:
        return text

    for raw_name, replacement in [(party_a, "Party A"), (party_b, "Party B")]:
        if not raw_name or not raw_name.strip():
            continue
        name = raw_name.strip()
        # Strip legal suffix from provided name to get base
        base = re.sub(LEGAL_SUFFIXES + r'$', '', name, flags=re.IGNORECASE).strip()
        if len(base) < 2:
            continue  # Safety: don't replace 1-char strings

        # Replace full name first, then base name
        for variant in [re.escape(name), re.escape(base)]:
            pattern = r'\b' + variant + LEGAL_SUFFIXES + r'(?=\s|[^A-Za-z0-9]|$)'
            text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

        # Strip parenthetical abbreviations defined alongside this party.
        # e.g. 'Party A, a Delaware corporation ("AWS")' — find and replace "AWS" everywhere.
        abbrev_match = re.search(
            re.escape(replacement) + r'[^(\n]{0,60}\("([A-Z][A-Z0-9]{1,9})"\)',
            text,
        )
        if abbrev_match:
            abbrev = abbrev_match.group(1)
            text = re.sub(r'\b' + re.escape(abbrev) + r'\b', replacement, text)

    return text


# ── AI API call ──────────────────────────────────────

AI_MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-6")

PDF_PARSE_TIMEOUT = int(os.getenv("PDF_PARSE_TIMEOUT", "30"))
CLAUDE_TIMEOUT    = int(os.getenv("CLAUDE_TIMEOUT", "55"))   # under Railway's ~60s limit

EXTRACTION_TOOL = {
    "name": "extract_contract_fields",
    "description": (
        "Extract key dates and terms from contract text. "
        "Use null for fields not clearly present. "
        "Set auto_renew=true only if explicit language like 'shall automatically renew' or 'evergreen' is present. "
        "Classify the contract category as one of: saas (software/SaaS subscriptions), vendor (supplier/service agreements), "
        "lease (office/equipment leases), employment (employment/contractor agreements), other (anything else)."
    ),
    "input_schema": {
        "type": "object",
        "required": [
            "effective_date", "expiry_date", "renewal_date", "auto_renew",
            "notice_period_days", "notice_period_text", "contract_value",
            "confidence", "category"
        ],
        "properties": {
            "effective_date":     {"type": ["string", "null"], "description": "Contract start/effective date in ISO 8601, or null"},
            "expiry_date":        {"type": ["string", "null"], "description": "Contract expiry/end date in ISO 8601, or null"},
            "renewal_date":       {"type": ["string", "null"], "description": "Auto-renewal date if different from expiry, ISO 8601, or null"},
            "auto_renew":         {"type": "boolean",          "description": "True only if explicit auto-renewal language present"},
            "notice_period_days": {"type": ["integer", "null"],"description": "Notice period in days, or null"},
            "notice_period_text": {"type": ["string", "null"], "description": "Exact notice period text from contract, or null"},
            "contract_value":     {"type": ["string", "null"], "description": "Contract value exactly as written, or null"},
            "annual_value": {
                "type": ["number", "null"],
                "description": (
                    "The total annual value or cost of this contract in the base currency. "
                    "If the contract shows a monthly rate, multiply by 12. "
                    "Return null if no monetary value is found."
                ),
            },
            "confidence":         {"type": "number", "minimum": 0.0, "maximum": 1.0, "description": "Overall extraction confidence 0.0-1.0"},
            "category":           {
                "type": "string",
                "enum": ["saas", "vendor", "lease", "employment", "other"],
                "description": (
                    "Contract category. saas=software subscriptions, "
                    "vendor=supplier/service agreements, "
                    "lease=office or equipment leases, "
                    "employment=employment or contractor agreements, "
                    "other=anything else."
                )
            },
        }
    }
}

def extract_with_claude(text: str) -> dict:
    system_prompt = """Extract contract fields with high accuracy. Use null for fields not clearly present.

Extraction rules:
- effective_date: contract start/effective date in ISO 8601, or null
- expiry_date: contract expiry/end date in ISO 8601, or null
- renewal_date: auto-renewal date if different from expiry in ISO 8601, or null
- auto_renew: true only if explicit auto-renewal language like 'shall automatically renew' or 'evergreen' is present
- notice_period_days: notice period in days as integer, or null
- notice_period_text: exact notice period text from contract, or null
- contract_value: contract value exactly as written, or null
- confidence: overall extraction confidence between 0.0 and 1.0
- Classify the contract as: saas, vendor, lease, employment, or other."""

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=AI_MODEL,
        max_tokens=1024,
        tools=[EXTRACTION_TOOL],
        tool_choice={"type": "tool", "name": "extract_contract_fields"},
        system=system_prompt,
        messages=[{"role": "user", "content": f"Extract the key contract terms from this contract text:\n\n{text}"}]
    )
    try:
        tool_block = next(b for b in response.content if b.type == "tool_use")
        return tool_block.input
    except (StopIteration, AttributeError) as e:
        raise ExtractionError(
            status_code=503,
            error="claude_api_error",
            detail=f"AI did not return expected tool call: {e}"
        )

# ── Analysis (risk finding) ──────────────────────────

ANALYSIS_MODEL = os.getenv("ANALYSIS_MODEL", "claude-haiku-4-5-20251001")

ANALYSIS_SYSTEM_PROMPT = """You are a contract renewal advisor helping ops and finance teams at \
10–100 person companies. Your job is to answer one question:

"What do I need to know before this contract renews?"

You are NOT a lawyer. You are NOT reviewing for legal risk. You are \
surfacing practical, money-and-time observations that a non-lawyer \
ops or finance manager needs before a renewal conversation.

Severity means: how much will ignoring this cost?
- high   → could lock the company in or cost thousands if missed
- medium → worth addressing in the renewal conversation
- low    → good to know, low urgency

Rules:
- Prioritise timing, money, and exit flexibility above all else
- Be specific — reference the actual clause or term
- Explanations: 1–2 plain English sentences, no legal jargon
- Actions: concrete, one sentence, written to a non-lawyer
- governing_law findings: omit entirely — not actionable for this audience
- Standard acceptable clauses: flag as type "positive", severity null
- Do not hallucinate clauses that are not in the contract text
- Maximum 8 findings — ruthlessly prioritise by money/timing impact
- Output ONLY a valid JSON array, no markdown, no preamble

The contract text has been anonymized: company names are replaced with "Party A" (the customer/buyer) and "Party B" (the vendor/provider). Refer to parties using these labels in your analysis. Do not attempt to identify the real company names."""


class AnalyseRequest(BaseModel):
    file_url: Optional[str] = None
    file_path: Optional[str] = None
    contract_id: Optional[str] = None
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    category: Optional[str] = None
    auto_renew: Optional[bool] = None
    notice_period_days: Optional[int] = None
    contract_value: Optional[str] = None
    expiry_date: Optional[str] = None


class FindingItem(BaseModel):
    category: Literal[
        "auto_renewal", "notice_period", "liability", "payment_terms",
        "termination", "ip_ownership", "data_privacy", "price_escalation",
        "exclusivity", "governing_law", "other"
    ]
    title: str
    explanation: str
    action: Optional[str] = None


class DraftEmailRequest(BaseModel):
    contract_name: str
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    expiry_date: Optional[str] = None
    renewal_date: Optional[str] = None
    notice_period_days: Optional[int] = None
    contract_value: Optional[str] = None
    category: Optional[str] = None
    notice_window_closed: bool = False
    findings: list[FindingItem] = Field(min_length=1)


def analyse_with_claude(text: str, req: AnalyseRequest) -> list:
    user_message = f"""You are reviewing this contract ahead of its renewal. \
Flag only what matters for the renewal decision.

Contract details:
- Vendor (Party A): Party A
- Customer (Party B): Party B
- Category: {req.category or 'Unknown'}
- Auto-renews: {req.auto_renew}
- Notice period: {req.notice_period_days} days
- Contract value: {req.contract_value or 'Not stated'}
- Expiry: {req.expiry_date or 'Unknown'}

Answer these questions from the contract text, in this priority order:
1. Will this auto-renew if we do nothing? When is the point of no return?
2. Can the vendor raise prices at renewal — by how much?
3. How hard is it to exit if we want out?
4. Are there any payment terms that affect cash flow?
5. Are there any caps on our liability or the vendor's?
6. Is there anything else with direct financial or timing consequences?

Full contract text:
\"\"\"
{text}
\"\"\"

Return a JSON array. Each item:
{{
  "type": "warning" | "positive" | "info",
  "category": "auto_renewal" | "notice_period" | "price_escalation" | \
"termination" | "payment_terms" | "liability" | \
"data_privacy" | "ip_ownership" | "exclusivity" | "other",
  "title": "max 8 words",
  "explanation": "what this means for the renewal decision",
  "action": "what to do or ask the vendor — null for positives",
  "severity": "high" | "medium" | "low" | null
}}

Output ONLY the JSON array."""

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=ANALYSIS_MODEL,
        max_tokens=2048,
        system=ANALYSIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    try:
        content = response.content[0].text
        # Strip markdown code fences if the model wraps the JSON despite instructions
        stripped = content.strip()
        if stripped.startswith("```"):
            stripped = stripped.split("\n", 1)[-1]
            stripped = stripped.rsplit("```", 1)[0].strip()
        findings = json.loads(stripped)
        if not isinstance(findings, list):
            raise ValueError("Expected a JSON array")
        return findings
    except (AttributeError, IndexError, TypeError, json.JSONDecodeError, ValueError) as e:
        raise ExtractionError(
            status_code=503,
            error="analysis_failed",
            detail=f"Claude did not return a valid JSON array: {e}",
        )


_EXIT_CATEGORIES = {"termination", "auto_renewal"}
_TERMS_CATEGORIES = {"price_escalation", "payment_terms", "notice_period"}


def draft_with_claude(req: DraftEmailRequest) -> dict:
    """Generate a professional email draft covering all vendor-actionable findings."""
    categories = {f.category for f in req.findings}

    # Tone inference: all exit → cancellation; all terms → renegotiation; mix → evaluating
    is_all_exit = categories.issubset(_EXIT_CATEGORIES)
    is_all_terms = categories.issubset(_TERMS_CATEGORIES)

    if is_all_exit:
        objective = (
            "clearly communicate that the customer does not intend to renew or continue "
            "this contract, and request written confirmation of cancellation"
        )
    elif is_all_terms:
        objective = (
            "open a professional dialogue to renegotiate the terms highlighted below "
            "before the contract renews"
        )
    else:
        objective = (
            "communicate that the customer is evaluating whether to continue and needs "
            "to discuss the following issues before making a decision"
        )

    notice_modifier = ""
    if req.notice_window_closed:
        notice_modifier = (
            "\nIMPORTANT: The formal notice window has already passed. "
            "The email should acknowledge this and focus on discussing options and "
            "next steps rather than meeting a deadline."
        )

    findings_text = "\n".join(
        f"- {f.title}: {f.explanation}"
        + (f" (Recommended action: {f.action})" if f.action else "")
        for f in req.findings
    )

    relevant_date = req.renewal_date or req.expiry_date

    prompt = f"""You are helping a customer draft a professional email to their vendor/provider.

Contract details:
- Contract name: {req.contract_name}
- Vendor / Party A: {req.party_a or 'the vendor'}
- Customer / Party B: {req.party_b or 'the customer'}
- Category: {req.category or 'service contract'}
- Contract value: {req.contract_value or 'not stated'}
- Key date: {relevant_date or 'not specified'}
- Notice period: {f"{req.notice_period_days} days" if req.notice_period_days else "not stated"}
{notice_modifier}
Issues identified in this contract:
{findings_text}

Write a professional email from the customer to the vendor that:
- Objective: {objective}
- Addresses all the issues listed above
- Mentions relevant dates where applicable
- Is firm but professional in tone
- Is 3-5 paragraphs, no bullet points
- Does NOT pretend to be legal advice

Return ONLY a JSON object with two fields:
- "subject": the email subject line
- "body": the full email body text (plain text, use \\n for newlines)

Output ONLY the JSON object. No other text."""

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=ANALYSIS_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        content = response.content[0].text.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
            content = content.rsplit("```", 1)[0].strip()
        result = json.loads(content)
        if not isinstance(result, dict) or "subject" not in result or "body" not in result:
            raise ValueError("Missing subject or body fields")
        return {
            "subject": str(result["subject"]),
            "body": str(result["body"]),
            "disclaimer": "For informational purposes only. Not legal advice.",
        }
    except (AttributeError, IndexError, TypeError, json.JSONDecodeError, ValueError) as e:
        raise ExtractionError(
            status_code=503,
            error="draft_failed",
            detail=f"Claude did not return valid JSON: {e}",
        )


# ── FastAPI app ──────────────────────────────────────

app = FastAPI(title="OpenRenew PDF Extraction Service")

from fastapi.exceptions import RequestValidationError

@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    print(f"[ValidationError] body={await request.body()} errors={exc.errors()}", flush=True)
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

@app.exception_handler(ExtractionError)
async def extraction_error_handler(request: Request, exc: ExtractionError):
    content = {"error": exc.error}
    if exc.detail:
        content["detail"] = exc.detail
    print(f"[ExtractionError] {exc.status_code} error={exc.error} detail={exc.detail}", flush=True)
    return JSONResponse(status_code=exc.status_code, content=content)

@app.get("/health")
def health():
    return {"status": "ok"}

async def _run_extraction(pdf_bytes: bytes, contract_id: Optional[str], party_a: Optional[str] = None, party_b: Optional[str] = None) -> dict:
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
    except Exception as e:
        print(f"[pdfplumber] extraction failed: {e}", flush=True)
        text = ""

    if not text.strip():
        raise ExtractionError(422, "no_text_extracted")
    text = truncate_text(text)
    text = anonymize_text(text, party_a, party_b)

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

class DetectPartiesRequest(BaseModel):
    file_url: Optional[str] = None
    file_path: Optional[str] = None


class ExtractRequest(BaseModel):
    file_url: Optional[str] = None
    file_path: Optional[str] = None
    contract_id: Optional[str] = None
    party_a: Optional[str] = None
    party_b: Optional[str] = None


@app.post("/extract")
async def extract(req: ExtractRequest, _: None = Depends(verify_auth)):
    print(f"[extract] file_url={(req.file_url or '')[:80]}... file_path={req.file_path} contract_id={req.contract_id}", flush=True)
    pdf_bytes = await load_pdf_bytes(req.file_url, req.file_path)
    print(f"[extract] downloaded {len(pdf_bytes)} bytes", flush=True)
    return await _run_extraction(pdf_bytes, req.contract_id, req.party_a, req.party_b)


@app.post("/extract-file")
async def extract_file(file: UploadFile = File(...), contract_id: Optional[str] = None, _: None = Depends(verify_auth)):
    if os.getenv("RAILWAY_ENVIRONMENT") == "production":
        raise HTTPException(status_code=404, detail="Not found")
    return await _run_extraction(await file.read(), contract_id)


@app.post("/detect-parties")
async def detect_parties_endpoint(req: DetectPartiesRequest, _: None = Depends(verify_auth)):
    pdf_bytes = await load_pdf_bytes(req.file_url, req.file_path)

    try:
        text = await asyncio.wait_for(
            asyncio.to_thread(extract_text_from_bytes, pdf_bytes),
            timeout=PDF_PARSE_TIMEOUT,
        )
    except Exception as e:
        print(f"[detect-parties] text extraction failed: {e}", flush=True)
        text = ""

    if not text.strip():
        return {"party_a": None, "party_b": None, "confidence": 0.0}

    result = detect_parties(text)
    return result


async def _run_analyse(pdf_bytes: bytes, req: AnalyseRequest) -> dict:
    """Core analyse logic — extracted for testability."""
    # PDF parse — 422 on timeout
    try:
        text = await asyncio.wait_for(
            asyncio.to_thread(extract_text_from_bytes, pdf_bytes),
            timeout=PDF_PARSE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise ExtractionError(
            422, "pdf_parse_timeout",
            f"PDF parse exceeded {PDF_PARSE_TIMEOUT}s",
        )
    except Exception as e:
        print(f"[pdfplumber] extraction failed: {e}", flush=True)
        text = ""

    if not text.strip():
        raise ExtractionError(422, "no_text_extracted")
    text = truncate_text(text)
    text = anonymize_text(text, req.party_a, req.party_b)

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


@app.post("/analyse")
async def analyse(req: AnalyseRequest, _: None = Depends(verify_auth)):
    pdf_bytes = await load_pdf_bytes(req.file_url, req.file_path)
    return await _run_analyse(pdf_bytes, req)


COMPARISON_SYSTEM_PROMPT = """You are a contract comparison assistant helping ops and finance teams understand what changed between two versions of a vendor contract.

Your job is to identify every meaningful change — especially changes that affect price, timing, exit flexibility, liability, or obligations.

You are NOT providing legal advice. You are surfacing business-level changes that a non-lawyer ops or finance person would find actionable.

Rules:
- Compare the two contract texts thoroughly
- Highlight ALL changes to price, notice period, auto-renewal, termination, liability, and payment terms
- For price changes, calculate the percentage change
- Note removed protections (e.g. termination for convenience removed) as high severity
- Note added restrictions (e.g. new exclusivity clause) as high severity
- Standard unchanged clauses do not need to be mentioned
- If a field value changed, include it in field_changes with the exact old and new values
- Keep explanations under 2 sentences
- Maximum 10 clause_changes — prioritise by impact
- Output ONLY valid JSON, no markdown wrapper"""


class CompareRequest(BaseModel):
    current_text: str = ""
    previous_text: str = ""
    current_file_url: Optional[str] = None    # Signed URL — Python fetches + extracts text
    previous_file_url: Optional[str] = None   # Signed URL
    current_file_path: Optional[str] = None   # Relative path on the shared data volume
    previous_file_path: Optional[str] = None  # Relative path on the shared data volume
    current_fields: dict = {}
    previous_fields: dict = {}


def compare_with_claude(req: CompareRequest) -> dict:
    """Compare two contract versions using Claude and return structured diff."""
    # Build a field diff section for changed fields
    all_keys = set(req.current_fields.keys()) | set(req.previous_fields.keys())
    changed_fields = []
    for key in sorted(all_keys):
        prev_val = req.previous_fields.get(key)
        curr_val = req.current_fields.get(key)
        if prev_val != curr_val:
            changed_fields.append(f"  {key}: {prev_val!r} → {curr_val!r}")

    field_diff_section = ""
    if changed_fields:
        field_diff_section = (
            "\n\nKnown field-level changes (from structured extraction):\n"
            + "\n".join(changed_fields)
        )

    user_message = f"""Compare these two versions of a contract and identify all meaningful changes.

PREVIOUS CONTRACT VERSION:
\"\"\"
{req.previous_text}
\"\"\"

CURRENT CONTRACT VERSION:
\"\"\"
{req.current_text}
\"\"\"{field_diff_section}

Return a JSON object with exactly these keys:
{{
  "field_changes": [
    {{
      "field": "field name",
      "previous": "old value",
      "current": "new value",
      "change_type": "increase" | "decrease" | "added" | "removed" | "modified",
      "percentage": "+X%" or null,
      "severity": "high" | "medium" | "low"
    }}
  ],
  "clause_changes": [
    {{
      "category": "auto_renewal" | "notice_period" | "liability" | "payment_terms" | "termination" | "price_escalation" | "exclusivity" | "other",
      "title": "max 8 words",
      "previous_state": "what it said before",
      "current_state": "what it says now",
      "severity": "high" | "medium" | "low"
    }}
  ],
  "summary": "2-3 sentence plain English summary of the most important changes"
}}

Output ONLY the JSON object."""

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=ANALYSIS_MODEL,
        max_tokens=2048,
        system=COMPARISON_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    try:
        content = response.content[0].text.strip()
        # Strip markdown code fences if model wraps despite instructions
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
            content = content.rsplit("```", 1)[0].strip()
        result = json.loads(content)
        if not isinstance(result, dict):
            raise ValueError("Expected a JSON object")
        # Ensure required keys exist with defaults
        result.setdefault("field_changes", [])
        result.setdefault("clause_changes", [])
        result.setdefault("summary", "")
        return result
    except (AttributeError, IndexError, TypeError, json.JSONDecodeError, ValueError) as e:
        raise ExtractionError(
            status_code=503,
            error="comparison_failed",
            detail=f"Claude did not return valid comparison JSON: {e}",
        )


@app.post("/compare")
async def compare(req: CompareRequest, _: None = Depends(verify_auth)):
    print(f"[compare] current_url={req.current_file_url} current_path={req.current_file_path} "
          f"previous_url={req.previous_file_url} previous_path={req.previous_file_path}", flush=True)

    if not req.current_text and not req.current_file_url and not req.current_file_path:
        raise ExtractionError(422, "missing_input", "current_text, current_file_url, or current_file_path is required")
    if not req.previous_text and not req.previous_file_url and not req.previous_file_path:
        raise ExtractionError(422, "missing_input", "previous_text, previous_file_url, or previous_file_path is required")

    # Fetch and extract text from URL/path if text not provided directly
    if (req.current_file_url or req.current_file_path) and not req.current_text:
        pdf_bytes = await load_pdf_bytes(req.current_file_url, req.current_file_path)
        try:
            text = await asyncio.wait_for(
                asyncio.to_thread(extract_text_from_bytes, pdf_bytes),
                timeout=PDF_PARSE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise ExtractionError(422, "pdf_parse_timeout", f"PDF parse exceeded {PDF_PARSE_TIMEOUT}s")
        if not text.strip():
            raise ExtractionError(422, "no_text_extracted", "No extractable text found in PDF")
        req = req.model_copy(update={"current_text": truncate_text(text)})

    if (req.previous_file_url or req.previous_file_path) and not req.previous_text:
        pdf_bytes = await load_pdf_bytes(req.previous_file_url, req.previous_file_path)
        try:
            text = await asyncio.wait_for(
                asyncio.to_thread(extract_text_from_bytes, pdf_bytes),
                timeout=PDF_PARSE_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise ExtractionError(422, "pdf_parse_timeout", f"PDF parse exceeded {PDF_PARSE_TIMEOUT}s")
        if not text.strip():
            raise ExtractionError(422, "no_text_extracted", "No extractable text found in PDF")
        req = req.model_copy(update={"previous_text": truncate_text(text)})

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(compare_with_claude, req),
            timeout=CLAUDE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise ExtractionError(504, "claude_timeout", f"Claude API exceeded {CLAUDE_TIMEOUT}s")
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(503, "comparison_failed", str(e))

    # Drop spurious field changes where old and new values are identical
    field_changes = [
        fc for fc in result["field_changes"]
        if str(fc.get("previous", "")).strip() != str(fc.get("current", "")).strip()
    ]

    return {
        "field_changes": field_changes,
        "clause_changes": result["clause_changes"],
        "summary": result["summary"],
        "model": ANALYSIS_MODEL,
    }


@app.post("/draft-action-email")
async def draft_action_email(req: DraftEmailRequest, _: None = Depends(verify_auth)):
    print(f"[draft-action-email] findings={len(req.findings)} contract={req.contract_name[:40]}", flush=True)
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(draft_with_claude, req),
            timeout=CLAUDE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise ExtractionError(504, "claude_timeout", f"Claude API exceeded {CLAUDE_TIMEOUT}s")
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(503, "draft_failed", str(e))
    return result
