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
            b64_data = b64_data.split(",")
        elif isinstance(b64_data, list) and len(b64_data) > 1:
            b64_data = b64_data
        if isinstance(b64_data, str):
            b64_data = b64_data.strip().replace("\n", "").replace("\r", "")
        image_parts.append({"mime_type": "image/jpeg", "data": b64_data})

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

text_clean = text_clean.strip()
return json.loads(text_clean)
