"""Speech on the institution's own server: nothing is sent to an outside service.

  - Speech to text: Whisper (faster-whisper, int8 on CPU). Understands Bangla and English.
  - Text to speech: Meta's MMS voices (facebook/mms-tts-ben, facebook/mms-tts-eng).

Models download once (to the Hugging Face cache) and load on first use. One speech job runs at
a time, so a small server is not overloaded; others wait their turn.
"""

import io
import os
import re
import threading
import time
import wave
from typing import Optional, Tuple

import app.config  # noqa: F401  (loads apps/voice-api/.env)
from app.voice.numbers import speakable

# Whisper "small" is fast and fine for English but cannot read Bangla; "large-v3-turbo" can.
# The small model also decides which language was spoken when the caller did not say.
STT_MODEL = os.getenv("VOICE_STT_MODEL", "small")
STT_MODELS = {"en": os.getenv("VOICE_STT_MODEL_EN", STT_MODEL), "bn": os.getenv("VOICE_STT_MODEL_BN", "large-v3-turbo")}
TTS_MODELS = {"bn": os.getenv("VOICE_TTS_MODEL_BN", "facebook/mms-tts-ben"), "en": os.getenv("VOICE_TTS_MODEL_EN", "facebook/mms-tts-eng")}
MAX_SECONDS = int(os.getenv("VOICE_MAX_SECONDS", "60"))

_lock = threading.Lock()
_whispers = {}
_voices = {}
_errors = {}


class SpeechUnavailable(Exception):
    pass


def _threads() -> int:
    value = os.getenv("VOICE_CPU_THREADS", "")
    return int(value) if value.isdigit() else max(1, (os.cpu_count() or 4))


def _load_whisper(name: str = STT_MODEL):
    if name not in _whispers:
        try:
            from faster_whisper import WhisperModel
        except ImportError as err:
            raise SpeechUnavailable("faster-whisper is not installed in this environment.") from err
        _whispers[name] = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=_threads())
    return _whispers[name]


def _load_voice(language: str):
    if language not in _voices:
        try:
            import torch
            from transformers import AutoTokenizer, VitsModel
        except ImportError as err:
            raise SpeechUnavailable("torch and transformers are not installed in this environment.") from err
        torch.set_num_threads(_threads())
        name = TTS_MODELS[language]
        _voices[language] = (VitsModel.from_pretrained(name).eval(), AutoTokenizer.from_pretrained(name))
    return _voices[language]


def status() -> dict:
    def installed(module: str) -> bool:
        try:
            __import__(module)
            return True
        except ImportError:
            return False

    stt = installed("faster_whisper")
    tts = installed("transformers") and installed("torch")
    return {
        "stt": stt, "stt_model": ", ".join(f"{lang}: whisper-{name}" for lang, name in STT_MODELS.items()) if stt else "", "stt_loaded": sorted(_whispers),
        "tts": tts, "tts_models": TTS_MODELS if tts else {}, "tts_loaded": sorted(_voices),
        "max_seconds": MAX_SECONDS, "errors": dict(_errors),
    }


def warm_up() -> None:
    """Loads the models in the background so the first call does not wait for them."""
    loaders = [("stt", _load_whisper)] + [(f"stt_{lang}", lambda name=name: _load_whisper(name)) for lang, name in STT_MODELS.items()]
    for name, loader in loaders + [("tts_bn", lambda: _load_voice("bn")), ("tts_en", lambda: _load_voice("en"))]:
        try:
            with _lock:
                loader()
            _errors.pop(name, None)
        except Exception as err:
            _errors[name] = f"{err.__class__.__name__}: {err}"[:300]


# ---- Speech to text -----------------------------------------------------------------------

def transcribe(audio: bytes, language_hint: Optional[str] = None) -> Tuple[str, str, int]:
    """Returns (text, language "bn" or "en", length of the audio in ms)."""
    from faster_whisper.audio import decode_audio

    try:
        samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
    except Exception as err:
        raise ValueError("The recording could not be read. Record again.") from err
    audio_ms = int(len(samples) / 16)
    if audio_ms < 300:
        raise ValueError("The recording is too short. Hold the button while you speak.")
    if audio_ms > MAX_SECONDS * 1000:
        raise ValueError(f"The recording is longer than {MAX_SECONDS} seconds. Ask a shorter question.")
    with _lock:
        language = language_hint if language_hint in ("bn", "en") else None
        if language is None:
            # Only Bangla and English are expected; pick the likelier of the two.
            _, _, probabilities = _load_whisper().detect_language(samples)
            scores = dict(probabilities)
            language = "bn" if scores.get("bn", 0) >= scores.get("en", 0) else "en"
        model = _load_whisper(STT_MODELS[language])
        segments, _ = model.transcribe(samples, language=language, beam_size=1, vad_filter=True,
                                       initial_prompt="প্রশ্ন:" if language == "bn" else "Question:")
        text = " ".join(segment.text.strip() for segment in segments).strip()
    return text, language, audio_ms


# ---- Text to speech -------------------------------------------------------------------------

def _sentences(text: str):
    parts = [part.strip() for part in re.split(r"(?<=[.!?।])\s+|\n+", text) if part.strip()]
    return parts or [text]


def synthesize(text: str, language: str) -> Tuple[bytes, int]:
    """Returns (WAV bytes, length in ms)."""
    import numpy as np
    import torch

    language = language if language in TTS_MODELS else "en"
    spoken = speakable(text, language)
    with _lock:
        model, tokenizer = _load_voice(language)
        rate = model.config.sampling_rate
        pieces = []
        for sentence in _sentences(spoken)[:12]:
            inputs = tokenizer(sentence, return_tensors="pt")
            if inputs["input_ids"].shape[-1] == 0:
                continue  # nothing the voice can pronounce (for example only Latin letters for the Bangla voice)
            with torch.no_grad():
                waveform = model(**inputs).waveform[0].cpu().numpy()
            pieces.extend([waveform, np.zeros(int(rate * 0.25), dtype=waveform.dtype)])
    if not pieces:
        raise ValueError("Nothing in this answer can be spoken.")
    audio = np.concatenate(pieces)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())
    return buffer.getvalue(), int(len(pcm) * 1000 / rate)


def timed(work, *args):
    started = time.time()
    result = work(*args)
    return result, int((time.time() - started) * 1000)
