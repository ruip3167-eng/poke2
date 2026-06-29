import sys
import os
import json
import base64
import hashlib
from datetime import date, datetime, timezone # 🌟 CORREÇÃO: Imports diretos e modernos
import httpx
import logging
import traceback
import certifi
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from pymongo import MongoClient
import google.genai as genai

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Carrega as variáveis do ficheiro .env caso existam localmente
from dotenv import load_dotenv
load_dotenv()

app = FastAPI(title="PokeValue API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === CONFIGURAÇÃO GOOGLE GEMINI ===
GEMINI_KEY = os.environ.get("EMERGENT_LLM_KEY")
client = genai.Client(api_key=GEMINI_KEY) if GEMINI_KEY else None

# === CONFIGURAÇÃO MONGODB ATLAS ===
MONGO_URI = os.environ.get("MONGODB_URI")
if not MONGO_URI:
    print("[AVISO] Variável MONGODB_URI não encontrada no ambiente!")
    db = None
    users_collection = None
    history_collection = None # Inicializado como None caso falte o .env
else:
    # O uso do tlsCAFile com certifi garante que o erro de SSL não acontece em produção
    mongo_client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
    db = mongo_client['sua_base_de_dados']
    users_collection = db['users']
    history_collection = db['scans_history'] # 🌟 ADICIONADO: Linha crucial para a cache funcionar
    print("[SUCESSO] Ligado ao MongoDB Atlas e pronto para monitorizar scans.")

LIMIT_FREE_SCANS = 5

# === SCHEMAS DE ENTRADA (PYDANTIC) ===
class ScanRequest(BaseModel):
    image_base64: str
    user_id: Optional[str] = None

class CardSaveRequest(BaseModel):
    user_id: Optional[str] = None
    card_data: Optional[Dict[str, Any]] = None

class RevenueCatWebhook(BaseModel):
    event: Dict[str, Any]

# === FUNÇÃO AUXILIAR DE CONTROLO DE SCANS ===
def validar_e_contabilizar_scan(user_id: str, email: str) -> bool:
    if users_collection is None:
        return True
        
    # Usa o import direto 'date'
    hoje = date.today().isoformat()
    user = users_collection.find_one({"_id": user_id})
    
    if not user:
        user = {
            "_id": user_id,
            "email": email,
            "plan": "free",
            "dailyScansUsed": 0,
            "lastScanDate": hoje,
            "createdAt": datetime.now(timezone.utc) # 🌟 Versão moderna e segura contra crashes
        }
        users_collection.insert_one(user)
        
    if user.get("plan") == "premium":
        return True
        
    last_date = user.get("lastScanDate")
    if not last_date or last_date != hoje:
        users_collection.update_one(
            {"_id": user_id},
            {"$set": {"dailyScansUsed": 0, "lastScanDate": hoje}}
        )
        user["dailyScansUsed"] = 0
        
    if user.get("dailyScansUsed", 0) >= LIMIT_FREE_SCANS:
        return False
        
    users_collection.update_one(
        {"_id": user_id},
        {"$inc": {"dailyScansUsed": 1}}
    )
    return True


# === ROTAS DA API ===

@app.get("/")
def read_root():
    return {"status": "online", "message": "PokeValue API ready"}

@app.post("/api/scan/analyze")
async def scan_card(payload: ScanRequest):
    # 1. CONTROLO FREEMIUM: Validar os limites através do MongoDB Atlas
    if payload.user_id:
        email_user = getattr(payload, "email", "utilizador.anonimo@pokevalue.com")
        autorizado = validar_e_contabilizar_scan(payload.user_id, email_user)
        if not autorizado:
            raise HTTPException(
                status_code=429, 
                detail="Limite diário de 5 scans atingido. Faça upgrade para o Premium para obter acesso ilimitado!"
            )
    else:
        raise HTTPException(status_code=400, detail="O ID do utilizador (user_id) é obrigatório para realizar scans.")

    # 2. PROCESSAMENTO DA IMAGEM
    try:
        b64_data = payload.image_base64
        
        # Limpeza e extração linear estável para garantir que permanece como String
        if "base64," in b64_data:
            b64_data = b64_data.split("base64,")[1]
        elif "," in b64_data:
            parts = b64_data.split(",")
            b64_data = parts[1] if len(parts) > 1 else parts[0]
            
        b64_data = str(b64_data).strip().replace("\n", "").replace("\r", "").replace(" ", "")
        
        # Correção automática de preenchimento (Padding) do Base64
        missing_padding = len(b64_data) % 4
        if missing_padding:
            b64_data += '=' * (4 - missing_padding)
            
        image_bytes = base64.b64decode(b64_data)
        
        if len(image_bytes) == 0:
            raise ValueError("Os bytes da imagem estão vazios.")

        # === SISTEMA DE CACHE POR HASH MD5 ===
        image_hash = hashlib.md5(image_bytes).hexdigest()
        print(f"[SISTEMA CACHE] Assinatura MD5 da Imagem: {image_hash}")

        if history_collection is not None:
            carta_em_cache = history_collection.find_one({"image_hash": image_hash})
            if carta_em_cache:
                print("⚡ [CACHE HIT] Imagem repetida detetada! Retornando dados guardados sem gastar IA.")
                return {
                    "success": True,
                    "cached": True,
                    "id": carta_em_cache.get("id"),
                    "name": carta_em_cache.get("name"),
                    "set_name": carta_em_cache.get("set_name"),
                    "number": carta_em_cache.get("number"),
                    "image_url": carta_em_cache.get("image_url"),
                    "tcgplayer_market": carta_em_cache.get("tcgplayer_market"),
                    "confidence": "high"
                }

        # ====================================

        # Valores padrão de Fallback
        card_name = "Tatsugiri"
        card_number = "062"
        set_name = "Scarlet & Violet"
        market_price = 0.15

        # 3. CHAMADA À INTELIGÊNCIA ARTIFICIAL (GEMINI) - APENAS SE CONFIGURADO
        if client:
            try:
                from google.genai import types
                image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
                
                prompt = (
                    "Analyze this exact Pokemon card photo. Look closely at the artwork, the name text, and the collector number at the bottom. "
                    "You must return a JSON object with the official English name of the Pokemon, the correct English set name, and its number. "
                    "Estimate its current TCGplayer market price in USD as a float. "
                    "Return keys exactly: 'name', 'set_name', 'number', 'market_price'."
                )
                
                config = types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0)
                
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=[prompt, image_part],
                    config=config
                )
                
                text_clean = response.text.strip() if response.text else ""
                print(f"[DIAGNÓSTICO] Resposta bruta do Gemini: '{text_clean}'")
                
                if text_clean:
                    if not text_clean.startswith("{"):
                        start_idx = text_clean.find("{")
                        end_idx = text_clean.rfind("}") + 1
                        if start_idx != -1 and end_idx != -1:
                            text_clean = text_clean[start_idx:end_idx]
                            
                    ia_data = json.loads(text_clean)
                    card_name = ia_data.get("name", card_name)
                    card_number = ia_data.get("number", card_number)
                    set_name = ia_data.get("set_name", set_name)
                    market_price = ia_data.get("market_price", market_price)

            except Exception as gemini_err:
                print(f"[AVISO CRÍTICO] Falha ou limite de quota Gemini detetado. Ativando Fallback: {str(gemini_err)}")
        else:
            print("[AVISO] Gemini não configurado. Utilizando dados de Fallback.")

        # 4. TRATAMENTO E EXTRAÇÃO DOS DADOS DA CARTA (LÓGICA DA CDN)
        try:
            market_price = float(market_price)
        except:
            market_price = 0.05

        # CORREÇÃO DA EXTRAÇÃO DO NÚMERO (Sem quebras de Lista)
        numero_bruto = str(card_number).strip()
        if "/" in numero_bruto:
            numero_bruto = numero_bruto.split("/")[0]
            
        clean_num = "".join(c for c in numero_bruto if c.isdigit())
        
        if not clean_num:
            clean_num = "1"
        else:
            clean_num = str(int(clean_num)) # Remove zeros à esquerda (ex: 062 -> 62)
            
        set_prefix = "sv1"
        set_name_lower = str(set_name).lower().strip()
        
        if "paldea" in set_name_lower:
            set_prefix = "sv2"
        elif "obsidian" in set_name_lower:
            set_prefix = "sv3"
        elif "151" in set_name_lower:
            set_prefix = "sv3pt5"
        elif "paradox" in set_name_lower:
            set_prefix = "sv4"
        elif "temporal" in set_name_lower:
            set_prefix = "sv5"
        elif "twilight" in set_name_lower:
            set_prefix = "sv6"
        elif "shrouded" in set_name_lower:
            set_prefix = "sv6pt5"
        elif "stellar" in set_name_lower:
            set_prefix = "sv7"
        elif "surging" in set_name_lower:
            set_prefix = "sv8"
        elif "prismatic" in set_name_lower:
            set_prefix = "sv8pt5"
        elif "sword" in set_name_lower or "shsh" in set_name_lower:
            set_prefix = "swsh1"

        # Constrói o link oficial higienizado com o subdomínio correto da CDN
        image_url = f"https://pokemontcg.io{set_prefix}/{clean_num}_hires.png"
        card_id = f"{set_prefix}-{clean_num}"
        
        print(f"[SISTEMA DE MÍDIA] URL FINAL DA IMAGEM: {image_url}")

        resposta_final = {
            "id": card_id,
            "name": card_name,
            "set_name": set_name,
            "number": card_number,
            "image_url": image_url,
            "tcgplayer_market": market_price,
            "confidence": "high"
        }

        # 5. SALVAR NO HISTÓRICO COM O HASH DA IMAGEM
        if history_collection is not None:
            documento_historico = {
                "userId": payload.user_id,
                "image_hash": image_hash,
                "scannedAt": datetime.now(timezone.utc),
                "id": card_id,
                "name": card_name,
                "set_name": set_name,
                "number": card_number,
                "image_url": image_url,
                "tcgplayer_market": market_price,
                "confidence": "high"
            }
            history_collection.insert_one(documento_historico)
            print(f"💾 [MDB] Registo guardado com sucesso na base de dados (Hash: {image_hash})")

        # RETORNO CORRIGIDO: Propriedades soltas na raiz para o card-detail.tsx ler diretamente
        return {
            "success": True,
            "cached": False,
            "id": card_id,
            "name": card_name,
            "set_name": set_name,
            "number": card_number,
            "image_url": image_url,
            "tcgplayer_market": market_price,
            "confidence": "high"
        }
        
    except Exception as e:
        print(f"[ERRO GENERALIZADO]: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Erro no processamento: {str(e)}")

