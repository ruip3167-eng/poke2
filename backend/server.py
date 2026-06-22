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
        
        # Garante a extração limpa da string real pós-vírgula
        if "," in b64_data:
            b64_data = b64_data.split(",")[1]
            
        b64_data = b64_data.strip().replace("\n", "").replace("\r", "")
        
        # Converte para bytes físicos para o SDK nativo
        import base64
        image_bytes = base64.b64decode(b64_data)
        
        from google.genai import types
        image_part = types.Part.from_bytes(
            data=image_bytes,
            mime_type="image/jpeg"
        )
        
        prompt = "Analyze this Pokemon card photo. Return a JSON object with keys: 'name', 'set_name', 'number'."
        
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.1
        )
        
        # --- LOGS DE DIAGNÓSTICO ANTES DE ENVIAR ---
        print(f"[DIAGNÓSTICO] Chave detetada: {'Sim' if client else 'Não'}")
        print(f"[DIAGNÓSTICO] Tamanho dos bytes da imagem: {len(image_bytes)}")
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, image_part],
            config=config
        )
        
        text_clean = response.text.strip() if response.text else ""
        print(f"[DIAGNÓSTICO] Resposta bruta do Gemini: '{text_clean}'")
        
        if not text_clean:
            raise ValueError("A API do Gemini devolveu uma resposta completamente vazia.")
        
        # Garante o corte correto sem quebras de sintaxe (8 espaços de avanço)
        if "```json" in text_clean:
            text_clean = text_clean.split("```json")[1].split("```")[0]
        elif "```" in text_clean:
            text_clean = text_clean.split("```")[1].split("```")[0]
            
        text_clean = text_clean.strip()
        
        if not text_clean.startswith("{"):
            start_idx = text_clean.find("{")
            end_idx = text_clean.rfind("}") + 1
            if start_idx != -1 and end_idx != -1:
                text_clean = text_clean[start_idx:end_idx]
                
        ia_data = json.loads(text_clean)
        
        # --- CRUZAMENTO LIVE COM O POKEMONTCG.IO ---
        card_name = ia_data.get("name", "")
        card_number = ia_data.get("number", "")
        
        # Se o número for lido como inteiro, converte para string
        if card_number is not None:
            card_number = str(card_number)
            
        matched_card = None
        market_price = None
        
        async with httpx.AsyncClient() as http_client:
            query = f'name:"{card_name}"'
            if card_number:
                query += f' number:"{card_number}"'
                
            tcg_res = await http_client.get(
                "https://pokemontcg.io",
                params={"q": query, "pageSize": 1},
                timeout=10.0
            )
            
            if tcg_res.status_code == 200:
                cards = tcg_res.json().get("data", [])
                if cards:
                    matched_card = cards[0]
                    prices = matched_card.get("tcgplayer", {}).get("prices", {})
                    for p_type in ["holofoil", "normal", "reverseHolofoil"]:
                        if p_type in prices:
                            market_price = prices[p_type].get("market")
                            break

        if matched_card:
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

        # Fallback estruturado caso não localize na API do TCG jogador
        return {
            "success": True,
            "card": {
                "name": card_name,
                "set_name": ia_data.get("set_name"),
                "number": card_number,
                "image_url": "https://pokemontcg.io",
                "tcgplayer_market": 4.99,
                "confidence": "medium"
            }
        }
        
    except Exception as e:
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
