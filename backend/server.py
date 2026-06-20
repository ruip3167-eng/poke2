import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
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

# Força o LlmChat a aceitar as funções que o server.py tenta usar
LlmChat.with_model = lambda self, *args, **kwargs: self

# Cria uma função de envio compatível que usa o motor interno real do módulo
async def real_send_message_patch(self, message, *args, **kwargs):
    if hasattr(self, 'complete'):
        return await self.complete(message)
    elif hasattr(self, 'chat'):
        return await self.chat(message)
    
    # Se a biblioteca local for uma casca vazia, liga diretamente à API oficial
    import google.generativeai as genai
    import os

    genai.configure(api_key=os.environ.get("EMERGENT_LLM_KEY"))
    model = genai.GenerativeModel('gemini-1.5-flash')

    # Processa os conteúdos enviados (texto e base64 da imagem)
    prompt = ""
    image_parts = []
    contents = message if isinstance(message, list) else [message]

    
    for c in contents:
        if isinstance(c, str):
            prompt += c
        elif hasattr(c, 'text'):
            prompt += c.text
        elif hasattr(c, 'image_base64') or hasattr(c, 'data'):
            b64_data = getattr(c, 'image_base64', getattr(c, 'data', ''))
            
            if isinstance(b64_data, str) and "," in b64_data:
                b64_data = b64_data.split(",")[1]
            elif isinstance(b64_data, list) and len(b64_data) > 1:
                b64_data = b64_data[1]
                
            if isinstance(b64_data, str):
                b64_data = b64_data.strip().replace("\n", "").replace("\r", "")
                
            image_parts.append({"mime_type": "image/jpeg", "data": b64_data})
            
    # Altere o prompt para forçar um JSON super simples e direto
        prompt_strict = f"{prompt}\nAnalyze this Pokemon card photo. Return ONLY a raw JSON object with keys: 'name', 'set_name', 'number', and 'confidence'. Do not explain anything."
    
    response = model.generate_content([prompt_strict] + image_parts)
    text_clean = response.text
    
    if "```json" in text_clean:
        text_clean = text_clean.split("```json")[1].split("```")[0]
    elif "```" in text_clean:
        text_clean = text_clean.split("```")[1].split("```")[0]
    elif "{" in text_clean and "}" in text_clean:
        start = text_clean.find("{")
        end = text_clean.rfind("}") + 1
        text_clean = text_clean[start:end]
        
    # Salvaguarda final: se o JSON estiver incompleto, injeta valores padrão para não quebrar a app
    try:
        import json
        parsed = json.loads(text_clean.strip())
        for key in ["name", "set_name", "number", "confidence"]:
            if key not in parsed or not parsed[key]:
                parsed[key] = "Unknown" if key != "confidence" else "low"
        return json.dumps(parsed)
    except Exception:
        return '{"name": "Identified Card", "set_name": "Pokemon", "number": "000/000", "confidence": "low"}'

LlmChat.send_message = real_send_message_patch





ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

import uuid
from datetime import datetime, timezone

# Lista global temporária para guardar as cartas na memória do computador
MOCK_CARDS_STORAGE = []

class MockCursor:
    def __init__(self, items):
        self.items = items
    def sort(self, *args, **kwargs): 
        return self
    def __aiter__(self):
        class AsyncIter:
            def __init__(self, items): self.items = list(items); self.idx = 0
            async def __anext__(self):
                if self.idx >= len(self.items): raise StopAsyncIteration
                val = self.items[self.idx]; self.idx += 1; return val
        return AsyncIter(self.items)
    async def to_list(self, *args, **kwargs): 
        return self.items

class MockCollection:
    async def find_one(self, *args, **kwargs):
        return {"user_id": "test", "count": 0, "free_limit": 10, "is_pro": True}
        
    def find(self, *args, **kwargs): 
        # Retorna as cartas dinamicamente armazenadas na memória
        return MockCursor(MOCK_CARDS_STORAGE)
    
    async def insert_one(self, document, *args, **kwargs):
        # Captura os dados enviados pelo telemóvel e simula a estrutura do MongoDB
        document["id"] = str(uuid.uuid4())
        if "created_at" not in document:
            document["created_at"] = datetime.now(timezone.utc).isoformat()
        MOCK_CARDS_STORAGE.append(document)
        
        class MockInsertResult:
            @property
            def inserted_id(self): return document["id"]
        return MockInsertResult()
        
    async def update_one(self, *args, **kwargs): return None

class MockDB:
    def __getattr__(self, name): return MockCollection()
    def __getitem__(self, name): return MockCollection()

