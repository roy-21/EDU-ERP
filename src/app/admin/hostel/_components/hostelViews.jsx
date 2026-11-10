"use client";

import { useCallback, useEffect, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { printTable } from "./hostelExport";
import {
  DataTable,
  StatusBadge,
  formatDateTime,
  formatMonth,
  friendlyError,
  linkButton,
  money,
  secondaryButton,
  useHostelData,
} from "./hostelUi";

export const CATEGORY_LABELS = {
  RENT: "Hostel Rent",
  MEAL: "Meal",
  FEE: "Additional Fee",
  DEPOSIT: "Security Deposit",
};

const toBytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

export const downloadBase64 = (base64, fileName, mimeType) => {
  const url = URL.createObjectURL(new Blob([toBytes(base64)], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function ViewModal({ title, onClose, children, actions, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={`my-4 w-full ${wide ? "max-w-5xl" : "max-w-2xl"} rounded-xl bg-white shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none text-slate-400 hover:text-slate-700">
            ×
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        {actions && <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 p-5">{actions}</div>}
      </div>
    </div>
  );
}

export function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-800">{value === 0 ? "0" : value || "—"}</p>
    </div>
  );
}

// Fetches the file through the logged-in API and shows it from memory, so a
// private document never has a public address.
// An image that is only served to signed-in staff, shown through a blob URL.
export function ProtectedImage({ load, alt, className = "" }) {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let url = "";
    let isCurrent = true;
    load()
      .then((file) => {
        if (!isCurrent) return;
        url = URL.createObjectURL(new Blob([toBytes(file.contentBase64)], { type: file.mimeType }));
        setState({ status: "ready", url });
      })
      .catch(() => isCurrent && setState({ status: "error" }));
    return () => {
      isCurrent = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [load]);

  if (state.status === "loading") return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} aria-label="Loading image" />;
  if (state.status === "error") return <p className="text-xs text-slate-500">The image could not be loaded.</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={state.url} alt={alt} className={`rounded-lg object-cover ${className}`} />;
}

export function DocumentPreview({ load, onClose }) {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let url = "";
    let isCurrent = true;
    load()
      .then((file) => {
        if (!isCurrent) return;
        url = URL.createObjectURL(new Blob([toBytes(file.contentBase64)], { type: file.mimeType }));
        setState({ status: "ready", file, url });
      })
      .catch((err) => isCurrent && setState({ status: "error", message: friendlyError(err) }));
    return () => {
      isCurrent = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [load]);

  const file = state.file;
  const isImage = file?.mimeType?.startsWith("image/");
  const isPdf = file?.mimeType === "application/pdf";

  return (
    <ViewModal
      title={file ? file.fileName : "Document"}
      onClose={onClose}
      wide
      actions={
        file && (
          <button onClick={() => downloadBase64(file.contentBase64, file.fileName, file.mimeType)} className={secondaryButton}>
            Download
          </button>
        )
      }
    >
      {state.status === "loading" && <p className="text-sm text-slate-500">Loading document...</p>}
      {state.status === "error" && <p role="alert" className="text-sm text-red-600">{state.message}</p>}
      {file && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Detail label="File Name" value={file.fileName} />
            <Detail label="Type" value={file.mimeType} />
            <Detail label="Size" value={formatSize(file.sizeBytes)} />
            <Detail label="Uploaded" value={formatDateTime(file.createdAt)} />
          </div>
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={state.url} alt={file.fileName} className="mx-auto max-h-[70vh] rounded-lg border border-slate-200 object-contain" />
          )}
          {isPdf && <iframe title={file.fileName} src={state.url} className="h-[70vh] w-full rounded-lg border border-slate-200" />}
          {!isImage && !isPdf && (
            <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              This file type cannot be shown in the browser. Use Download to open it.
            </p>
          )}
        </>
      )}
    </ViewModal>
  );
}

export function InvoiceDetail({ invoiceId, onClose, onChanged }) {
  const { has } = useHostelPermissions();
  const load = useCallback(() => hostelService.getInvoice(invoiceId), [invoiceId]);
  const { data, error } = useHostelData(load);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const act = async (work) => {
    setNotice("");
    setActionError("");
    try {
      setNotice(await work());
      onChanged?.();
    } catch (err) {
      setActionError(friendlyError(err));
    }
  };

  const invoice = data?.invoice;
  const print = () =>
    printTable(
      `Invoice ${invoice.invoiceNumber}`,
      [
        { label: "Detail", value: (row) => row[0] },
        { label: "Amount", value: (row) => row[1] },
      ],
      [
        ["Student", `${invoice.studentName} (${invoice.studentId})`],
        ["Room", `${invoice.hostelName} · ${invoice.buildingName} · Room ${invoice.roomNumber} · Seat ${invoice.seatNumber ?? "—"}`],
        ["Billing Period", formatMonth(invoice.billingMonth)],
        ["Due Date", invoice.dueDate],
        ...data.items.map((item) => [`${item.description} (${item.quantity} x ${money(item.unitPrice)})`, money(item.amount)]),
        ...data.adjustments.map((item) => [`Adjustment: ${item.reason}`, money(item.amount)]),
        ["Previous Outstanding", money(invoice.previousOutstanding)],
        ["Total Payable", money(invoice.totalPayable)],
        ["Payments Received", money(invoice.paidAmount)],
        ["Remaining Balance", money(invoice.outstandingAmount)],
      ]
    );

  return (
    <ViewModal
      title={invoice ? `Invoice ${invoice.invoiceNumber}` : "Invoice"}
      onClose={onClose}
      wide
      actions={
        invoice && (
          <>
            <button
              onClick={() => act(async () => {
                const file = await hostelService.getInvoicePdf(invoiceId);
                downloadBase64(file.contentBase64, file.fileName, "application/pdf");
                return "PDF downloaded.";
              })}
              className={secondaryButton}
            >
              Download PDF
            </button>
            <button onClick={print} className={secondaryButton}>Print</button>
            {has("manage_payments", "send_reminders") && (
              <button
                onClick={() => act(async () => {
                  const result = await hostelService.emailInvoice(invoiceId);
                  if (result.status !== "Sent") throw new Error(`Email not sent (${result.status}). ${result.error || ""}`);
                  return `Invoice emailed to ${result.recipient}, with a payment link.`;
                })}
                className={secondaryButton}
              >
                Email Invoice
              </button>
            )}
            {has("manage_payments") && invoice.outstandingAmount > 0 && (
              <button
                onClick={() => act(async () => {
                  const { url } = await hostelService.createPaymentLink(invoiceId);
                  try {
                    await navigator.clipboard.writeText(url);
                    return "Payment link copied. Share it only with this student.";
                  } catch {
                    return `Payment link: ${url}`;
                  }
                })}
                className={secondaryButton}
              >
                Copy Payment Link
              </button>
            )}
          </>
        )
      }
    >
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Loading...</p>}
      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
      {invoice && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Detail label="Student" value={`${invoice.studentName} (${invoice.studentId})`} />
            <Detail label="Room / Seat" value={`${invoice.hostelName} · ${invoice.buildingName} · ${invoice.roomNumber} · Seat ${invoice.seatNumber ?? "—"}`} />
            <Detail label="Category" value={CATEGORY_LABELS[invoice.category]} />
            <div>
              <p className="text-xs text-slate-500">Status</p>
              <div className="mt-1"><StatusBadge status={invoice.status} /></div>
            </div>
            <Detail label="Invoice Date" value={invoice.createdDate} />
            <Detail label="Billing Period" value={formatMonth(invoice.billingMonth)} />
            <Detail label="Due Date" value={invoice.dueDate} />
            <Detail label="Charge" value={invoice.title} />
          </div>

          <DataTable columns={["Item", "Quantity", "Unit Price", "Amount"]} hasRows minWidth="min-w-[560px]">
            {data.items.map((item, index) => (
              <tr key={index} className="border-b border-slate-100">
                <td className="px-4 py-2 text-slate-700">{item.description}</td>
                <td className="px-4 py-2 text-slate-600">{item.quantity}</td>
                <td className="px-4 py-2 tabular-nums text-slate-600">{money(item.unitPrice)}</td>
                <td className="px-4 py-2 tabular-nums text-slate-800">{money(item.amount)}</td>
              </tr>
            ))}
            {data.adjustments.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-2 text-slate-700" colSpan={3}>Adjustment: {item.reason} ({item.createdBy})</td>
                <td className="px-4 py-2 tabular-nums text-slate-800">{money(item.amount)}</td>
              </tr>
            ))}
          </DataTable>

          <div className="grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-4">
            <Detail label="Previous Outstanding" value={money(invoice.previousOutstanding)} />
            <Detail label="Current Charges" value={money(invoice.amountDue)} />
            <Detail label="Payments Received" value={money(invoice.paidAmount)} />
            <Detail label="Remaining Balance" value={money(invoice.outstandingAmount)} />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-700">Payment History</p>
            <DataTable
              columns={["Receipt", "Date", "Method", "Reference", "Amount", "Status"]}
              hasRows={data.payments.length > 0}
              emptyMessage="No payments yet."
              minWidth="min-w-[640px]"
            >
              {data.payments.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-600">{item.receiptNumber}</td>
                  <td className="px-4 py-2 text-slate-600">{item.paymentDate}</td>
                  <td className="px-4 py-2 text-slate-600">{item.method}</td>
                  <td className="px-4 py-2 text-slate-600">{item.transactionReference || "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-800">{money(item.amount)}</td>
                  <td className="px-4 py-2"><StatusBadge status={item.status} /></td>
                </tr>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </ViewModal>
  );
}

export function InvoiceButton({ invoice, onOpen }) {
  return (
    <button onClick={() => onOpen(invoice.id)} aria-label={`View invoice ${invoice.invoiceNumber}`} className={linkButton}>
      View
    </button>
  );
}
