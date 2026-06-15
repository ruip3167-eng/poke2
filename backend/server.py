"""
PokeValue Scanner backend
- Gemini Vision for card recognition
- pokemontcg.io for live market prices
- MongoDB for user portfolios and scan counters
"""

from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from pathlib import Path
from datetime import datetime, timezone
import os
import uuid
import json
import logging
import re
import base64
import httpx
import cv2
import numpy as np

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="PokeValue Scanner API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("pokevalue")


# ---------- Models ----------
class ScanAnalyzeRequest(BaseModel):
    image_base64: str
    user_id: Optional[str] = None


class ScanAnalyzeResponse(BaseModel):
    name: str
    set_name: Optional[str] = None
    number: Optional[str] = None
    confidence: str = "medium"
    raw: Optional[str] = None
    # Card cropped from the captured photo using contour detection. Returned
    # as a data URI (data:image/jpeg;base64,...) so the frontend can use it
    # directly as an <Image> src. None if no card-shaped contour was found.
    cropped_image: Optional[str] = None
    crop_detected: bool = False


class PriceResponse(BaseModel):
    card_id: Optional[str] = None
    name: str
    set_name: Optional[str] = None
    number: Optional[str] = None
    image_url: Optional[str] = None
    # Raw market data straight from pokemontcg.io
    tcgplayer_market: Optional[float] = None            # USD → EUR converted, best variant
    tcgplayer_holofoil_market: Optional[float] = None   # USD → EUR converted
    tcgplayer_normal_market: Optional[float] = None     # USD → EUR converted
    tcgplayer_variant: Optional[str] = None             # which variant was used
    cardmarket_average: Optional[float] = None          # EUR (cardmarket is European)
    cardmarket_trend: Optional[float] = None            # EUR
    # Best EUR price we recommend the UI use as the base for the wear formula.
    # Priority: cardmarket.trendPrice → cardmarket.averageSellPrice → tcgplayer (USD→EUR).
    recommended_eur: Optional[float] = None
    price_source: Optional[str] = None  # 'cardmarket_trend' | 'cardmarket_avg' | 'tcgplayer_holofoil' | 'tcgplayer_normal' | 'tcgplayer_other'
    usd_to_eur_rate: float = 0.92
    currency: str = "EUR"


class ConditionPayload(BaseModel):
    centering: str = "near_mint"   # mint, near_mint, lightly_played, played, poor
    corners: str = "near_mint"
    edges: str = "near_mint"
    surface: str = "near_mint"
    whitening: bool = False
    scratches: bool = False


class SaveCardRequest(BaseModel):
    user_id: str
    name: str
    set_name: Optional[str] = None
    number: Optional[str] = None
    image_url: Optional[str] = None
    market_price: float = 0.0
    estimated_value: float = 0.0
    condition: ConditionPayload
    condition_grade: str
    condition_multiplier: float
    # Live market snapshot at save time (used for trend comparisons later).
    tcgplayer_market: Optional[float] = None
    cardmarket_average: Optional[float] = None
    cardmarket_trend: Optional[float] = None
    price_source: Optional[str] = None
    price_at_creation: Optional[float] = None
    card_id: Optional[str] = None


class CardRecord(BaseModel):
    id: str
    user_id: str
    name: str
    set_name: Optional[str] = None
    number: Optional[str] = None
    image_url: Optional[str] = None
    market_price: float
    estimated_value: float
    condition: ConditionPayload
    condition_grade: str
    condition_multiplier: float
    created_at: str
    # Persisted market snapshot from the original save. We refetch live
    # prices on the detail screen and diff against price_at_creation to
    # render up/down trend arrows on the portfolio.
    tcgplayer_market: Optional[float] = None
    cardmarket_average: Optional[float] = None
    cardmarket_trend: Optional[float] = None
    price_source: Optional[str] = None
    price_at_creation: Optional[float] = None
    card_id: Optional[str] = None


class ScanCount(BaseModel):
    user_id: str
    count: int
    free_limit: int = 10
    is_pro: bool = False


