"""Voice & Message Assistant Backend: the message assistant engine (answers, document reading,
embeddings, answer drafts). Only the Core ERP calls these."""

import base64
import binascii
import hmac
from typing import List, Optional

import anthropic
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.assistant import embeddings, llm
from app.assistant.extract import ExtractError, extract_text

router = APIRouter(prefix="/api/v1/voice/assistant")


# These endpoints always need the service token, also in development: they spend money
# on the language model and read institution documents.
def require_service(x_service_token: Optional[str] = Header(None)):
    if not x_service_token or not hmac.compare_digest(x_service_token, settings.SERVICE_SECRET):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Service-Token")
    return True


class ExtractRequest(BaseModel):
    file_name: str = Field(max_length=255)
    mime_type: str = Field(max_length=120)
    content_base64: str


class EmbedRequest(BaseModel):
    texts: List[str] = Field(min_length=1, max_length=512)
    input_type: str = Field(pattern="^(document|query)$")


class PassageIn(BaseModel):
    id: str = Field(max_length=64)
    title: str = Field(max_length=300)
    text: str = Field(max_length=20000)


class AnswerRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    language: str = Field(default="en", pattern="^(en|bn)$")
    institution: str = Field(default="", max_length=200)
    passages: List[PassageIn] = Field(min_length=1, max_length=12)


class DraftRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    received_answer: str = Field(min_length=1, max_length=5000)
    language: str = Field(default="en", pattern="^(en|bn)$")


def ok(data):
    return {"success": True, "statusCode": 200, "data": data}


@router.get("/status")
def status(_=Depends(require_service)):
    if llm.provider() == "ollama":
        llm.ollama_models(fresh=True)
    ready = llm.is_configured()
    embedding_ready = embeddings.is_configured()
    return ok({
        "llm": ready,
        "provider": llm.provider(),
        "model": llm.model() if ready else "",
        "llm_problem": "" if ready else llm.why_not_configured(),
        "embeddings": embedding_ready,
        "embedding_provider": embeddings.provider(),
        "embedding_model": embeddings.model() if embedding_ready else "",
        "extract": ["pdf", "docx"],
    })


@router.post("/extract")
def extract(req: ExtractRequest, _=Depends(require_service)):
    try:
        content = base64.b64decode(req.content_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The file content is not valid base64.")
    try:
        text = extract_text(req.file_name, content)
    except ExtractError as err:
        raise HTTPException(status_code=422, detail=str(err))
    return ok({"text": text, "characters": len(text)})


@router.post("/embed")
def embed(req: EmbedRequest, _=Depends(require_service)):
    if not embeddings.is_configured():
        raise HTTPException(status_code=503, detail="No embedding model is ready (set ASSISTANT_EMBED_PROVIDER=ollama and pull bge-m3, or set VOYAGE_API_KEY).")
    try:
        vectors = embeddings.embed(req.texts, req.input_type)
    except Exception as err:
        raise HTTPException(status_code=503, detail=f"The embedding model failed: {err.__class__.__name__}")
    return ok({"vectors": vectors, "model": embeddings.model()})


def _llm_errors(err: Exception):
    if isinstance(err, llm.ModelUnavailable):
        raise HTTPException(status_code=503, detail=str(err))
    if isinstance(err, anthropic.AuthenticationError):
        raise HTTPException(status_code=503, detail="The language model key is not valid.")
    if isinstance(err, (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.InternalServerError)):
        raise HTTPException(status_code=503, detail=f"The language model is unavailable right now: {err.__class__.__name__}")
    if isinstance(err, anthropic.APIStatusError):
        raise HTTPException(status_code=502, detail=f"The language model returned an error: {err.status_code}")
    raise err


@router.post("/answer")
def answer(req: AnswerRequest, _=Depends(require_service)):
    if not llm.is_configured():
        raise HTTPException(status_code=503, detail=llm.why_not_configured())
    try:
        result = llm.answer(req.question, req.language, req.institution, [p.model_dump() for p in req.passages])
    except Exception as err:
        _llm_errors(err)
    return ok(result)


@router.post("/draft")
def draft(req: DraftRequest, _=Depends(require_service)):
    if not llm.is_configured():
        raise HTTPException(status_code=503, detail=llm.why_not_configured())
    try:
        text = llm.draft(req.question, req.received_answer, req.language)
    except Exception as err:
        _llm_errors(err)
    return ok({"draft": text})
