"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { inventoryApi } from "@/lib/operationsApi";
import { useMe } from "@/lib/useMe";
import { Detail, ErrorBanner, NoAccess, SystemShell, filterClass, friendlyError, inputClass, money, primaryButton, secondaryButton, useData } from "@/components/erp/ui";
import { ASSET_LABELS, AssetBadge, Barcode, CRUMBS, STOCK_LABELS, StockBadge, printLabels, qty } from "../_components/inventoryUi";

// Reads barcodes with the device camera where the browser supports it (Chrome, Edge, Android).
function CameraScanner({ onCode, onClose }) {
  const video = useRef(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let stream;
    let timer;
    let stopped = false;
    const start = async () => {
      try {
        if (!("BarcodeDetector" in window)) throw new Error("This browser cannot read barcodes from the camera. Use a USB scanner or type the code.");
        const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code", "ean_13", "code_39"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const scan = async () => {
          if (stopped || !video.current) return;
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) onCode(found[0].rawValue);
          else timer = setTimeout(scan, 250);
        };
        scan();
      } catch (err) {
        setProblem(err.name === "NotAllowedError" ? "Camera permission was refused." : err.message);
      }
    };
    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onCode]);

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      {problem ? <p className="text-sm text-red-600">{problem}</p> : <video ref={video} muted playsInline className="mx-auto max-h-72 rounded-lg bg-black" aria-label="Camera view" />}
      <button onClick={onClose} className={secondaryButton}>Stop camera</button>
    </div>
  );
}

function ScanResult({ result }) {
  if (result.type === "ITEM") {
    const item = result.item;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3"><h3 className="text-lg font-semibold text-slate-800">{item.name}</h3><StockBadge status={item.stockStatus} /></div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Detail label="SKU" value={item.sku} />
          <Detail label="On hand" value={`${qty(item.onHand)} ${item.unit}`} />
          <Detail label="Average cost" value={money(item.avgCost)} />
          <Detail label="Reorder level" value={qty(item.reorderLevel)} />
        </div>
        <p className="text-sm text-slate-500">Stock item · {STOCK_LABELS[item.stockStatus]}. Receive or issue it from the Stock Ledger.</p>
      </div>
    );
  }
  const asset = result.asset;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3"><h3 className="text-lg font-semibold text-slate-800">{asset.assetTag} · {asset.name}</h3><AssetBadge status={asset.status} /></div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail label="Assigned to" value={asset.assignedTo} />
        <Detail label="Location" value={asset.location} />
        <Detail label="Serial" value={asset.serialNo} />
        <Detail label="Warranty until" value={asset.warrantyUntil} />
      </div>
      <p className="text-sm text-slate-500">Asset · {ASSET_LABELS[asset.status]}. Assign, return or move it from Assets.</p>
    </div>
  );
}

export default function BarcodePage() {
  const { can, isReady } = useMe();
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const [scanError, setScanError] = useState("");
  const [camera, setCamera] = useState(false);
  const [source, setSource] = useState("items");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState({});
  const [copies, setCopies] = useState(1);
  const [printError, setPrintError] = useState("");
  const load = useCallback(() => Promise.all([inventoryApi.items(), inventoryApi.assets({ status: "IN_SERVICE" })]), []);
  const { data, error } = useData(load);
  const [items, assets] = data || [[], []];

  const lookup = useCallback(async (value) => {
    const text = (value || "").trim();
    if (!text) return;
    setCamera(false);
    setCode(text);
    setScanError("");
    setResult(null);
    try {
      setResult(await inventoryApi.lookup(text));
    } catch (err) {
      setScanError(friendlyError(err));
    }
  }, []);

  if (isReady && !can("inventory.read")) return <NoAccess />;

  const rows = (source === "items"
    ? items.map((item) => ({ id: item.id, code: item.barcode || item.sku, title: item.name, subtitle: item.sku }))
    : assets.map((asset) => ({ id: asset.id, code: asset.assetTag, title: asset.name, subtitle: [asset.category, asset.location].filter(Boolean).join(" · ") })))
    .filter((row) => !search.trim() || [row.code, row.title, row.subtitle].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())));
  const chosen = rows.filter((row) => selected[row.id]);

  const print = () => {
    setPrintError("");
    try {
      if (chosen.length === 0) throw new Error("Tick at least one label.");
      const count = Math.min(50, Math.max(1, Number(copies) || 1));
      printLabels(chosen.flatMap((row) => Array.from({ length: count }, () => row)));
    } catch (err) {
      setPrintError(err.message);
    }
  };

  return (
    <SystemShell title="Barcodes & Scanning" subtitle="Scan any item barcode, SKU, asset tag or serial number, and print Code 128 labels." crumbs={CRUMBS}>
      <ErrorBanner message={error} />
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">Scan or look up</h2>
        <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); lookup(code); }}>
          <input aria-label="Code to look up" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan with a USB scanner, or type a code" className={`${inputClass} max-w-md font-mono`} />
          <button type="submit" className={primaryButton}>Look up</button>
          <button type="button" onClick={() => setCamera((on) => !on)} className={secondaryButton}>{camera ? "Stop camera" : "Use camera"}</button>
        </form>
        {camera && <CameraScanner onCode={lookup} onClose={() => setCamera(false)} />}
        {scanError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{scanError}</p>}
        {result && <div className="rounded-lg border border-slate-200 p-4"><ScanResult result={result} /></div>}
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-800">Print labels</h2>
            <p className="text-sm text-slate-500">Three labels per row on A4. Save as PDF from the print dialog.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">Copies each <input type="number" min="1" max="50" value={copies} onChange={(e) => setCopies(e.target.value)} className={`${filterClass} w-20`} /></label>
            <button onClick={print} className={primaryButton}>Print {chosen.length || ""} label{chosen.length === 1 ? "" : "s"}</button>
          </div>
        </div>
        {printError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{printError}</p>}
        <div className="flex flex-wrap gap-3">
          <select aria-label="Label source" value={source} onChange={(e) => { setSource(e.target.value); setSelected({}); }} className={filterClass}>
            <option value="items">Stock items</option><option value="assets">Assets</option>
          </select>
          <input aria-label="Filter labels" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter" className={filterClass} />
          <button onClick={() => setSelected(Object.fromEntries(rows.map((row) => [row.id, true])))} className={secondaryButton}>Select all shown</button>
          <button onClick={() => setSelected({})} className={secondaryButton}>Clear</button>
        </div>
        <div className="grid max-h-[32rem] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {rows.length === 0 && <p className="text-sm text-slate-500">Nothing to label yet.</p>}
          {rows.slice(0, 300).map((row) => (
            <label key={row.id} className={`cursor-pointer rounded-lg border p-3 ${selected[row.id] ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
              <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input type="checkbox" checked={Boolean(selected[row.id])} onChange={(e) => setSelected({ ...selected, [row.id]: e.target.checked })} />
                <span className="truncate">{row.title}</span>
              </span>
              <span className="mt-2 block"><Barcode value={row.code} height={36} module={1.2} /></span>
            </label>
          ))}
        </div>
        {rows.length > 300 && <p className="text-xs text-slate-500">Showing the first 300. Filter to find others.</p>}
      </section>
    </SystemShell>
  );
}
