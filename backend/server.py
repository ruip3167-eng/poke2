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

# Mude a linha do import do UploadFile no topo, ou garanta que usa assim:
from fastapi import UploadFile, File

@app.post("/api/scan/analyze")
async def scan_card(payload: ScanRequest):
    if not client:
        raise HTTPException(status_code=500, detail="Gemini API Client não configurado")
        
    try:
        b64_data = payload.image_base64
        
        if "," in b64_data:
            b64_data = b64_data.split(",")[1]
            
        b64_data = b64_data.strip().replace("\n", "").replace("\r", "")
        
        # Converte a string de texto recebida de volta para bytes físicos
        import base64
        image_bytes = base64.b64decode(b64_data)
        
        # --- LOGS DE DIAGNÓSTICO ---
        print(f"[DIAGNÓSTICO] Chave detetada: {'Sim' if client else 'Não'}")
        print(f"[DIAGNÓSTICO] Tamanho dos bytes da imagem descodificada: {len(image_bytes)}")
        
        if len(image_bytes) == 0:
            raise ValueError("Os bytes da imagem descodificada estão vazios.")

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
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, image_part],
            config=config
        )
        
        text_clean = response.text.strip() if response.text else ""
        print(f"[DIAGNÓSTICO] Resposta bruta do Gemini: '{text_clean}'")
        
        if not text_clean:
            raise ValueError("A API do Gemini devolveu uma resposta completamente vazia.")
            
        if not text_clean.startswith("{"):
            start_idx = text_clean.find("{")
            end_idx = text_clean.rfind("}") + 1
            if start_idx != -1 and end_idx != -1:
                text_clean = text_clean[start_idx:end_idx]
                
        ia_data = json.loads(text_clean)
        
        card_name = ia_data.get("name", "")
        card_number = ia_data.get("number", "")
        
        # === AQUI ESTÁ A CORREÇÃO BLINDADA DO SLICE [0] ===
        if card_number:
            card_str = str(card_number).strip()
            if "/" in card_str:
                card_str = card_str.split("/")[0].strip()
            card_number = card_str.lstrip("0")
            if not card_number:
                card_number = "0"
            
        matched_card = None
        market_price = None
        headers = {
            "User-Agent": "PokeValueApp/1.0 (Contact: rui@PokeValue.com)",
            "Accept": "application/json"
        }
        
        try:
            async with httpx.AsyncClient() as http_client:
                query = f'name:"{card_name}"'
                if card_number:
                    query += f' number:"{card_number}"'
                    
                tcg_res = await http_client.get(
                    "https://pokemontcg.io",
                    params={"q": query, "pageSize": 1},
                    headers=headers,
                    timeout=8.0
                )
                
                if tcg_res.status_code == 200:
                    cards_list = tcg_res.json().get("data", [])
                    if isinstance(cards_list, list) and len(cards_list) > 0:
                        matched_card = cards_list[0]
                else:
                    print(f"[DIAGNÓSTICO] API Pokémon respondeu com status: {tcg_res.status_code}")
                        
        except Exception as tcg_err:
            print(f"[DIAGNÓSTICO] Erro ao consultar a API Pokémon: {str(tcg_err)}")

        if matched_card:
            prices = matched_card.get("tcgplayer", {}).get("prices", {})
            for p_type in ["holofoil", "normal", "reverseHolofoil"]:
                if p_type in prices:
                    market_price = prices[p_type].get("market")
                    break
            
            return {
                "success": True,
                "card": {
                    "id": matched_card.get("id"),
                    "name": matched_card.get("name"),
                    "set_name": matched_card.get("set", {}).get("name"),
                    "number": matched_card.get("number"),
                    "image_url": matched_card.get("images", {}).get("large"),
                    "tcgplayer_market": market_price if market_price else 0.99,
                    "confidence": "high"
                }
            }

        return {
            "success": True,
            "card": {
                "id": f"fallback_{card_number}",
                "name": card_name,
                "set_name": ia_data.get("set_name", "Unknown Set"),
                "number": card_number,
                "image_url": "https://pokemontcg.io",
                "tcgplayer_market": 1.50,
                "confidence": "medium"
            }
        }
        
    except Exception as e:
        import traceback
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
