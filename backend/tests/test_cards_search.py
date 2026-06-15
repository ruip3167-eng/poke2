"""Tests for the new GET /api/cards/search endpoint (iteration 14).

Manual search now uses partial Pokémon name instead of card number to
bypass JP/EN numbering mismatches. Backend wraps query in wildcards and
returns up to 30 PriceResponse objects ordered by number ascending.
"""
import requests


class TestCardsSearch:
    # ── Happy path: sv3pt5 + 'chari' should return ~6 Charizard/Charisma variants
    def test_chari_in_sv3pt5(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/search",
            params={"set_id": "sv3pt5", "name": "chari"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list)
        assert len(body) >= 6, f"expected >=6 results, got {len(body)}"

        # Each entry must be PriceResponse-shaped with the essentials
        for c in body:
            for key in ("card_id", "name", "set_name", "number",
                        "image_url", "recommended_eur", "currency"):
                assert key in c, f"missing key {key} in {c}"
            assert c["currency"] == "EUR"
            assert c["image_url"] and c["image_url"].startswith("http")
            assert c["recommended_eur"] is not None
            assert c["name"]
            assert c["number"]

        # Spec ordering check: first entry is Charizard ex #6
        names = [c["name"].lower() for c in body]
        numbers = [c["number"] for c in body]
        assert "charizard ex" in names[0]
        assert numbers[0] == "6"
        # Order is by number ascending (numeric)
        as_ints = [int(n) for n in numbers if n.isdigit()]
        assert as_ints == sorted(as_ints), f"not ascending: {numbers}"
        # Contains the famous SIR Charizard ex #183 and Giovanni's Charisma #161
        assert any(n == "183" for n in numbers), numbers
        assert any(n == "161" for n in numbers), numbers

    # ── Pikachu in sv1 (Scarlet & Violet Base) — pokemontcg.io has NO Pikachu
    # in sv1 (verified via direct query). Spec asked for sv1 but the data set
    # is empty there, so we verify the endpoint returns the documented 404.
    # We additionally verify Pikachu exists in sv3pt5 (Pokémon 151) to prove
    # name-search works for Pikachu in general.
    def test_pikachu_in_sv1_actually_404(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/search",
            params={"set_id": "sv1", "name": "pikachu"},
            timeout=30,
        )
        # Upstream has no Pikachu in sv1 — endpoint correctly returns 404.
        assert r.status_code == 404, r.text

    def test_pikachu_in_sv3pt5(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/search",
            params={"set_id": "sv3pt5", "name": "pikachu"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, list) and len(body) >= 1
        assert any("pikachu" in c["name"].lower() for c in body)

    # ── No match → 404 with helpful detail
    def test_no_match_returns_404(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/search",
            params={"set_id": "sv1", "name": "xxnomatchxx"},
            timeout=30,
        )
        assert r.status_code == 404
        body = r.json()
        assert "detail" in body
        assert "xxnomatchxx" in body["detail"]

    # ── Missing/empty params should be client error
    def test_missing_set_id(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/search",
            params={"name": "pikachu"},
            timeout=30,
        )
        assert r.status_code == 422

    def test_missing_name(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/search",
            params={"set_id": "sv1"},
            timeout=30,
        )
        assert r.status_code == 422

    def test_empty_set_id_returns_400_or_422(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/search",
            params={"set_id": "", "name": "pikachu"},
            timeout=30,
        )
        assert r.status_code in (400, 422), r.text

    def test_empty_name_returns_400_or_422(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/search",
            params={"set_id": "sv1", "name": ""},
            timeout=30,
        )
        assert r.status_code in (400, 422), r.text

    # ── Response shape must match PriceResponse fields
    def test_shape_matches_price_response(self, base_url):
        r_search = requests.get(
            f"{base_url}/api/cards/search",
            params={"set_id": "sv3pt5", "name": "chari"},
            timeout=30,
        )
        r_price = requests.get(
            f"{base_url}/api/price",
            params={"name": "Pikachu"},
            timeout=30,
        )
        assert r_search.status_code == 200 and r_price.status_code == 200
        assert set(r_search.json()[0].keys()) == set(r_price.json().keys())


class TestNonRegression:
    """Iteration 14: ensure previous endpoints still work."""

    def test_cards_find_tarountula(self, base_url):
        r = requests.get(
            f"{base_url}/api/cards/find",
            params={"set_id": "sv1", "number": "199"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tarountula" in body["name"].lower()
        assert body["recommended_eur"] is not None

    def test_price_pikachu(self, base_url):
        r = requests.get(
            f"{base_url}/api/price",
            params={"name": "Pikachu"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert "pikachu" in r.json()["name"].lower()

    def test_sets_still_works(self, base_url):
        r = requests.get(f"{base_url}/api/sets", timeout=30)
        assert r.status_code == 200
        assert len(r.json()) > 100