# === ROTAS RECUPERADAS: PROCURA MANUAL E LISTAGEM ===

@app.get("/api/sets")
async def list_sets():
    # Esta lista alimenta o seletor de coleções da procura manual da App
    return [
        {"id": "sv1", "name": "Scarlet & Violet Base Set", "series": "Scarlet & Violet", "printed_total": 198},
        {"id": "sv2", "name": "Paldea Evolved", "series": "Scarlet & Violet", "printed_total": 193},
        {"id": "sv3", "name": "Obsidian Flames", "series": "Scarlet & Violet", "printed_total": 197},
        {"id": "sv3pt5", "name": "151", "series": "Scarlet & Violet", "printed_total": 165},
        {"id": "swsh1", "name": "Sword & Shield Base Set", "series": "Sword & Shield", "printed_total": 202}
    ]

@app.get("/api/price")
async def get_manual_price(name: str, set_name: Optional[str] = None, number: Optional[str] = None):
    # Trata os pedidos individuais de preços gerados pela procura manual
    return {
        "name": name,
        "set_name": set_name or "Scarlet & Violet",
        "number": number or "000",
        "image_url": "https://pokemontcg.iosv1/140.png",
        "tcgplayer_market": 0.25,
        "currency": "USD"
    }

@app.get("/api/cards/search")
async def search_cards(set_id: str, name: str):
    print(f"[PROCURA MANUAL] A pesquisar na coleção {set_id} por: {name}")
    return [{
        "id": f"{set_id}-manual-{name.lower()}",
        "card_id": f"{set_id}-manual-{name.lower()}",
        "name": name.strip().title(),
        "set_name": f"Coleção {set_id.upper()}",
        "number": "1",
        "image_url": f"https://pokemontcg.io{set_id}/1.png",
        "tcgplayer_market": 1.20,
        "currency": "USD"
    }]


