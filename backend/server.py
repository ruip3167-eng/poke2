import sys  
import os  
from fastapi import FastAPI, HTTPException, UploadFile, File  
from fastapi.middleware.cors import CORSMiddleware  
import google.generativeai as genai  
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

# Inicializa a API da Google Gemini
GEMINI_KEY = os.environ.get("EMERGENT_LLM_KEY")
if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY)
    model = genai.GenerativeModel('gemini-1.5-flash')
else:
    model = None


@app.get("/")
def read_root():
    return {"status": "online", "message": "PokeValue API ready"}

@app.post("/scan")
async def scan_card(file: UploadFile = File(...)):
    if not model:
        raise HTTPException(status_code=500, detail="Gemini API Key não configurada")
        
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Imagem inválida")
            
        _, buffer = cv2.imencode('.jpg', img)
        b64_data = base64.b64encode(buffer).decode('utf-8')
        
        prompt = "Analyze this Pokemon card photo. Return ONLY a raw JSON object with keys: 'name', 'set_name', 'number', and 'confidence'. Do not explain anything."
        
        image_part = {"mime_type": "image/jpeg", "data": b64_data}
        response = model.generate_content([prompt, image_part])
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
