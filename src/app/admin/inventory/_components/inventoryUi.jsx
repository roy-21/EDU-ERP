"use client";

import { useState } from "react";
import { Field, FormModal, inputClass, linkButton } from "@/components/erp/ui";

export const CRUMBS = [{ href: "/admin/inventory", label: "Inventory" }];

export const KIND_LABELS = {
  OPENING: "Opening stock",
  RECEIPT: "Stock in (GRN)",
  ISSUE: "Issued",
  RETURN: "Returned",
  ADJUSTMENT: "Count adjustment",
  DAMAGE: "Damaged",
  LOSS: "Lost",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  REVERSAL: "Reversal",
};

const TONES = {
  green: "bg-green-100 text-green-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  purple: "bg-purple-100 text-purple-700",
  slate: "bg-slate-100 text-slate-600",
};

const KIND_TONES = {
  OPENING: "slate", RECEIPT: "green", RETURN: "green", ISSUE: "blue", ADJUSTMENT: "amber", DAMAGE: "red", LOSS: "red",
  TRANSFER_OUT: "purple", TRANSFER_IN: "purple", REVERSAL: "slate",
};

export const STOCK_LABELS = { OK: "In stock", LOW: "Low stock", OUT: "Out of stock", OVER: "Overstock" };
const STOCK_TONES = { OK: "green", LOW: "amber", OUT: "red", OVER: "purple" };

export const ASSET_LABELS = { AVAILABLE: "Available", ASSIGNED: "Assigned", UNDER_REPAIR: "Under repair", LOST: "Lost", DISPOSED: "Disposed" };
const ASSET_TONES = { AVAILABLE: "green", ASSIGNED: "blue", UNDER_REPAIR: "amber", LOST: "red", DISPOSED: "slate" };

export const TRANSFER_LABELS = { PENDING: "Waiting approval", IN_TRANSIT: "In transit", RECEIVED: "Received", REJECTED: "Rejected", CANCELLED: "Cancelled" };
const TRANSFER_TONES = { PENDING: "amber", IN_TRANSIT: "purple", RECEIVED: "green", REJECTED: "red", CANCELLED: "slate" };

