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
