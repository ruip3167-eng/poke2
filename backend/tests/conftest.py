import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://card-scanner-pro-8.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api(base_url):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    s.base = base_url
    return s
