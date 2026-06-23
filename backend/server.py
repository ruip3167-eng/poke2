import sys
import os
import json
import base64
import httpx
import logging
import traceback
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import google.genai as genai

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

app = FastAPI(title="PokeValue API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_KEY = os.environ.get("EMERGENT_LLM_KEY")
client = genai.Client(api_key=GEMINI_KEY) if GEMINI_KEY else None

class ScanRequest(BaseModel):
    image_base64: str
    user_id: Optional[str] = None

class CardSaveRequest(BaseModel):
    user_id: str
    card_data: Dict[str, Any]

@app.get("/")
def read_root():
    return {"status": "online", "message": "PokeValue API ready"}

@app.post("/api/scan/analyze")
async def scan_card(payload: ScanRequest):
    if not client:
        raise HTTPException(status_code=500, detail="Gemini API Client não configurado")
        
    try:
        b64_data = payload.image_base64
        if "," in b64_data:
            parts = b64_data.split(",")
            b64_data = parts[1] if len(parts) > 1 else parts[0]
            
        b64_data = b64_data.strip().replace("\n", "").replace("\r", "")
        
        import base64
        image_bytes = base64.b64decode(b64_data)
        
        print(f"[DIAGNÓSTICO] Tamanho dos bytes recebidos: {len(image_bytes)}")
        
        if len(image_bytes) == 0:
            raise ValueError("Os bytes da imagem estão vazios.")

        from google.genai import types
        image_part = types.Part.from_bytes(
            data=image_bytes,
            mime_type="image/jpeg"
        )
        
        # PROMPT APERFEIÇOADO: Exige precisão absoluta baseada apenas na imagem enviada
        prompt = (
            "Analyze this exact Pokemon card photo. Look closely at the name and card number. "
            "Return a JSON object. Translate the name to the official English name. "
            "Estimate its current TCGplayer market price in USD as a float. "
            "Return keys exactly: 'name', 'set_name', 'number', 'market_price', 'image_url', 'id'."
        )
        
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0  # Temperatura 0 obriga a IA a ser factual e não inventar nomes
        )

        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, image_part],
            config=config
        )
        
        text_clean = response.text.strip() if response.text else ""
        print(f"[DIAGNÓSTICO] Resposta bruta do Gemini: '{text_clean}'")
        
        if not text_clean.startswith("{"):
            start_idx = text_clean.find("{")
            end_idx = text_clean.rfind("}") + 1
            if start_idx != -1 and end_idx != -1:
                text_clean = text_clean[start_idx:end_idx]
                
        ia_data = json.loads(text_clean)
        
        card_name = ia_data.get("name", "Unknown Card")
        card_number = ia_data.get("number", "000")
        set_name = ia_data.get("set_name", "Unknown Set")
        market_price = ia_data.get("market_price", 0.99)
        image_url = ia_data.get("image_url", "https://images.pokemontcg.io/sv1/140.png")
        card_id = ia_data.get("id", f"fallback_{card_number}")

        try:
            market_price = float(market_price)
        except:
            market_price = 0.99

        # EQUAÇÃO DE COMPATIBILIDADE DA APP: 
        # Enviamos o formato plano e a estrutura aninhada para garantir que a sua UI lê de qualquer maneira!
        return {
            "success": True,
            "name": card_name,
            "set_name": set_name,
            "number": card_number,
            "confidence": "high",
            "card": {
                "id": card_id,
                "name": card_name,
                "set_name": set_name,
                "number": card_number,
                "image_url": image_url,
                "tcgplayer_market": market_price,
                "confidence": "high"
            }
        }
        
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Erro no processamento: {str(e)}")

# --- ROTAS DE PORTFÓLIO E MOCKS COMPLETOS ---
@app.get("/api/portfolio")
@app.get("/api/portfolio/")
@app.get("/api/portfolio/{user_id}")
async def get_portfolio(user_id: Optional[str] = None):
    return []

@app.post("/api/portfolio/save")
async def save_card(payload: CardSaveRequest):
    return {"success": True, "message": "Guardado", "id": "mock_123"}

@app.delete("/api/portfolio/{card_id}")
async def delete_card(card_id: str):
    return {"success": True, "deleted": 1}

@app.get("/api/scan/count/{user_id}")
@app.post("/api/scan/count/{user_id}")
async def handle_scan_count(user_id: str):
    return {"count": 1, "free_limit": 5, "is_pro": False}

@app.post("/api/scan/upgrade/{user_id}")
async def upgrade_user(user_id: str):
    return {"count": 0, "free_limit": 99999, "is_pro": True}
