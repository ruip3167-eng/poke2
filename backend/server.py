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
    tcgplayer_market: Optional[float] = None
    cardmarket_average: Optional[float] = None
    cardmarket_trend: Optional[float] = None
    currency: str = "USD"


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
    # Build the query
    name_clean = name.strip()
    q_parts = [f'name:"{name_clean}"']
    if number:
        # number may look like "25/102" — use just the left part
        num = number.split("/")[0].strip()
        if num:
            q_parts.append(f"number:{num}")
    if set_name:
        # match against set.name
        s = set_name.replace('"', "").strip()
        if s:
            q_parts.append(f'set.name:"{s}"')
    q = " ".join(q_parts)

    url = "https://api.pokemontcg.io/v2/cards"
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.get(url, params={"q": q, "pageSize": 10})
            if r.status_code != 200:
                # retry with just name
                r = await http.get(url, params={"q": f'name:"{name_clean}"', "pageSize": 10})
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.exception("pokemontcg.io failed")
        raise HTTPException(502, f"Price API error: {e}")

    cards = data.get("data") or []
    if not cards:
        raise HTTPException(404, f"No price data found for '{name_clean}'.")

    card = cards[0]
    # extract tcgplayer (USD) and cardmarket (EUR) prices
    tcg = ((card.get("tcgplayer") or {}).get("prices") or {})
    # tcgplayer prices object has variants — pick the first variant with a market price
    market = None
    for variant_key, variant in tcg.items():
        if isinstance(variant, dict) and variant.get("market"):
            market = float(variant["market"])
            break
        if isinstance(variant, dict) and variant.get("mid"):
            market = float(variant["mid"])
            break

    cm = (card.get("cardmarket") or {}).get("prices") or {}
    cm_avg = cm.get("averageSellPrice") or cm.get("avg30") or cm.get("trendPrice")
    cm_trend = cm.get("trendPrice")

    return PriceResponse(
        card_id=card.get("id"),
        name=card.get("name") or name_clean,
        set_name=(card.get("set") or {}).get("name"),
        number=card.get("number"),
        image_url=((card.get("images") or {}).get("large")
                   or (card.get("images") or {}).get("small")),
        tcgplayer_market=market,
        cardmarket_average=float(cm_avg) if cm_avg else None,
        cardmarket_trend=float(cm_trend) if cm_trend else None,
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


@api.get("/scan/count/{user_id}", response_model=ScanCount)
async def get_scan_count(user_id: str):
    doc = await db.scan_counters.find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        return ScanCount(user_id=user_id, count=0)
    return ScanCount(**doc)


@api.post("/scan/count/{user_id}", response_model=ScanCount)
async def increment_scan_count(user_id: str):
    doc = await db.scan_counters.find_one_and_update(
        {"user_id": user_id},
        {"$inc": {"count": 1}, "$setOnInsert": {"free_limit": 10, "is_pro": False}},
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    if not doc:
        doc = {"user_id": user_id, "count": 1, "free_limit": 10, "is_pro": False}
    return ScanCount(**doc)


@api.post("/scan/upgrade/{user_id}", response_model=ScanCount)
async def upgrade_to_pro(user_id: str):
    """Mock upgrade — flips is_pro to True (no real billing)."""
    await db.scan_counters.update_one(
        {"user_id": user_id},
        {"$set": {"is_pro": True}, "$setOnInsert": {"count": 0, "free_limit": 10}},
        upsert=True,
    )
    doc = await db.scan_counters.find_one({"user_id": user_id}, {"_id": 0})
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
