"""PokeValue Scanner backend tests - all critical flows."""
import base64
import uuid
from pathlib import Path

import pytest
import requests


# ---------- Health ----------
def test_root_ok(base_url):
    r = requests.get(f"{base_url}/api/")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert body.get("service") == "pokevalue-scanner"


# ---------- Scan counter ----------
class TestScanCounter:
    user_id = f"TEST_user_{uuid.uuid4().hex[:8]}"

    def test_initial_count_is_zero(self, base_url):
        r = requests.get(f"{base_url}/api/scan/count/{self.user_id}")
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 0
        assert body["free_limit"] == 5
        assert body["is_pro"] is False
        assert body["user_id"] == self.user_id

    def test_increment_count(self, base_url):
        r1 = requests.post(f"{base_url}/api/scan/count/{self.user_id}")
        assert r1.status_code == 200
        assert r1.json()["count"] == 1
        r2 = requests.post(f"{base_url}/api/scan/count/{self.user_id}")
        assert r2.json()["count"] == 2
        # verify via GET
        r3 = requests.get(f"{base_url}/api/scan/count/{self.user_id}")
        assert r3.json()["count"] == 2

    def test_upgrade_sets_pro(self, base_url):
        r = requests.post(f"{base_url}/api/scan/upgrade/{self.user_id}")
        assert r.status_code == 200
        assert r.json()["is_pro"] is True
        # verify persistence
        r2 = requests.get(f"{base_url}/api/scan/count/{self.user_id}")
        assert r2.json()["is_pro"] is True


# ---------- Price lookup (live pokemontcg.io) ----------
def test_price_charizard_full_fields(base_url):
    """Charizard + set Base + #4 should return all new EUR price fields populated."""
    r = requests.get(
        f"{base_url}/api/price",
        params={"name": "Charizard", "set_name": "Base", "number": "4"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "charizard" in body["name"].lower()
    assert body["currency"] == "EUR"
    assert body["usd_to_eur_rate"] == 0.92
    # recommended_eur must be non-null and positive for such a popular card
    assert body.get("recommended_eur") is not None, f"recommended_eur missing: {body}"
    assert body["recommended_eur"] > 0
    # price_source must be populated
    assert body.get("price_source"), f"price_source missing: {body}"
    assert body["price_source"] in (
        "cardmarket_trend", "cardmarket_avg",
        "tcgplayer_holofoil", "tcgplayer_normal",
    ) or body["price_source"].startswith("tcgplayer_")
    # New fields must exist as keys (may be null if variant absent, but at least one should be set)
    for key in ("tcgplayer_holofoil_market", "tcgplayer_normal_market",
                "cardmarket_trend", "cardmarket_average"):
        assert key in body, f"missing key {key}"


def test_price_pikachu_cardmarket_priority(base_url):
    """Pikachu (no set/number) → cardmarket_trend should drive recommended_eur."""
    r = requests.get(f"{base_url}/api/price", params={"name": "Pikachu"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "pikachu" in body["name"].lower()
    assert body.get("recommended_eur") is not None
    # If cardmarket_trend has a value, that's exactly what recommended_eur must equal
    cm_trend = body.get("cardmarket_trend")
    if cm_trend:
        assert body["price_source"] == "cardmarket_trend"
        assert abs(body["recommended_eur"] - cm_trend) < 0.01


def test_price_unknown_returns_404(base_url):
    r = requests.get(
        f"{base_url}/api/price",
        params={"name": "ThisCardDoesNotExistZZZ12345"},
        timeout=30,
    )
    assert r.status_code == 404, f"Expected 404 got {r.status_code}: {r.text[:200]}"


# ---------- Portfolio CRUD ----------
class TestPortfolio:
    user_id = f"TEST_pf_{uuid.uuid4().hex[:8]}"
    card_id = None

    def test_save_card(self, base_url):
        payload = {
            "user_id": self.__class__.user_id,
            "name": "TEST_Charizard",
            "set_name": "Base",
            "number": "4/102",
            "image_url": "https://images.pokemontcg.io/base1/4_hires.png",
            "market_price": 350.0,
            "estimated_value": 280.0,
            "condition": {
                "centering": "near_mint",
                "corners": "near_mint",
                "edges": "near_mint",
                "surface": "near_mint",
                "whitening": False,
                "scratches": False,
            },
            "condition_grade": "Near Mint",
            "condition_multiplier": 0.8,
        }
        r = requests.post(f"{base_url}/api/portfolio/save", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "_id" not in body
        assert body["id"]
        assert body["name"] == "TEST_Charizard"
        TestPortfolio.card_id = body["id"]

    def test_get_portfolio_returns_saved_card(self, base_url):
        assert TestPortfolio.card_id, "save must run first"
        r = requests.get(f"{base_url}/api/portfolio/{self.__class__.user_id}")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        first = rows[0]
        assert "_id" not in first
        assert first["id"] == TestPortfolio.card_id
        assert first["name"] == "TEST_Charizard"

    def test_delete_card(self, base_url):
        assert TestPortfolio.card_id
        r = requests.delete(f"{base_url}/api/portfolio/{TestPortfolio.card_id}")
        assert r.status_code == 200
        assert r.json()["deleted"] == 1
        # verify gone
        r2 = requests.get(f"{base_url}/api/portfolio/{self.__class__.user_id}")
        ids = [c["id"] for c in r2.json()]
        assert TestPortfolio.card_id not in ids


# ---------- Vision (Gemini) ----------
def test_scan_analyze_real_card(base_url):
    img_path = Path("/tmp/card_small.jpg")
    if not img_path.exists():
        pytest.skip("test card image not available")
    b64 = base64.b64encode(img_path.read_bytes()).decode("ascii")
    r = requests.post(
        f"{base_url}/api/scan/analyze",
        json={"image_base64": b64, "user_id": "TEST_vision"},
        timeout=60,
    )
    assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
    body = r.json()
    assert "name" in body and body["name"], f"Empty name: {body}"
    # this is a Charizard image, name should contain it
    assert "charizard" in body["name"].lower(), f"Unexpected name: {body['name']}"