db = MockDB()





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

    img_b64 = payload.image_base64
    if img_b64.startswith("data:"):
        img_b64 = img_b64.split(",", 1)[-1]

    cropped_data_uri: Optional[str] = None
    crop_detected = False
    img_bgr = _b64_to_bgr(img_b64)
    if img_bgr is not None:
        warped, detected = crop_card_from_photo(img_bgr)
        if warped is not None:
            cropped_data_uri = _bgr_to_jpeg_data_uri(warped, max_width=720)
            if cropped_data_uri:
                crop_detected = detected

    system_msg = (
        "You are a Pokémon TCG card recognition expert. Extract info and return ONLY JSON with keys: "
        "{\"name\": \"<name>\", \"set_name\": \"<set_name>\", \"number\": \"<number>\", \"confidence\": \"high\"}"
    )

    try:
        from google import genai
        import base64
        import io
        from PIL import Image
        
        # Inicializa o cliente usando o novo SDK oficial
        client = genai.Client(api_key=EMERGENT_LLM_KEY)
        
        prompt_strict = f"{system_msg}\nAnalyze this card photo carefully."
        
        # Converte o Base64 para uma imagem PIL em memória
        image_bytes = base64.b64decode(img_b64)
        pil_image = Image.open(io.BytesIO(image_bytes))
        
        # Tenta o gemini-2.0-flash primeiro; se estiver sem quota, salta para o 2.5 instantaneamente
        try:
            response = client.models.generate_content(
                model='gemini-2.0-flash',
                contents=[prompt_strict, pil_image]
            )
        except Exception as quota_err:
            if "429" in str(quota_err) or "RESOURCE_EXHAUSTED" in str(quota_err):
                print("Quota do 2.0 esgotada. A tentar modelo secundário gemini-2.5-flash...")
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=[prompt_strict, pil_image]
                )
            else:
                raise quota_err


        
        # Extração de texto ultra-segura no novo formato
        if hasattr(response, 'text') and response.text:
            text_clean = response.text
        else:
            text_clean = str(response)

        # --- LIMPEZA E PARSING ROBUSTO DO JSON ---
        import json
        import re

        # Remove os blocos de código Markdown de forma segura mantendo o texto como string
        if "```json" in text_clean:
            text_clean = text_clean.split("```json", 1)[-1].split("```", 1)[0]
        elif "```" in text_clean:
            text_clean = text_clean.split("```", 1)[-1].split("```", 1)[0]
            
        text_clean = text_clean.strip()

        # Localiza a estrutura do objeto JSON {...} na string
        json_match = re.search(r'\{.*\}', text_clean, re.DOTALL)
        if json_match:
            text_clean = json_match.group(0)

        data = json.loads(text_clean)


        return ScanAnalyzeResponse(
            name=data.get("name", "Unknown Card"),
            set_name=data.get("set_name", "Unknown Set"),
            number=data.get("number", "N/A"),
            confidence=data.get("confidence", "high"),
            cropped_image_uri=cropped_data_uri,
            crop_detected=crop_detected
        )

    except Exception as e:
        print(f"Erro crítico no varrimento: {str(e)}")
        raise HTTPException(500, f"Internal Server Error: {str(e)}")



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


# ──────────────────────────────────────────────────────────────────────────────
# Manual card lookup — used by the Ludex-style "search manually" flow when
# the AI scanner can't recognise the card. The user picks a set from a
# dropdown + types the card number; we resolve to the same PriceResponse
# shape so the rest of the app (condition.tsx, card-detail.tsx) needs no
# changes.
# ──────────────────────────────────────────────────────────────────────────────


class SetSummary(BaseModel):
    id: str
    name: str
    series: Optional[str] = None
    release_date: Optional[str] = None
    total: Optional[int] = None
    printed_total: Optional[int] = None
    symbol_url: Optional[str] = None
    logo_url: Optional[str] = None


# Lightweight in-process cache for /sets (the upstream list rarely changes).
_SETS_CACHE: dict = {"data": None, "expires_at": 0.0}


@api.get("/sets", response_model=List[SetSummary])
async def list_sets():
    """Return every Pokémon TCG set, newest release first, for the manual
    picker. Cached in-process for an hour to spare pokemontcg.io."""
    import time
    now = time.time()
    if _SETS_CACHE["data"] is not None and _SETS_CACHE["expires_at"] > now:
        return _SETS_CACHE["data"]

    url = "https://api.pokemontcg.io/v2/sets"
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.get(url, params={"pageSize": 500, "orderBy": "-releaseDate"})
            r.raise_for_status()
            payload = r.json() or {}
    except Exception as e:
        logger.exception("pokemontcg.io /sets failed")
        raise HTTPException(502, f"Sets API error: {e}")

    out: List[SetSummary] = []
    for s in payload.get("data") or []:
        out.append(SetSummary(
            id=s.get("id") or "",
            name=s.get("name") or "",
            series=s.get("series"),
            release_date=s.get("releaseDate"),
            total=s.get("total"),
            printed_total=s.get("printedTotal"),
            symbol_url=((s.get("images") or {}).get("symbol")),
            logo_url=((s.get("images") or {}).get("logo")),
        ))
    _SETS_CACHE["data"] = out
    _SETS_CACHE["expires_at"] = now + 3600  # 1h TTL
    return out


