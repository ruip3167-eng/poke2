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
import httpx

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
            file_contents=[ImageContent(image_base64=img_b64)],
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