function Badge({ tone, children }) {
  return <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${TONES[tone] || TONES.slate}`}>{children}</span>;
}

export const KindBadge = ({ kind }) => <Badge tone={KIND_TONES[kind]}>{KIND_LABELS[kind] || kind}</Badge>;
export const StockBadge = ({ status }) => <Badge tone={STOCK_TONES[status]}>{STOCK_LABELS[status] || status}</Badge>;
export const AssetBadge = ({ status }) => <Badge tone={ASSET_TONES[status]}>{ASSET_LABELS[status] || status}</Badge>;
export const TransferBadge = ({ status }) => <Badge tone={TRANSFER_TONES[status]}>{TRANSFER_LABELS[status] || status}</Badge>;

export const PO_LABELS = { DRAFT: "Draft", APPROVED: "Approved", PARTIAL: "Partly received", RECEIVED: "Received", CLOSED: "Closed short", CANCELLED: "Cancelled" };
const PO_TONES = { DRAFT: "slate", APPROVED: "blue", PARTIAL: "amber", RECEIVED: "green", CLOSED: "purple", CANCELLED: "red" };
export const PoBadge = ({ status }) => <Badge tone={PO_TONES[status]}>{PO_LABELS[status] || status}</Badge>;

// How close a batch is to its expiry date.
export function ExpiryBadge({ batch }) {
  if (batch.state === "NO_EXPIRY") return <Badge tone="slate">No expiry</Badge>;
  if (batch.state === "EXPIRED") return <Badge tone="red">Expired {batch.expiresOn}</Badge>;
  if (batch.state === "EXPIRING") return <Badge tone="amber">{batch.daysLeft === 0 ? "Expires today" : `${batch.daysLeft} day${batch.daysLeft === 1 ? "" : "s"} left`}</Badge>;
  return <Badge tone="green">Expires {batch.expiresOn}</Badge>;
}

export const qty = (value) => Number(value || 0).toLocaleString("en-BD", { maximumFractionDigits: 3 });
export const signed = (value) => `${value > 0 ? "+" : ""}${qty(value)}`;

export function Notice({ text }) {
  if (!text) return null;
  return <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{text}</p>;
}

// ---- Picking items for a stock document ---------------------------------------------

// Finds items by name, SKU or barcode. A scanner types the code and presses Enter,
// so an exact code match is added straight away.
export function ItemPicker({ items, exclude = [], onPick, id = "item-search", label = "Add item" }) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const matches = term.length < 1 ? [] : items
    .filter((item) => !exclude.includes(item.id))
    .filter((item) => [item.name, item.sku, item.barcode, item.brand].some((value) => value?.toLowerCase().includes(term)))
    .slice(0, 8);

  const pick = (item) => {
    onPick(item);
    setSearch("");
  };

  return (
    <Field id={id} label={label} wide>
      <input id={id} value={search} placeholder="Type a name or SKU, or scan a barcode" className={inputClass} autoComplete="off"
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const exact = items.find((item) => item.barcode === search.trim() || item.sku.toLowerCase() === term);
          const choice = exact || (matches.length === 1 ? matches[0] : null);
          if (choice && !exclude.includes(choice.id)) pick(choice);
        }} />
      {matches.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200 text-sm">
          {matches.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => pick(item)} className="w-full px-3 py-2 text-left hover:bg-slate-50">
                <span className="font-medium text-slate-800">{item.name}</span>
                <span className="ml-2 font-mono text-xs text-slate-500">{item.sku}</span>
                <span className="float-right text-xs text-slate-500">{qty(item.onHand)} {item.unit} on hand</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

const DOC_MODES = {
  receive: { title: "Stock In (Goods Received)", submit: "Receive", party: "Supplier", partyKey: "supplier", reference: "Supplier invoice / challan no.", withCost: true, withBatch: true },
  issue: { title: "Issue Stock", submit: "Issue", party: "Issued to (department, lab or person) *", partyKey: "issuedTo", reference: "Requisition no.", withCost: false },
  return: { title: "Take Back Stock", submit: "Take back", party: "Returned by *", partyKey: "returnedBy", reference: "Reference", withCost: false, withBatch: true },
  transfer: { title: "Request Transfer", submit: "Request", withCost: false },
};

// One form for receipts, issues, returns and transfer requests: a store, who, and item lines.
export function StockDocumentForm({ mode, items, stores, onSubmit, onClose }) {
  const config = DOC_MODES[mode];
  const open = stores.filter((store) => store.isActive);
  const [head, setHead] = useState({ storeId: open[0]?.id || "", toStoreId: open[1]?.id || "", party: "", reference: "", note: "" });
  const [lines, setLines] = useState([]);
  const setLine = (index, patch) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const total = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0);

  const submit = async () => {
    if (lines.length === 0) throw new Error("Add at least one item.");
    const body = {
      lines: lines.map((line) => ({
        itemId: line.item.id, quantity: Number(line.quantity),
        ...(config.withCost ? { unitCost: Number(line.unitCost || 0) } : {}),
        ...(config.withBatch && line.item.trackBatches ? { batchNo: line.batchNo, expiresOn: line.expiresOn || undefined } : {}),
      })),
      note: head.note,
    };
    if (mode === "transfer") Object.assign(body, { fromStoreId: head.storeId, toStoreId: head.toStoreId });
    else Object.assign(body, { storeId: head.storeId, reference: head.reference, [config.partyKey]: head.party });
    await onSubmit(body);
  };

  return (
    <FormModal title={config.title} submitLabel={config.submit} onSubmit={submit} onClose={onClose}>
      <Field id="doc-store" label={mode === "transfer" ? "From store *" : mode === "issue" ? "Issue from store *" : "Into store *"}>
        <select id="doc-store" value={head.storeId} onChange={(e) => setHead({ ...head, storeId: e.target.value })} className={inputClass}>
          {open.map((store) => <option key={store.id} value={store.id}>{store.name} ({store.code})</option>)}
        </select>
      </Field>
      {mode === "transfer" ? (
        <Field id="doc-to" label="To store *">
          <select id="doc-to" value={head.toStoreId} onChange={(e) => setHead({ ...head, toStoreId: e.target.value })} className={inputClass}>
            {open.map((store) => <option key={store.id} value={store.id}>{store.name} ({store.code})</option>)}
          </select>
        </Field>
      ) : (
        <Field id="doc-party" label={config.party}>
          <input id="doc-party" value={head.party} onChange={(e) => setHead({ ...head, party: e.target.value })} className={inputClass} />
        </Field>
      )}
      {mode !== "transfer" && (
        <Field id="doc-ref" label={config.reference}>
          <input id="doc-ref" value={head.reference} onChange={(e) => setHead({ ...head, reference: e.target.value })} className={inputClass} />
        </Field>
      )}
      <Field id="doc-note" label="Note">
        <input id="doc-note" value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} className={inputClass} />
      </Field>
      {/* A batch-tracked item can be received in several batches, so it can be picked again. */}
      <ItemPicker items={items.filter((item) => item.status === "ACTIVE")} exclude={lines.filter((line) => !(config.withBatch && line.item.trackBatches)).map((line) => line.item.id)}
        onPick={(item) => setLines((current) => [...current, { key: `${item.id}-${Date.now()}`, item, quantity: "", batchNo: "", expiresOn: "", unitCost: config.withCost ? String(item.avgCost || "") : "" }])} />
      <div className="sm:col-span-2">
        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No items yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2">Item</th><th className="py-2">On hand</th><th className="py-2">Quantity</th>{config.withCost && <th className="py-2">Unit cost (৳)</th>}<th />
              </tr></thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-2">{line.item.name}<span className="block font-mono text-xs text-slate-500">{line.item.sku}</span>
                      {config.withBatch && line.item.trackBatches && (
                        <span className="mt-1 flex flex-wrap gap-2">
                          <input aria-label={`Batch number of ${line.item.name}`} placeholder="Batch no. *" value={line.batchNo} onChange={(e) => setLine(index, { batchNo: e.target.value })} className={`${inputClass} w-32`} />
                          <input aria-label={`Expiry date of ${line.item.name}`} type="date" title="Expiry date" value={line.expiresOn} onChange={(e) => setLine(index, { expiresOn: e.target.value })} className={`${inputClass} w-40`} />
                        </span>
                      )}
                      {!config.withBatch && line.item.trackBatches && <span className="block text-xs text-amber-700">Batches go first-expiry-first-out.</span>}
                    </td>
                    <td className="py-2 pr-2 text-slate-600">{qty(line.item.onHand)} {line.item.unit}</td>
                    <td className="py-2 pr-2"><input aria-label={`Quantity of ${line.item.name}`} type="number" min="0" step="any" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} className={`${inputClass} w-28`} /></td>
                    {config.withCost && <td className="py-2 pr-2"><input aria-label={`Unit cost of ${line.item.name}`} type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => setLine(index, { unitCost: e.target.value })} className={`${inputClass} w-32`} /></td>}
                    <td className="py-2"><button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="text-sm font-medium text-red-600 hover:text-red-800">Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {config.withCost && <p className="mt-2 text-right text-sm font-medium text-slate-700">Total ৳{total.toLocaleString("en-BD", { maximumFractionDigits: 2 })}</p>}
          </div>
        )}
      </div>
    </FormModal>
  );
}

// ---- Code 128 barcodes ----------------------------------------------------------------

// Bar and space widths of the 107 Code 128 symbols (106 is the stop symbol).
const CODE128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 " +
  "131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 " +
  "213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
  "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 " +
  "421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112").split(" ");

// The bar widths of a Code 128 (code set B) barcode, or null for text it cannot hold.
export const code128 = (value) => {
  if (!value || !/^[\x20-\x7E]+$/.test(value)) return null;
  const codes = [104, ...[...value].map((char) => char.charCodeAt(0) - 32)];
  const check = codes.reduce((sum, code, index) => sum + code * Math.max(index, 1), 0) % 103;
  return [...codes, check, 106].map((code) => CODE128[code]).join("");
};

const escapeXml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

// The same barcode as markup, for print windows outside React.
export const barcodeSvgMarkup = (value, height = 44, module = 1.4) => {
  const widths = code128(value);
  if (!widths) return "";
  let x = 10;
  let rects = "";
  [...widths].forEach((width, index) => {
    if (index % 2 === 0) rects += `<rect x="${x * module}" y="0" width="${Number(width) * module}" height="${height}"/>`;
    x += Number(width);
  });
  const total = (x + 10) * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height + 15}" width="${total}" height="${height + 15}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g><text x="${total / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="11">${escapeXml(value)}</text></svg>`;
};