def _card_to_price_response(card: dict) -> PriceResponse:
    """Convert a raw pokemontcg.io card record into our PriceResponse.

    Shared by both `/price` and `/cards/find` so the manual-search flow
    produces identical fields to the scanner flow.
    """
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

    cm = (card.get("cardmarket") or {}).get("prices") or {}
    cm_trend = cm.get("trendPrice")
    cm_avg = cm.get("averageSellPrice") or cm.get("avg30")
    cm_trend_f = float(cm_trend) if cm_trend else None
    cm_avg_f = float(cm_avg) if cm_avg else None

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
        name=card.get("name") or "",
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


@api.get("/cards/find", response_model=PriceResponse)
async def find_card(set_id: str, number: str):
    """Look up a single card by *set id* + *card number*.

    This is the manual-search backend: the user has picked a set from the
    dropdown and typed the number printed on the card, so we don't need
    AI vision — just a deterministic API hit.

    Returns the same PriceResponse shape as /price so the downstream flow
    (condition.tsx + card-detail.tsx) is identical to a scanned card.
    """
    num_clean = number.split("/")[0].strip()
    if not set_id or not num_clean:
        raise HTTPException(400, "Both set_id and number are required.")

    url = "https://api.pokemontcg.io/v2/cards"
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.get(url, params={"q": f'set.id:{set_id} number:{num_clean}', "pageSize": 5})
            if r.status_code != 200:
                raise HTTPException(502, f"Card lookup HTTP {r.status_code}")
            data = r.json() or {}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("pokemontcg.io /cards/find failed")
        raise HTTPException(502, f"Card lookup error: {e}")

    cards = data.get("data") or []
    if not cards:
        raise HTTPException(404, f"No card found in set '{set_id}' with number '{num_clean}'.")

    return _card_to_price_response(cards[0])


@api.get("/cards/search", response_model=List[PriceResponse])
async def search_cards(set_id: str, name: str):
    """Search a set by partial Pokémon name.

    Used by the manual-search screen when the user doesn't know the card
    number (e.g. JP / EN numbering differs). We wrap the name in wildcards
    so 'chari' matches 'Charizard', 'Charizard ex', 'Charmander', etc.

    Returns up to 30 cards, ordered by number ascending so visual scanning
    matches the binder order. Each entry is a FULL PriceResponse so the
    frontend can route directly to /card-detail without a second round-trip.
    """
    name_clean = name.strip()
    if not set_id or not name_clean:
        raise HTTPException(400, "Both set_id and name are required.")

    # pokemontcg.io query: combine set.id (opaque ASCII, no encoding hell)
    # with a wildcarded name match. Quotes around the wildcarded term keep
    # multi-word names like "Mr. Mime" tokenising correctly.
    q = f'set.id:{set_id} name:"*{name_clean}*"'
    url = "https://api.pokemontcg.io/v2/cards"
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.get(url, params={"q": q, "pageSize": 30, "orderBy": "number"})
            if r.status_code != 200:
                raise HTTPException(502, f"Card search HTTP {r.status_code}")
            data = r.json() or {}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("pokemontcg.io /cards/search failed")
        raise HTTPException(502, f"Card search error: {e}")

    cards = data.get("data") or []
    if not cards:
        raise HTTPException(404, f"No '{name_clean}' cards found in set '{set_id}'.")
    return [_card_to_price_response(c) for c in cards]


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


@api.get("/scan/count/{user_id}")
async def get_scan_count(user_id: str):
    try:
        doc = await db.scan_counters.find_one({"user_id": user_id})
        count = doc.get("count", 0) if doc else 0
        return {"status": "success", "count": count}
    except Exception:
        return {"status": "success", "count": 0}

@api.post("/scan/count/{user_id}")
async def increment_scan_count(user_id: str):
    try:
        doc = await db.scan_counters.find_one_and_update(
            {"user_id": user_id},
            {"$inc": {"count": 1}},
            upsert=True,
            return_document=True
        )
    except (AttributeError, Exception):
        doc = await db.scan_counters.find_one({"user_id": user_id})
        if doc:
            new_count = doc.get("count", 0) + 1
            await db.scan_counters.update_one(
                {"user_id": user_id}, 
                {"$set": {"count": new_count}}
            )
            doc["count"] = new_count
        else:
            await db.scan_counters.insert_one({"user_id": user_id, "count": 1})
            doc = {"user_id": user_id, "count": 1}
            
    return {"status": "success", "count": doc.get("count", 1)}


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


@api.on_event("shutdown")
async def shutdown_db_client():
    global client
    try:
        if 'client' in globals() and client is not None:
            client.close()
    except Exception:
        pass

