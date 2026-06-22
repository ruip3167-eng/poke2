import sys
import os
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import google.genai as genai
import json
import httpx
import logging

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
            b64_data = b64_data.split(",")[1]
            
        b64_data = b64_data.strip().replace("\n", "").replace("\r", "")
        
        prompt = "Analyze this Pokemon card photo. Return ONLY a raw JSON object with keys: 'name', 'set_name', 'number'. Do not include markdown formatting or extra text."
        image_part = {"inline_data": {"mime_type": "image/jpeg", "data": b64_data}}
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, image_part]
        )
        
        text = response.text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
            
        ia_data = json.loads(text.strip())
        
        # --- CRUZAMENTO LIVE COM O POKEMONTCG.IO ---
        card_name = ia_data.get("name", "")
        card_number = ia_data.get("number", "")
        
        # Faz a pesquisa na API pública de Pokémons
        async with httpx.AsyncClient() as http_client:
            query = f'name:"{card_name}"'
            if card_number:
                query += f' number:"{card_number}"'
                
            tcg_res = await http_client.get(
                f"https://pokemontcg.io",
                params={"q": query, "pageSize": 1}
            )
            
            if tcg_res.status_code == 200:
                cards = tcg_res.json().get("data", [])
                if cards:
                    matched_card = cards[0]
                    prices = matched_card.get("tcgplayer", {}).get("prices", {})
                    market_price = None
                    
                    # Puxa o primeiro preço disponível no mercado
                    for p_type in ["holofoil", "normal", "reverseHolofoil"]:
                        if p_type in prices:
                            market_price = prices[p_type].get("market")
                            break
                            
                    # Monta o objeto completo enriquecido que a App exige para renderizar
                    return {
                        "success": True,
                        "card": {
                            "id": matched_card.get("id"),
                            "name": matched_card.get("name"),
                            "set_name": matched_card.get("set", {}).get("name"),
                            "number": matched_card.get("number"),
                            "image_url": matched_card.get("images", {}).get("large"),
                            "tcgplayer_market": market_price,
                            "confidence": "high"
                        }
                    }

        # Fallback caso não encontre na API oficial
        return {
            "success": True,
            "card": {
                "name": card_name,
                "set_name": ia_data.get("set_name"),
                "number": card_number,
                "image_url": "https://pokemontcg.io",
                "tcgplayer_market": 5.0,
                "confidence": "medium"
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")

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