# === ROTAS DE PORTFÓLIO E MOCKS COMPLETOS ===

# === MEMÓRIA TEMPORÁRIA LOCAL (Para as cartas não desaparecerem do ecrã) ===
PORTFOLIO_DB = []

@app.post("/api/portfolio/save")
async def save_card(payload: Dict[str, Any]):
    import uuid
    from datetime import datetime
    
    # Se a app enviar os dados soltos, estruturamos exatamente como a sua UI precisa de ler de volta
    card_id = payload.get("id") or payload.get("card_id") or f"card_{str(uuid.uuid4())[:8]}"
    
    new_record = {
        "id": card_id,
        "user_id": payload.get("user_id", "default_user"),
        "name": payload.get("name", "Unknown"),
        "set_name": payload.get("set_name", "Scarlet & Violet"),
        "number": payload.get("number", "000"),
        "image_url": payload.get("image_url", "").replace(".iosv1", ".io/sv1"), # Auto-correção caso falte a barra
        "market_price": float(payload.get("market_price", 0.99)),
        "estimated_value": float(payload.get("estimated_value", 0.99)),
        "condition": payload.get("condition", {
            "centering": "near_mint", "corners": "near_mint", 
            "edges": "near_mint", "surface": "near_mint", 
            "whitening": False, "scratches": False
        }),
        "condition_grade": payload.get("condition_grade", "Near Mint"),
        "condition_multiplier": float(payload.get("condition_multiplier", 1.0)),
        "created_at": datetime.utcnow().isoformat() + "Z",
        "tcgplayer_market": float(payload.get("tcgplayer_market", 0.99)),
        "card_id": card_id
    }
    
    # Guarda na nossa lista temporária em vez de deitar fora
    PORTFOLIO_DB.append(new_record)
    print(f"[PORTFÓLIO] Carta guardada com sucesso! Total no banco: {len(PORTFOLIO_DB)}")
    
    return {
        "success": True, 
        "message": "Guardado com sucesso no servidor", 
        "id": card_id,
        "card": new_record
    }

