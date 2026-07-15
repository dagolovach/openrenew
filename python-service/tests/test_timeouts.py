"""Tests for timeout behaviour in main.py extraction path."""
import asyncio
import os
import sys
import pytest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def test_pdf_parse_timeout_defaults_to_30():
    import main as m
    assert m.PDF_PARSE_TIMEOUT == 30


def test_claude_timeout_defaults_to_55():
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


@pytest.mark.asyncio
async def test_claude_extraction_timeout_raises_504():
    """Slow Claude extraction call raises ExtractionError with status_code=504."""
    import main as m

    call_count = {"n": 0}

    async def dispatch(fn, *args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return "some contract text long enough to pass the strip check"
        await asyncio.sleep(999)

    with patch("main.PDF_PARSE_TIMEOUT", 30), \
         patch("main.CLAUDE_TIMEOUT", 0.01), \
         patch("asyncio.to_thread", side_effect=dispatch):
        with pytest.raises(m.ExtractionError) as exc_info:
            await m._run_extraction(b"fake", "test-id")

    assert exc_info.value.status_code == 504
    assert exc_info.value.error == "claude_timeout"


@pytest.mark.asyncio
async def test_analyse_pdf_timeout_raises_422():
    """Slow pdfplumber in _run_analyse raises ExtractionError with status_code=422."""
    import main as m

    async def slow_thread(fn, *args, **kwargs):
        await asyncio.sleep(999)

    req = m.AnalyseRequest(file_url="https://example.supabase.co/fake.pdf")

    with patch("main.PDF_PARSE_TIMEOUT", 0.01), \
         patch("asyncio.to_thread", side_effect=slow_thread):
        with pytest.raises(m.ExtractionError) as exc_info:
            await m._run_analyse(b"fake", req)

    assert exc_info.value.status_code == 422
    assert exc_info.value.error == "pdf_parse_timeout"


@pytest.mark.asyncio
async def test_analyse_claude_timeout_raises_504():
    """Slow Claude call in _run_analyse raises ExtractionError with status_code=504."""
    import main as m

    call_count = {"n": 0}

    async def dispatch(fn, *args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return "some analysable contract text long enough to pass the strip check"
        await asyncio.sleep(999)

    req = m.AnalyseRequest(file_url="https://example.supabase.co/fake.pdf")

    with patch("main.PDF_PARSE_TIMEOUT", 30), \
         patch("main.CLAUDE_TIMEOUT", 0.01), \
         patch("asyncio.to_thread", side_effect=dispatch):
        with pytest.raises(m.ExtractionError) as exc_info:
            await m._run_analyse(b"fake", req)

    assert exc_info.value.status_code == 504
    assert exc_info.value.error == "claude_timeout"
