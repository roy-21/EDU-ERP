import base64
import json
import io
from types import SimpleNamespace

import pytest
import requests
from docx import Document
from fastapi.testclient import TestClient

from app.assistant import llm
from app.config import settings
from app.main import app

client = TestClient(app)
AUTH = {"X-Service-Token": settings.SERVICE_SECRET}


def tiny_pdf(text: str) -> bytes:
    """A one-page PDF with real text, built by hand so the test needs no PDF writer."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def test_assistant_endpoints_need_the_service_token():
    assert client.get("/api/v1/voice/assistant/status").status_code == 401
    assert client.get("/api/v1/voice/assistant/status", headers={"X-Service-Token": "wrong"}).status_code == 401
    assert client.get("/api/v1/voice/assistant/status", headers=AUTH).status_code == 200


def test_extracts_text_from_pdf_and_docx():
    res = client.post("/api/v1/voice/assistant/extract", headers=AUTH,
                      json={"file_name": "rules.pdf", "mime_type": "application/pdf", "content_base64": b64(tiny_pdf("Library closes at 8 pm on weekdays"))})
    assert res.status_code == 200, res.text
    assert "Library closes at 8 pm" in res.json()["data"]["text"]

    doc = Document()
    doc.add_paragraph("Hostel gate closes at 10 pm.")
    table = doc.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Admission fee"
    table.rows[0].cells[1].text = "5000 Taka"
    buffer = io.BytesIO()
    doc.save(buffer)
    res = client.post("/api/v1/voice/assistant/extract", headers=AUTH,
                      json={"file_name": "hostel.docx", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content_base64": b64(buffer.getvalue())})
    assert res.status_code == 200, res.text
    text = res.json()["data"]["text"]
    assert "Hostel gate closes at 10 pm." in text and "Admission fee | 5000 Taka" in text


def test_broken_files_are_refused_clearly():
    res = client.post("/api/v1/voice/assistant/extract", headers=AUTH,
                      json={"file_name": "bad.pdf", "mime_type": "application/pdf", "content_base64": b64(b"%PDF-1.4 not really")})
    assert res.status_code == 422
    res = client.post("/api/v1/voice/assistant/extract", headers=AUTH, json={"file_name": "x.pdf", "mime_type": "application/pdf", "content_base64": "@@@"})
    assert res.status_code == 400


class FakeMessages:
    def __init__(self, parsed, stop_reason="end_turn"):
        self.parsed = parsed
        self.stop_reason = stop_reason
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason=self.stop_reason, parsed_output=self.parsed, model=kwargs["model"])


def fake_client(parsed, stop_reason="end_turn"):
    messages = FakeMessages(parsed, stop_reason)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


PASSAGES = [{"id": "c1", "title": "Hostel rules", "text": "The hostel gate closes at 10 pm."}]


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setenv("ASSISTANT_LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("ASSISTANT_MODEL", raising=False)
    yield
    llm.set_client(None)


def test_answer_without_a_model_key_is_503(monkeypatch):
    monkeypatch.delenv("ASSISTANT_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    res = client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "When does the gate close?", "passages": PASSAGES})
    assert res.status_code == 503


def test_grounded_answer_cites_the_given_passages(with_key):
    fake, messages = fake_client(llm.GroundedAnswer(answerable=True, answer="The gate closes at 10 pm.", used_source_ids=["c1"]))
    llm.set_client(fake)
    res = client.post("/api/v1/voice/assistant/answer", headers=AUTH,
                      json={"question": "When does the gate close?", "language": "en", "institution": "Test College", "passages": PASSAGES})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data == {"answerable": True, "answer": "The gate closes at 10 pm.", "used_source_ids": ["c1"], "model": "claude-opus-5-5"}
    call = messages.calls[0]
    assert call["model"] == "claude-opus-5-5" and call["fallbacks"] == "default"
    assert "only the passages" in call["system"] and "Test College" in call["system"]
    assert '<passage id="c1"' in call["messages"][0]["content"]
    assert "tools" not in call, "the model is never given tools"


def test_an_answer_citing_nothing_it_was_given_is_not_used(with_key):
    fake, _ = fake_client(llm.GroundedAnswer(answerable=True, answer="Made up.", used_source_ids=["c99"]))
    llm.set_client(fake)
    data = client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "q?", "passages": PASSAGES}).json()["data"]
    assert data["answerable"] is False and data["answer"] == ""


def test_not_answerable_and_refusals_give_no_answer(with_key):
    fake, _ = fake_client(llm.GroundedAnswer(answerable=False, answer="", used_source_ids=[]))
    llm.set_client(fake)
    assert client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "q?", "passages": PASSAGES}).json()["data"]["answerable"] is False
    fake, _ = fake_client(None, stop_reason="refusal")
    llm.set_client(fake)
    assert client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "q?", "passages": PASSAGES}).json()["data"]["answerable"] is False


def test_draft_keeps_to_the_staff_answer(with_key):
    fake, messages = fake_client(llm.Draft(draft="The library is open until 8 pm."))
    llm.set_client(fake)
    res = client.post("/api/v1/voice/assistant/draft", headers=AUTH, json={"question": "Library hours?", "received_answer": "till 8pm", "language": "en"})
    assert res.json()["data"]["draft"] == "The library is open until 8 pm."
    assert "add nothing" in messages.calls[0]["system"]


def test_embeddings_need_a_provider(monkeypatch):
    monkeypatch.delenv("ASSISTANT_EMBED_PROVIDER", raising=False)
    monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
    res = client.post("/api/v1/voice/assistant/embed", headers=AUTH, json={"texts": ["hello"], "input_type": "query"})
    assert res.status_code == 503


# ---- Own model through Ollama -------------------------------------------------------------

class FakeResponse:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@pytest.fixture
def with_ollama(monkeypatch):
    monkeypatch.setenv("ASSISTANT_LLM_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_MODEL", "qwen2.5:7b")
    monkeypatch.setenv("ASSISTANT_EMBED_PROVIDER", "ollama")
    monkeypatch.setenv("OLLAMA_EMBED_MODEL", "bge-m3")
    sent = []
    state = {"reply": None, "models": ["qwen2.5:7b", "bge-m3:latest"], "down": False}

    def fake_get(url, timeout=None):
        if state["down"]:
            raise requests.ConnectionError("down")
        return FakeResponse(200, {"models": [{"name": name} for name in state["models"]]})

    def fake_post(url, json=None, timeout=None, headers=None):
        sent.append((url, json))
        if state["down"]:
            raise requests.ConnectionError("down")
        if url.endswith("/api/embed"):
            return FakeResponse(200, {"embeddings": [[0.1, 0.2, 0.3] for _ in json["input"]]})
        return FakeResponse(200, {"message": {"content": state["reply"]}})

    monkeypatch.setattr(llm.requests, "get", fake_get)
    monkeypatch.setattr(llm.requests, "post", fake_post)
    llm.ollama_models(fresh=True)
    yield state, sent
    llm._ollama_check["at"] = 0


def test_ollama_answers_from_the_passages(with_ollama):
    state, sent = with_ollama
    state["reply"] = json.dumps({"answerable": True, "answer": "The gate closes at 10 pm.", "used_source_ids": ["c1"]})
    status = client.get("/api/v1/voice/assistant/status", headers=AUTH).json()["data"]
    assert status["llm"] is True and status["provider"] == "ollama" and status["model"] == "qwen2.5:7b"
    assert status["embeddings"] is True and status["embedding_model"] == "bge-m3"
    data = client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "When does the gate close?", "passages": PASSAGES}).json()["data"]
    assert data == {"answerable": True, "answer": "The gate closes at 10 pm.", "used_source_ids": ["c1"], "model": "qwen2.5:7b"}
    url, body = sent[-1]
    assert url.endswith("/api/chat") and body["model"] == "qwen2.5:7b" and body["options"]["temperature"] == 0
    assert body["format"]["properties"]["answerable"]["type"] == "boolean", "the reply is held to the JSON schema"
    assert "tools" not in body


def test_ollama_bad_json_or_ungrounded_reply_is_no_answer(with_ollama):
    state, _ = with_ollama
    state["reply"] = "Sure! The gate closes at 10."
    assert client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "q?", "passages": PASSAGES}).json()["data"]["answerable"] is False
    state["reply"] = json.dumps({"answerable": True, "answer": "Invented", "used_source_ids": []})
    assert client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "q?", "passages": PASSAGES}).json()["data"]["answerable"] is False


def test_ollama_down_or_model_missing_is_503(with_ollama):
    state, _ = with_ollama
    state["models"] = ["bge-m3:latest"]
    llm.ollama_models(fresh=True)
    res = client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "q?", "passages": PASSAGES})
    assert res.status_code == 503 and "ollama pull qwen2.5:7b" in res.json()["detail"]
    state["models"] = ["qwen2.5:7b", "bge-m3:latest"]
    llm.ollama_models(fresh=True)
    state["down"] = True
    res = client.post("/api/v1/voice/assistant/answer", headers=AUTH, json={"question": "q?", "passages": PASSAGES})
    assert res.status_code == 503


def test_ollama_embeddings(with_ollama):
    data = client.post("/api/v1/voice/assistant/embed", headers=AUTH, json={"texts": ["a", "b"], "input_type": "document"}).json()["data"]
    assert data["model"] == "bge-m3" and len(data["vectors"]) == 2


@pytest.mark.parametrize("answer, source, expected", [
    ("The fine for returning a library book late is 5 taka.", "The gate closes at 10 pm. বই দেরিতে ফেরত দিলে প্রতিদিন ৫ টাকা জরিমানা।", True),
    ("The fine is 50 taka.", "The gate closes at 10 pm. বই দেরিতে ফেরত দিলে প্রতিদিন ৫ টাকা জরিমানা।", False),
    ("The gate closes at 10 pm.", "The hostel gate closes at 10 pm every night.", True),
    ("The gate closes at 11 pm.", "The hostel gate closes at 10 pm every night.", False),
    ("Students may bring guests any day after lunch.", "Visitors are allowed from 4 pm to 6 pm on Fridays only.", False),
    ("হোস্টেলের মূল গেট প্রতি রাত ১০টায় বন্ধ হয়।", "হোস্টেলের মূল গেট প্রতি রাত ১০টায় বন্ধ হয়।", True),
    ("হোস্টেলের নিয়ম", "হোস্টেলের মূল গেট প্রতি রাত ১০টায় বন্ধ হয়।", False),
    ("গেট রাত ১১টায় বন্ধ হয়।", "হোস্টেলের মূল গেট প্রতি রাত ১০টায় বন্ধ হয়।", False),
    ("The gate closes at 10 pm.", "হোস্টেলের মূল গেট প্রতি রাত ১০টায় বন্ধ হয়।", True),
])
def test_answers_must_be_backed_by_the_cited_passages(answer, source, expected):
    assert llm.is_supported(answer, source, [{"id": "c", "title": "হোস্টেলের নিয়ম"}]) is expected
