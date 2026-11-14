"""Optional embeddings for meaning-based search.

ASSISTANT_EMBED_PROVIDER chooses where they come from:
  - "ollama": a local model (default bge-m3, which understands Bangla). Nothing leaves your server.
  - "voyage": Voyage AI (needs VOYAGE_API_KEY). Anthropic has no embeddings API of its own.
Without either, the Core ERP searches on words alone, which still works, Bangla included.
"""

import os
from typing import List

import requests

from app.assistant import llm

BATCH = 32


def provider() -> str:
    chosen = os.getenv("ASSISTANT_EMBED_PROVIDER", "").strip().lower()
    if chosen in ("ollama", "voyage"):
        return chosen
    return "voyage" if os.getenv("VOYAGE_API_KEY") else ""


def model() -> str:
    if provider() == "ollama":
        return os.getenv("OLLAMA_EMBED_MODEL", "bge-m3")
    return os.getenv("VOYAGE_MODEL", "voyage-3.5")


def is_configured() -> bool:
    if provider() == "ollama":
        return llm.has_ollama_model(model())
    return provider() == "voyage"


def _ollama(texts: List[str]) -> List[List[float]]:
    response = requests.post(f"{llm.ollama_url()}/api/embed", json={"model": model(), "input": texts, "keep_alive": "30m", "options": llm.ollama_options()},
                             timeout=float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "180")))
    response.raise_for_status()
    return response.json()["embeddings"]


def _voyage(texts: List[str], input_type: str) -> List[List[float]]:
    response = requests.post(
        os.getenv("VOYAGE_API_URL", "https://api.voyageai.com/v1/embeddings"),
        headers={"Authorization": f"Bearer {os.getenv('VOYAGE_API_KEY')}", "Content-Type": "application/json"},
        json={"input": texts, "model": model(), "input_type": input_type},
        timeout=60,
    )
    response.raise_for_status()
    return [item["embedding"] for item in sorted(response.json()["data"], key=lambda item: item["index"])]


def embed(texts: List[str], input_type: str) -> List[List[float]]:
    vectors: List[List[float]] = []
    for start in range(0, len(texts), BATCH):
        batch = texts[start:start + BATCH]
        vectors.extend(_ollama(batch) if provider() == "ollama" else _voyage(batch, input_type))
    return vectors