// Opens a sheet of labels (name, price or holder line, barcode) and the print dialog.
export const printLabels = (labels) => {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Allow pop-ups for this site to print labels.");
  const cells = labels.map((label) => `<div class="label"><div class="name">${escapeXml(label.title)}</div>${label.subtitle ? `<div class="sub">${escapeXml(label.subtitle)}</div>` : ""}${barcodeSvgMarkup(label.code)}</div>`).join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    body{font-family:Arial,sans-serif;margin:8mm}
    .sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
    .label{border:1px dashed #cbd5e1;padding:3mm;text-align:center;break-inside:avoid}
    .name{font-size:11px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sub{font-size:9px;color:#475569;margin-bottom:1mm}
    svg{max-width:100%;height:auto}
    @media print{.label{border-color:#e2e8f0}}
  </style></head><body><div class="sheet">${cells}</div></body></html>`);
  win.document.close();
  win.focus();
  win.print();
};

export function Barcode({ value, height = 48, module = 1.6, showText = true }) {
  const widths = code128(value);
  if (!widths) return <p className="text-xs text-red-600">Cannot print “{value}” as a barcode.</p>;
  const quiet = 10;
  let x = quiet;
  const bars = [];
  [...widths].forEach((width, index) => {
    const w = Number(width);
    if (index % 2 === 0) bars.push(<rect key={index} x={x * module} y={0} width={w * module} height={height} />);
    x += w;
  });
  const total = (x + quiet) * module;
  return (
    <svg role="img" aria-label={`Barcode ${value}`} viewBox={`0 0 ${total} ${height + (showText ? 16 : 0)}`} width={total} height={height + (showText ? 16 : 0)} className="max-w-full">
      <rect width="100%" height="100%" fill="#fff" />
      <g fill="#000">{bars}</g>
      {showText && <text x={total / 2} y={height + 13} textAnchor="middle" fontFamily="monospace" fontSize="12" fill="#000">{value}</text>}
    </svg>
  );
}

export function LinkCard({ href, title, text, count, icon }) {
  return (
    <a href={href} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl" aria-hidden="true">{icon}</span>
        {count !== undefined && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">{count}</span>}
      </div>
      <p className="mt-3 font-semibold text-slate-800 group-hover:text-blue-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
      <span className={`mt-3 inline-block text-sm ${linkButton}`}>Open →</span>
    </a>
  );
}