# ---------- Helpers ----------
def _serialize(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc.pop("_id", None)
    return doc


def _extract_json(text: str) -> Dict[str, Any]:
    """Find the first JSON object inside arbitrary model text."""
    if not text:
        return {}
    # try direct
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


# ---------- Card cropping (edge detection + perspective warp) ----------
def _order_points(pts: np.ndarray) -> np.ndarray:
    """Return the 4 quadrilateral points as (tl, tr, br, bl)."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # top-left
    rect[2] = pts[np.argmax(s)]   # bottom-right
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]   # top-right
    rect[3] = pts[np.argmax(diff)]   # bottom-left
    return rect


def _try_find_card_quad(proc: np.ndarray, canny_lo: int, canny_hi: int, min_area_pct: float) -> Optional[np.ndarray]:
    """One pass of Canny → contours → 4-point approx. Returns the quad or None."""
    gray = cv2.cvtColor(proc, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, canny_lo, canny_hi)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]
    min_area = proc.shape[0] * proc.shape[1] * min_area_pct
    for c in contours:
        if cv2.contourArea(c) < min_area:
            continue
        peri = cv2.arcLength(c, True)
        # try a few epsilon levels — real photos rarely give a clean 4-point poly
        for eps in (0.02, 0.03, 0.04, 0.05):
            approx = cv2.approxPolyDP(c, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                return approx.reshape(4, 2).astype("float32")
    return None


def _center_crop_to_card_aspect(img: np.ndarray) -> np.ndarray:
    """
    Last-resort fallback: crop the photo to a Pokémon-card aspect ratio
    (63mm × 88mm ≈ 0.716) around the centre. Matches the on-screen framing
    brackets so the card (which the user aligned inside the frame) is
    preserved and ~70%+ of the background is removed.
    """
    h, w = img.shape[:2]
    target_ar = 63.0 / 88.0       # width / height (portrait)
    # Crop a centred rectangle that covers the framing area (~78% wide × 52% tall).
    crop_w = int(w * 0.80)
    crop_h = int(crop_w / target_ar)
    if crop_h > h * 0.95:
        crop_h = int(h * 0.92)
        crop_w = int(crop_h * target_ar)
    x = (w - crop_w) // 2
    y = (h - crop_h) // 2
    return img[y:y + crop_h, x:x + crop_w]


def crop_card_from_photo(img_bgr: np.ndarray) -> tuple[Optional[np.ndarray], bool]:
    """
    Find the largest convex quadrilateral in the photo (assumed to be the
    Pokémon card) and return a deskewed crop of it.

    Returns (image, detected). `detected=True` means an actual card outline
    was found; `detected=False` means we fell back to a card-aspect center
    crop. Either way the returned image NEVER includes the full background.
    """
    if img_bgr is None or img_bgr.size == 0:
        return None, False
    h, w = img_bgr.shape[:2]
    target = 800
    ratio = target / max(h, w) if max(h, w) > target else 1.0
    proc = cv2.resize(img_bgr, (int(w * ratio), int(h * ratio))) if ratio < 1.0 else img_bgr.copy()

    # Try a few parameter sets — phone photos have wildly different lighting.
    quad = None
    for canny_lo, canny_hi, min_area_pct in [
        (50, 150, 0.12),
        (30, 100, 0.10),
        (75, 200, 0.08),
    ]:
        quad = _try_find_card_quad(proc, canny_lo, canny_hi, min_area_pct)
        if quad is not None:
            break

    if quad is None:
        # Soft fallback: center-crop to card aspect ratio (always returns).
        return _center_crop_to_card_aspect(img_bgr), False

    # Scale points back to original image coordinates and warp.
    card_quad = quad / ratio
    rect = _order_points(card_quad)
    (tl, tr, br, bl) = rect
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_w = int(max(width_a, width_b))
    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_h = int(max(height_a, height_b))
    if max_w < 40 or max_h < 40:
        return _center_crop_to_card_aspect(img_bgr), False

    dst = np.array(
        [[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]],
        dtype="float32",
    )
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img_bgr, M, (max_w, max_h))
    if warped.shape[1] > warped.shape[0]:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)
    return warped, True


def _b64_to_bgr(b64_data: str) -> Optional[np.ndarray]:
    try:
        raw = base64.b64decode(b64_data)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        return img
    except Exception:
        return None


def _bgr_to_jpeg_data_uri(img: np.ndarray, max_width: int = 720) -> Optional[str]:
    try:
        h, w = img.shape[:2]
        if w > max_width:
            new_h = int(h * max_width / w)
            img = cv2.resize(img, (max_width, new_h), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            return None
        return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")
    except Exception:
        return None


# ---------- Routes ----------
@api.get("/")
async def root():
    return {"service": "pokevalue-scanner", "status": "ok"}


@api.post("/scan/analyze", response_model=ScanAnalyzeResponse)
async def scan_analyze(payload: ScanAnalyzeRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "Emergent LLM key not configured")
    if not payload.image_base64:
        raise HTTPException(400, "image_base64 required")

    # Strip data: prefix if present
    img_b64 = payload.image_base64
    if img_b64.startswith("data:"):
        img_b64 = img_b64.split(",", 1)[-1]

    # Edge-detect + perspective-warp the card out of the photo. This isolates
    # the card from the table/background. If detection fails (e.g. low
    # contrast or no clear card edges) we silently fall back to the full
    # photo so the vision step still runs.
    cropped_data_uri: Optional[str] = None
    crop_detected = False
    vision_b64 = img_b64
    img_bgr = _b64_to_bgr(img_b64)
    if img_bgr is not None:
        warped, detected = crop_card_from_photo(img_bgr)
        if warped is not None:
            cropped_data_uri = _bgr_to_jpeg_data_uri(warped, max_width=720)
            if cropped_data_uri:
                crop_detected = detected   # True = real card contour, False = center-crop fallback
                # Always send the cropped/center-cropped version to Gemini —
                # the table/background never reaches the vision model.
                vision_b64 = cropped_data_uri.split(",", 1)[-1]

    system_msg = (
        "You are a Pokémon TCG card recognition expert. The user gives you a photo of a "
        "raw Pokémon trading card. Extract the printed card information and return ONLY a "
        "minified JSON object — no prose, no markdown — with keys: "
        '{"name": "<card name>", "set": "<set name or short code>", '
        '"number": "<collector number as it appears, e.g. 25/102>"}. '
        "If a field is not visible, use null for that field. Be conservative — never invent a name."
    )

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"scan-{uuid.uuid4()}",
            system_message=system_msg,
        ).with_model("gemini", "gemini-2.5-flash")

        msg = UserMessage(
            text="Identify this Pokémon card. Reply with only the JSON object as instructed.",
            file_contents=[ImageContent(image_base64=vision_b64)],
        )
        raw = await chat.send_message(msg)
    except Exception as e:
        logger.exception("Gemini vision failed")
        raise HTTPException(502, f"Vision model error: {e}")

    data = _extract_json(raw or "")
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "Could not recognise the card. Try a clearer, well-lit photo.")

    return ScanAnalyzeResponse(
        name=name,
        set_name=(data.get("set") or None),
        number=(data.get("number") or None),
        confidence="high" if (data.get("set") and data.get("number")) else "medium",
        raw=raw,
        cropped_image=cropped_data_uri,
        crop_detected=crop_detected,
    )


@api.get("/price", response_model=PriceResponse)
async def price(name: str, set_name: Optional[str] = None, number: Optional[str] = None):
    """Query pokemontcg.io for the best-matching card and its prices."""
    # Build progressive query candidates: most specific → least specific.
    # pokemontcg.io occasionally returns 404 (yes, really) on combined
    # name+number queries even when each clause individually returns hits,
    # so we walk down the list until something hits.
    name_clean = name.strip()
    num: Optional[str] = None
    if number:
        n = number.split("/")[0].strip()
        if n:
            num = n
    set_clean: Optional[str] = None
    if set_name:
        s = set_name.replace('"', "").strip()
        if s:
            set_clean = s

    queries: list[str] = []
    base_name = f'name:"{name_clean}"'
    if num and set_clean:
        queries.append(f'{base_name} number:{num} set.name:"{set_clean}"')
    if num:
        queries.append(f'{base_name} number:{num}')
    if set_clean:
        queries.append(f'{base_name} set.name:"{set_clean}"')
    queries.append(base_name)

    url = "https://api.pokemontcg.io/v2/cards"
    cards: list[dict] = []
    last_err: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            for q in queries:
                try:
                    r = await http.get(url, params={"q": q, "pageSize": 10})
                except Exception as e:
                    last_err = str(e)
                    continue
                if r.status_code != 200:
                    last_err = f"HTTP {r.status_code}"
                    continue
                payload = r.json() or {}
                if payload.get("data"):
                    cards = payload["data"]
                    break
    except Exception as e:
        logger.exception("pokemontcg.io request failed")
        raise HTTPException(502, f"Price API error: {e}")

    if not cards:
        raise HTTPException(404, f"No price data found for '{name_clean}'.{(' ' + last_err) if last_err else ''}")

    card = cards[0]

    # ── TCGplayer (USD) ────────────────────────────────────────────────────
    # The API exposes prices per *variant*: holofoil, normal, reverseHolofoil,
    # 1stEditionHolofoil, unlimitedHolofoil, etc. We prefer holofoil (most
    # collectable) then normal, then any remaining variant.
    USD_TO_EUR = 0.92
    tcg = ((card.get("tcgplayer") or {}).get("prices") or {})

    def _pick(variant_dict: dict) -> Optional[float]:
        if not isinstance(variant_dict, dict):
            return None
        return variant_dict.get("market") or variant_dict.get("mid")

    def _usd_to_eur(v: Optional[float]) -> Optional[float]:
        return round(float(v) * USD_TO_EUR, 2) if v else None

    tcg_holo_eur = _usd_to_eur(_pick(tcg.get("holofoil") or {}))
    tcg_norm_eur = _usd_to_eur(_pick(tcg.get("normal") or {}))

    # Choose a single TCGplayer EUR value + variant label.
    tcg_market_eur: Optional[float] = None
    tcg_variant: Optional[str] = None
    if tcg_holo_eur is not None:
        tcg_market_eur, tcg_variant = tcg_holo_eur, "holofoil"
    elif tcg_norm_eur is not None:
        tcg_market_eur, tcg_variant = tcg_norm_eur, "normal"
    else:
        for variant_key, variant in tcg.items():
            v = _pick(variant)
            if v:
                tcg_market_eur, tcg_variant = _usd_to_eur(v), str(variant_key)
                break

    # ── Cardmarket (already EUR — European marketplace) ────────────────────
    cm = (card.get("cardmarket") or {}).get("prices") or {}
    cm_trend = cm.get("trendPrice")
    cm_avg = cm.get("averageSellPrice") or cm.get("avg30")
    cm_trend_f = float(cm_trend) if cm_trend else None
    cm_avg_f = float(cm_avg) if cm_avg else None

    # ── Recommended EUR price ─────────────────────────────────────────────
    # Priority: Cardmarket trend (live EU market) → Cardmarket avg → TCGplayer.
    recommended_eur: Optional[float] = None
    price_source: Optional[str] = None
    if cm_trend_f and cm_trend_f > 0:
        recommended_eur, price_source = cm_trend_f, "cardmarket_trend"
    elif cm_avg_f and cm_avg_f > 0:
        recommended_eur, price_source = cm_avg_f, "cardmarket_avg"
    elif tcg_market_eur and tcg_market_eur > 0:
        recommended_eur = tcg_market_eur
        price_source = f"tcgplayer_{tcg_variant}" if tcg_variant else "tcgplayer_other"

    return PriceResponse(
        card_id=card.get("id"),
        name=card.get("name") or name_clean,
        set_name=(card.get("set") or {}).get("name"),
        number=card.get("number"),
        image_url=((card.get("images") or {}).get("large")
                   or (card.get("images") or {}).get("small")),
        tcgplayer_market=tcg_market_eur,
        tcgplayer_holofoil_market=tcg_holo_eur,
        tcgplayer_normal_market=tcg_norm_eur,
        tcgplayer_variant=tcg_variant,
        cardmarket_average=cm_avg_f,
        cardmarket_trend=cm_trend_f,
        recommended_eur=recommended_eur,
        price_source=price_source,
        usd_to_eur_rate=USD_TO_EUR,
        currency="EUR",
    )


@api.post("/portfolio/save", response_model=CardRecord)
async def save_card(req: SaveCardRequest):
    rec = CardRecord(
        id=str(uuid.uuid4()),
        user_id=req.user_id,
        name=req.name,
        set_name=req.set_name,
        number=req.number,
        image_url=req.image_url,
        market_price=req.market_price,
        estimated_value=req.estimated_value,
        condition=req.condition,
        condition_grade=req.condition_grade,
        condition_multiplier=req.condition_multiplier,
        created_at=datetime.now(timezone.utc).isoformat(),
        tcgplayer_market=req.tcgplayer_market,
        cardmarket_average=req.cardmarket_average,
        cardmarket_trend=req.cardmarket_trend,
        price_source=req.price_source,
        # Fall back to market_price so we always have *something* to trend
        # against, even for older saves that never sent price_at_creation.
        price_at_creation=req.price_at_creation if req.price_at_creation is not None else req.market_price,
        card_id=req.card_id,
    )
    doc = rec.model_dump()
    await db.cards.insert_one(doc.copy())
    return rec


@api.get("/portfolio/{user_id}", response_model=List[CardRecord])
async def get_portfolio(user_id: str):
    cur = db.cards.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1)
    rows = await cur.to_list(500)
    return [CardRecord(**r) for r in rows]


@api.delete("/portfolio/{card_id}")
async def delete_card(card_id: str):
    res = await db.cards.delete_one({"id": card_id})
    return {"deleted": res.deleted_count}


# Server-authoritative free-tier limit. Override existing user records too
# (some may have been created when the limit was higher).
FREE_SCAN_LIMIT = 5


@api.get("/scan/count/{user_id}", response_model=ScanCount)
async def get_scan_count(user_id: str):
    doc = await db.scan_counters.find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        return ScanCount(user_id=user_id, count=0, free_limit=FREE_SCAN_LIMIT)
    doc["free_limit"] = FREE_SCAN_LIMIT
    return ScanCount(**doc)


@api.post("/scan/count/{user_id}", response_model=ScanCount)
async def increment_scan_count(user_id: str):
    doc = await db.scan_counters.find_one_and_update(
        {"user_id": user_id},
        {"$inc": {"count": 1}, "$set": {"free_limit": FREE_SCAN_LIMIT}, "$setOnInsert": {"is_pro": False}},
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    if not doc:
        doc = {"user_id": user_id, "count": 1, "free_limit": FREE_SCAN_LIMIT, "is_pro": False}
    doc["free_limit"] = FREE_SCAN_LIMIT
    return ScanCount(**doc)


@api.post("/scan/upgrade/{user_id}", response_model=ScanCount)
async def upgrade_to_pro(user_id: str):
    """Mock upgrade — flips is_pro to True (no real billing)."""
    await db.scan_counters.update_one(
        {"user_id": user_id},
        {"$set": {"is_pro": True, "free_limit": FREE_SCAN_LIMIT}, "$setOnInsert": {"count": 0}},
        upsert=True,
    )
    doc = await db.scan_counters.find_one({"user_id": user_id}, {"_id": 0})
    doc["free_limit"] = FREE_SCAN_LIMIT
    return ScanCount(**doc)


# Mount + middleware
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
