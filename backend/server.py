import sys  
import os  
from fastapi import FastAPI, HTTPException, UploadFile, File 
from pydantic import BaseModel 
from fastapi.middleware.cors import CORSMiddleware  
from google import genai
from typing import Dict, Any, Optional
import cv2  
import numpy as np  
import json  
import base64



### Garante o mapeamento correto de caminhos locais

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

app = FastAPI(title="PokeValue API")

### Configuração do CORS para o telemóvel se ligar sem bloqueios de segurança

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializa o cliente oficial moderno da Google Gemini
GEMINI_KEY = os.environ.get("EMERGENT_LLM_KEY")
if GEMINI_KEY:
    client = genai.Client(api_key=GEMINI_KEY)
else:
    client = None


@app.get("/")
def read_root():
    return {"status": "online", "message": "PokeValue API ready"}

class ScanRequest(BaseModel):
    image_base64: str
    user_id: Optional[str] = None

@app.post("/api/scan/analyze")
async def scan_card(payload: ScanRequest):
    if not client:
        raise HTTPException(status_code=500, detail="Gemini API Client não configurado")
        
    try:
        b64_data = payload.image_base64
        
        # Limpa o cabeçalho data:image/jpeg;base64, caso o telemóvel o envie
        if "," in b64_data:
            b64_data = b64_data.split(",")[1]
            
        b64_data = b64_data.strip().replace("\n", "").replace("\r", "")
        
        prompt = "Analyze this Pokemon card photo. Return ONLY a raw JSON object with keys: 'name', 'set_name', 'number', and 'confidence'. Do not explain anything or write markdown formatting code."
        
        # FORMATO CORRIGIDO PARA O NOVO SDK GOOGLE-GENAI
        image_part = {
            "inline_data": {
                "mime_type": "image/jpeg",
                "data": b64_data
            }
        }
        
        # Chamada oficial do novo SDK cliente
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, image_part]
        )
        text_clean = response.text.strip()
        
        if "```json" in text_clean:
            text_clean = text_clean.split("```json")[1].split("```")[0]
        elif "```" in text_clean:
            text_clean = text_clean.split("```")[1].split("```")[0]
            
        card_data = json.loads(text_clean.strip())
        return {"success": True, "card": card_data}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro no processamento: {str(e)}")

@app.on_event("shutdown")
def shutdown_event():
    print("Servidor a encerrar...")


# --- ROTAS DE PORTFÓLIO E CONTROLO DE SCANS (MOCKS TEMPORÁRIOS) ---

class CardSaveRequest(BaseModel):
    user_id: str
    card_data: Dict[str, Any]

# --- ROTAS DE PORTFÓLIO E CONTROLO DE SCANS ---
@app.get("/api/portfolio")
@app.get("/api/portfolio/")
async def get_portfolio_empty():
    return []

@app.get("/api/portfolio/{user_id}")
async def get_portfolio(user_id: str):
    return []

@app.post("/api/portfolio/save")
async def save_card(payload: CardSaveRequest):
    return {"success": True, "message": "Carta guardada no simulador", "id": "mock_card_123"}

@app.delete("/api/portfolio/{card_id}")
async def delete_card(card_id: str):
    return {"success": True, "deleted": 1}

@app.get("/api/scan/count/{user_id}")
async def get_scan_count(user_id: str):
    return {"count": 0, "free_limit": 5, "is_pro": False}

@app.post("/api/scan/count/{user_id}")
async def increment_scan_count(user_id: str):
    return {"count": 1, "free_limit": 5, "is_pro": False}

@app.post("/api/scan/upgrade/{user_id}")
async def upgrade_user(user_id: str):
    return {"count": 0, "free_limit": 99999, "is_pro": True}



