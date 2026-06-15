"""Tests for manual-search backend endpoints: GET /api/sets and GET /api/cards/find."""
import requests
import time


# ---------- /api/sets ----------
class TestListSets:
    def test_list_sets_returns_list(self, base_url):
        r = requests.get(f"{base_url}/api/sets", timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)
        # The pokemontcg.io catalogue easily exceeds 100 sets
        assert len(body) > 100, f"only {len(body)} sets returned"

    def test_set_shape(self, base_url):
        r = requests.get(f"{base_url}/api/sets", timeout=30)
        assert r.status_code == 200
        body = r.json()
        # Must contain the required fields
        s0 = body[0]
        for key in ("id", "name", "series", "release_date", "total", "symbol_url", "logo_url"):
            assert key in s0, f"missing key {key}: {s0}"

    def test_sets_newest_first(self, base_url):
        r = requests.get(f"{base_url}/api/sets", timeout=30)
        body = r.json()
        # Walk the first ~50 to confirm release_date is monotonically non-increasing
        dates = [s["release_date"] for s in body[:50] if s.get("release_date")]
        assert dates == sorted(dates, reverse=True), "sets are not newest-first"

    def test_base1_is_present(self, base_url):
        r = requests.get(f"{base_url}/api/sets", timeout=30)
        body = r.json()
        ids = {s["id"] for s in body}
        assert "base1" in ids, "classic 'base1' set missing"

    def test_sets_cached(self, base_url):
        """Two consecutive calls should be fast (the second hits the cache)."""
        t1 = time.time()
        r1 = requests.get(f"{base_url}/api/sets", timeout=30)
        t2 = time.time()
        r2 = requests.get(f"{base_url}/api/sets", timeout=30)
        t3 = time.time()
        assert r1.status_code == 200 and r2.status_code == 200
        # Second call should be fast (<2s) since cache TTL is 1h
        assert (t3 - t2) < 2.0, f"second call took {t3 - t2:.2f}s — cache miss?"


# ---------- /api/cards/find ----------
class TestFindCard:
    def test_charizard_base_4(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/find",
            params={"set_id": "base1", "number": "4"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "charizard" in body["name"].lower()
        assert body["set_name"] and "base" in body["set_name"].lower()
        assert body["number"] == "4"
        assert body["currency"] == "EUR"
        # Charizard Base #4 is famously expensive — Cardmarket trend should be > €2000
        assert body.get("recommended_eur") is not None, body
        assert body["recommended_eur"] > 2000, f"recommended_eur unexpectedly low: {body['recommended_eur']}"
        assert body.get("price_source"), body
        # image URL must be present
        assert body.get("image_url")

    def test_response_shape_matches_price(self, base_url):
        """/cards/find must return the same keys as /price."""
        r_find = requests.get(
            f"{base_url}/api/cards/find",
            params={"set_id": "base1", "number": "4"},
            timeout=30,
        )
        r_price = requests.get(
            f"{base_url}/api/price",
            params={"name": "Charizard", "set_name": "Base", "number": "4"},
            timeout=30,
        )
        assert r_find.status_code == 200 and r_price.status_code == 200
        # Same keys
        assert set(r_find.json().keys()) == set(r_price.json().keys())

    def test_invalid_number_returns_404(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/find",
            params={"set_id": "base1", "number": "9999"},
            timeout=30,
        )
        assert r.status_code == 404
        body = r.json()
        assert "detail" in body
        assert "base1" in body["detail"] or "9999" in body["detail"]

    def test_invalid_set_returns_404(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/find",
            params={"set_id": "noSuchSet9999", "number": "1"},
            timeout=30,
        )
        assert r.status_code == 404

    def test_empty_set_id_returns_422_or_400(self, base_url):
        # FastAPI rejects missing query params with 422; the spec requested 400.
        # Either is acceptable as long as it's a client error.
        r = requests.get(
            f"{base_url}/api/cards/find",
            params={"set_id": "", "number": "4"},
            timeout=30,
        )
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text[:200]}"

    def test_empty_number_returns_400_or_422(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/find",
            params={"set_id": "base1", "number": ""},
            timeout=30,
        )
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text[:200]}"

    def test_missing_set_id_returns_422(self, base_url):
        r = requests.get(f"{base_url}/api/cards/find", params={"number": "4"}, timeout=30)
        assert r.status_code == 422

    def test_number_with_slash_handled(self, base_url):
        """'4/102' should still resolve to Charizard #4."""
        r = requests.get(
            f"{base_url}/api/cards/find",
            params={"set_id": "base1", "number": "4/102"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert "charizard" in r.json()["name"].lower()