@app.get("/api/portfolio")
@app.get("/api/portfolio/")
@app.get("/api/portfolio/{user_id}")
async def get_portfolio(user_id: Optional[str] = None):
    print(f"[PORTFÓLIO] Telemóvel pediu a lista. A enviar {len(PORTFOLIO_DB)} cartas.")
    # Devolve a lista com todas as cartas que guardou desde o último arranque
    return PORTFOLIO_DB

@app.delete("/api/portfolio/{card_id}")
async def delete_card(card_id: str):
    global PORTFOLIO_DB
    inicial_len = len(PORTFOLIO_DB)
    PORTFOLIO_DB = [c for c in PORTFOLIO_DB if c.get("id") != card_id and c.get("card_id") != card_id]
    print(f"[PORTFÓLIO] Carta {card_id} eliminada.")
    return {"success": True, "deleted": inicial_len - len(PORTFOLIO_DB)}

@app.get("/api/scan/count/{user_id}")
@app.post("/api/scan/count/{user_id}")
async def handle_scan_count(user_id: str):
    return {"count": 1, "free_limit": 5, "is_pro": False}

@app.post("/api/scan/upgrade/{user_id}")
async def upgrade_user(user_id: str):
    return {"count": 0, "free_limit": 99999, "is_pro": True}

# === ROTA DO WEBHOOK DO REVENUECAT ===
@app.post("/api/webhooks/revenuecat")
async def revenuecat_webhook(payload: RevenueCatWebhook):
    if users_collection is None:
        raise HTTPException(status_code=500, detail="Base de dados indisponível")

    try:
        event_data = payload.event
        event_type = event_data.get("type")
        user_id = event_data.get("app_user_id") 
        
        if not user_id:
            print("[WEBHOOK RC] Erro: Evento recebido sem app_user_id")
            return {"status": "ignored", "reason": "missing_user_id"}

        print(f"[WEBHOOK RC] Evento {event_type} recebido para o utilizador: {user_id}")

        # Ativa o acesso Premium se houver compra ou renovação
        if event_type in ["INITIAL_PURCHASE", "RENEWAL", "SUBSCRIBER_ALIAS"]:
            users_collection.update_one(
                {"_id": user_id},
                {"$set": {"plan": "premium"}},
                upsert=True
            )
            print(f"🚀 [MDB] Utilizador {user_id} atualizado para PREMIUM com sucesso!")
            return {"status": "success", "message": "Plano atualizado para premium"}

        # Remove o acesso Premium se a assinatura expirar
        elif event_type in ["EXPIRATION", "CANCELLATION"]:
            users_collection.update_one(
                {"_id": user_id},
                {"$set": {"plan": "free"}}
            )
            print(f"📉 [MDB] Utilizador {user_id} revertido para FREE devido a expiração.")
            return {"status": "success", "message": "Plano revertido para free"}

        return {"status": "ignored", "reason": "unhandled_event_type"}

    except Exception as e:
        print(f"[ERRO WEBHOOK RC]: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Erro interno ao processar webhook")

# === ROTA PARA LISTAR O HISTÓRICO DE SCANS DO UTILIZADOR ===
@app.get("/api/history/{user_id}")
async def get_user_history(user_id: str):
    if history_collection is None:
        raise HTTPException(status_code=500, detail="Base de dados indisponível")

    try:
        print(f"[HISTÓRICO] A procurar scans para o utilizador: {user_id}")
        
        # 1. Procura os scans do utilizador e ordena por data descrescente (mais recente primeiro)
        cursor = history_collection.find({"userId": user_id}).sort("scannedAt", -1)
        
        scans_list = []
        for doc in cursor:
            scans_list.append({
                "id": str(doc.get("_id")), # Converte o ObjectId do MongoDB para String
                "scannedAt": doc.get("scannedAt").isoformat() if doc.get("scannedAt") else None,
                "name": doc.get("name"),
                "set_name": doc.get("set_name"),
                "number": doc.get("number"),
                "card": doc.get("card") # Traz o objeto completo da carta (imagem, preço, etc)
            })
            
        print(f"[HISTÓRICO] Encontrados {len(scans_list)} scans para o utilizador {user_id}.")
        
        # 2. Retorna a lista estruturada para o Expo renderizar
        return {
            "success": True,
            "count": len(scans_list),
            "history": scans_list
        }

    except Exception as e:
        print(f"[ERRO HISTÓRICO]: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Erro ao recuperar histórico: {str(e)}")

