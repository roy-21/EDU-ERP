"use client";

import { useEffect, useRef, useState } from "react";
import { assistantApi } from "@/lib/assistantApi";
import { friendlyError, useData } from "@/components/erp/ui";
import { AnswerStatus } from "./AssistantChat";

// A website voice call with the assistant. Press the microphone, speak, press again: the
// recording goes to the Core ERP, which has voice-api turn it into text, answers it the same way
// as a typed question, and sends back the answer as text and speech.

const MAX_SECONDS = 60;

const pickMime = () => {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
};

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The recording could not be read."));
    reader.readAsDataURL(blob);
  });

export default function VoiceCall() {
  const { data: status } = useData(assistantApi.voiceStatus);
  const [callId, setCallId] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle | recording | working
  const [language, setLanguage] = useState("");
  const [turns, setTurns] = useState([]);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const player = useRef(null);

  // Stop the microphone and timer if the page closes mid-recording.
  useEffect(() => () => {
    clearInterval(timer.current);
    recorder.current?.stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const ready = status?.reachable && status?.stt;

  const start = async () => {
    setError("");
    try {
      const { id } = await assistantApi.startCall();
      setCallId(id);
      setTurns([]);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const end = async () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    try {
      if (callId) await assistantApi.endCall(callId);
    } catch {
      // The call is ended on our side either way.
    }
    setCallId(null);
    setPhase("idle");
  };

  const send = async (blob) => {
    setPhase("working");
    try {
      const audioBase64 = await blobToBase64(blob);
      const result = await assistantApi.callTurn(callId, audioBase64, language || undefined);
      setTurns((list) => [...list, result]);
      if (result.audio?.audioBase64) {
        const audio = new Audio(`data:${result.audio.mimeType};base64,${result.audio.audioBase64}`);
        player.current?.pause();
        player.current = audio;
        audio.play().catch(() => {}); // the play button on the answer still works if the browser blocks this
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPhase("idle");
    }
  };

  const record = async () => {
    setError("");
    if (phase === "recording") {
      recorder.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio. Use a recent Chrome, Edge or Firefox.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = pickMime();
      const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      media.ondataavailable = (event) => event.data.size && chunks.current.push(event.data);
      media.onstop = () => {
        clearInterval(timer.current);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        if (blob.size > 0) send(blob);
        else setPhase("idle");
      };
      recorder.current = media;
      media.start();
      setSeconds(0);
      setPhase("recording");
      timer.current = setInterval(() => {
        setSeconds((value) => {
          if (value + 1 >= MAX_SECONDS && media.state === "recording") media.stop();
          return value + 1;
        });
      }, 1000);
    } catch (err) {
      setError(err?.name === "NotAllowedError" ? "Microphone permission was refused. Allow the microphone for this site and try again." : friendlyError(err));
    }
  };

  const replay = (turn) => {
    if (!turn.audio?.audioBase64) return;
    player.current?.pause();
    player.current = new Audio(`data:${turn.audio.mimeType};base64,${turn.audio.audioBase64}`);
    player.current.play().catch(() => {});
  };

  if (status && !ready) {
    return (
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        Voice calls are not available right now: {!status.reachable ? "the voice service (voice-api) is not running." : "speech recognition is not installed on the voice service."} You can still type your question.
      </p>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      {!callId ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">Talk to the assistant in Bangla or English. It answers from the same approved knowledge and your own records, and speaks the answer back.</p>
          <button onClick={start} disabled={!status} className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">📞 Start voice call</button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Language
              <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={phase !== "idle"} className="rounded border border-slate-300 px-2 py-1 text-sm">
                <option value="">Detect</option><option value="bn">বাংলা</option><option value="en">English</option>
              </select>
            </label>
            <button onClick={end} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">End call</button>
          </div>

          <div className="flex flex-col items-center gap-2 py-2">
            <button onClick={record} disabled={phase === "working"} aria-pressed={phase === "recording"}
              aria-label={phase === "recording" ? "Stop and send" : "Press and speak"}
              className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl text-white shadow transition disabled:opacity-50 ${phase === "recording" ? "animate-pulse bg-red-600" : "bg-blue-600 hover:bg-blue-700"}`}>
              {phase === "recording" ? "■" : "🎤"}
            </button>
            <p className="text-sm text-slate-600" aria-live="polite">
              {phase === "recording" && `Listening… ${seconds}s — press again when you finish`}
              {phase === "working" && "Working on the answer… on this server it can take a minute or two."}
              {phase === "idle" && "Press the microphone and ask your question."}
            </p>
          </div>

          <div className="space-y-3">
            {turns.map((turn, index) => (
              <div key={turn.answer?.id || index} className="space-y-2">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-sm text-white">🎤 {turn.heard}</div>
                <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                  <div className="mb-1.5 flex items-center gap-2">
                    <AnswerStatus status={turn.answer?.status} />
                    {turn.audio?.audioBase64 && <button onClick={() => replay(turn)} className="text-xs font-medium text-blue-700 hover:text-blue-900">▶ Play again</button>}
                  </div>
                  <p className="whitespace-pre-line leading-relaxed">{turn.answer?.answer}</p>
                  {turn.speechError && <p className="mt-1 text-xs text-amber-700">Not spoken: {turn.speechError}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
