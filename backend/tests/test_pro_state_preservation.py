"""
Targeted regression tests for the Pro-state-reset bug fix.

Scope (from review_request):
1. POST /api/scan/upgrade/{uid} flips is_pro=True and persists.
2. POST /api/scan/count/{uid} (increment) PRESERVES is_pro=True across multiple
   increments (must use $setOnInsert, NOT $set).
3. POST /api/portfolio/save does NOT mutate the scan_counters collection in
   any way. After saving, GET /api/scan/count/{uid} still returns is_pro=True
   and the same count.
"""
import uuid
import requests


def _uid(prefix: str = "TEST_pro") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


# --------- 1. Upgrade flips is_pro ---------
def test_upgrade_flips_is_pro_true(base_url):
    uid = _uid()
    r = requests.post(f"{base_url}/api/scan/upgrade/{uid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_pro"] is True
    assert body["user_id"] == uid

    # subsequent GET must also return is_pro=True
    g = requests.get(f"{base_url}/api/scan/count/{uid}")
    assert g.status_code == 200
    assert g.json()["is_pro"] is True


# --------- 2. Increment preserves is_pro=True ---------
def test_increment_preserves_is_pro_across_multiple_calls(base_url):
    """After upgrade, every POST /scan/count must keep is_pro=True.
    This is the exact bug scenario the user reported.
    """
    uid = _uid()
    # set up some initial counter rows the way the app does
    for _ in range(2):
        requests.post(f"{base_url}/api/scan/count/{uid}")
    # upgrade
    up = requests.post(f"{base_url}/api/scan/upgrade/{uid}")
    assert up.status_code == 200
    assert up.json()["is_pro"] is True
    start_count = up.json()["count"]

    # increment 4 more times — is_pro must stay True every time
    last_count = start_count
    for i in range(4):
        r = requests.post(f"{base_url}/api/scan/count/{uid}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_pro"] is True, (
            f"REGRESSION: increment #{i+1} reset is_pro to False (body={body}). "
            "Increment endpoint must use $setOnInsert for is_pro, not $set."
        )
        assert body["count"] == last_count + 1
        last_count = body["count"]

    # final GET confirms persistence
    g = requests.get(f"{base_url}/api/scan/count/{uid}")
    assert g.json()["is_pro"] is True
    assert g.json()["count"] == last_count


# --------- 3. portfolio/save must not touch scan_counters ---------
def test_save_card_does_not_touch_scan_counters(base_url):
    """Save a card after upgrading — Pro state and count must be unchanged."""
    uid = _uid("TEST_save_pro")
    # upgrade
    requests.post(f"{base_url}/api/scan/upgrade/{uid}")
    # bump count a couple of times
    for _ in range(3):
        requests.post(f"{base_url}/api/scan/count/{uid}")

    before = requests.get(f"{base_url}/api/scan/count/{uid}").json()
    assert before["is_pro"] is True
    count_before = before["count"]

    payload = {
        "user_id": uid,
        "name": "TEST_PortfolioSavePreservePro",
        "set_name": "Base",
        "number": "4/102",
        "image_url": "https://example.com/x.png",
        "market_price": 50.0,
        "estimated_value": 40.0,
        "condition": {
            "centering": "near_mint", "corners": "near_mint",
            "edges": "near_mint", "surface": "near_mint",
            "whitening": False, "scratches": False,
        },
        "condition_grade": "Near Mint",
        "condition_multiplier": 0.8,
        "tcgplayer_market": 49.5,
        "cardmarket_average": 50.2,
        "cardmarket_trend": 50.0,
        "price_source": "cardmarket_trend",
        "price_at_creation": 50.0,
        "card_id": "base1-4",
    }
    sv = requests.post(f"{base_url}/api/portfolio/save", json=payload)
    assert sv.status_code == 200, sv.text
    saved_id = sv.json()["id"]

    after = requests.get(f"{base_url}/api/scan/count/{uid}").json()
    assert after["is_pro"] is True, (
        "REGRESSION: /portfolio/save mutated is_pro back to False"
    )
    assert after["count"] == count_before, (
        f"REGRESSION: /portfolio/save changed scan count {count_before} -> {after['count']}"
    )

    # cleanup
    requests.delete(f"{base_url}/api/portfolio/{saved_id}")


# --------- 4. Full user journey from the bug report ---------
def test_full_user_journey_paywall_to_save_to_scan(base_url):
    """Reproduce the exact path the user reported:
      a) hit free limit (5 scans) → would route to paywall
      b) upgrade via mock
      c) save a portfolio card
      d) scan again — is_pro MUST still be True so the FE doesn't re-show paywall
    """
    uid = _uid("TEST_journey")

    # a) exhaust free scans
    for i in range(5):
        r = requests.post(f"{base_url}/api/scan/count/{uid}")
        assert r.json()["is_pro"] is False
    state_at_limit = requests.get(f"{base_url}/api/scan/count/{uid}").json()
    assert state_at_limit["count"] == 5
    assert state_at_limit["count"] >= state_at_limit["free_limit"]

    # b) upgrade
    up = requests.post(f"{base_url}/api/scan/upgrade/{uid}").json()
    assert up["is_pro"] is True
    assert up["count"] == 5, "Upgrade must NOT reset count"

    # c) save a card
    payload = {
        "user_id": uid,
        "name": "TEST_JourneyCard",
        "market_price": 10.0,
        "estimated_value": 8.0,
        "condition": {
            "centering": "near_mint", "corners": "near_mint",
            "edges": "near_mint", "surface": "near_mint",
            "whitening": False, "scratches": False,
        },
        "condition_grade": "Near Mint",
        "condition_multiplier": 0.8,
    }
    sv = requests.post(f"{base_url}/api/portfolio/save", json=payload).json()
    saved_id = sv["id"]

    # d) GET count (FE useFocusEffect will do this) — must still be Pro
    final = requests.get(f"{base_url}/api/scan/count/{uid}").json()
    assert final["is_pro"] is True, (
        "BUG: after save, GET /scan/count returns is_pro=False → FE would re-show paywall"
    )

    # e) next increment (next scan capture) — still Pro
    inc = requests.post(f"{base_url}/api/scan/count/{uid}").json()
    assert inc["is_pro"] is True
    assert inc["count"] == 6

    # cleanup
    requests.delete(f"{base_url}/api/portfolio/{saved_id}")
