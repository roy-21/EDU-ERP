"use client";

import Link from "next/link";
import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { downloadCsv } from "./hostelExport";
import { AdjustmentForm, PaymentForm } from "./RentForms";
import { CATEGORY_LABELS, InvoiceDetail } from "./hostelViews";
import {
  DataTable,
  ErrorBanner,
  PageShell,
  Pager,
  StatGrid,
  StatusBadge,
  filterClass,
  formatMonth,
  linkButton,
  money,
  secondaryButton,
  useHostelAction,
  useHostelData,
  usePagination,
} from "./hostelUi";

const STATUSES = ["Unpaid", "Partially Paid", "Paid", "Overdue", "Waived"];

export const INVOICE_CSV_COLUMNS = [
  { label: "Invoice", value: (item) => item.invoiceNumber },
  { label: "Invoice Date", value: (item) => item.createdDate },
  { label: "Category", value: (item) => CATEGORY_LABELS[item.category] },
  { label: "Charge", value: (item) => item.title },
  { label: "Student ID", value: (item) => item.studentId },
  { label: "Student", value: (item) => item.studentName },
  { label: "Hostel", value: (item) => item.hostelName },
  { label: "Building", value: (item) => item.buildingName },
  { label: "Room", value: (item) => item.roomNumber },
  { label: "Seat", value: (item) => item.seatNumber },
  { label: "Billing Month", value: (item) => item.billingMonth.slice(0, 7) },
  { label: "Amount", value: (item) => item.rentAmount },
  { label: "Adjustments", value: (item) => item.adjustmentTotal },
  { label: "Previous Balance", value: (item) => item.previousOutstanding },
  { label: "Total Payable", value: (item) => item.totalPayable },
  { label: "Paid", value: (item) => item.paidAmount },
  { label: "Outstanding", value: (item) => item.outstandingAmount },
  { label: "Due Date", value: (item) => item.dueDate },
  { label: "Status", value: (item) => item.status },
];

const loadInvoices = () => hostelService.getInvoices();

export default function InvoiceManagement() {
  const { has } = useHostelPermissions();
  const canPay = has("manage_payments");
  const { data, error: loadError, isLoading, reload } = useHostelData(loadInvoices);
  const { error: actionError, clearError, run } = useHostelAction(reload);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [buildingFilter, setBuildingFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [openInvoice, setOpenInvoice] = useState(null);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState("");

  const invoices = data || [];

  const handlePaymentLink = (invoice) =>
    run(async () => {
      const { url } = await hostelService.createPaymentLink(invoice.id);
      try {
        await navigator.clipboard.writeText(url);
        setNotice(`Payment link for ${invoice.invoiceNumber} copied. Anyone with it can see this student's rent, so share it only with them.`);
      } catch {
        setNotice(`Payment link for ${invoice.invoiceNumber}: ${url}`);
      }
    });
  const months = [...new Set(invoices.map((item) => item.billingMonth))];
  const buildings = [...new Map(invoices.filter((item) => item.buildingId).map((item) => [item.buildingId, `${item.hostelName} · ${item.buildingName}`])).entries()];

  const sum = (key, list = invoices) =>
    list.reduce((total, item) => total + Math.round(item[key] * 100), 0) / 100;
  const overdue = invoices.filter((item) => item.status === "Overdue");

  const stats = [
    { label: "Total Invoices", value: invoices.length },
    { label: "Billed", value: money(sum("amountDue")), color: "text-indigo-600" },
    { label: "Collected", value: money(sum("paidAmount")), color: "text-green-600" },
    { label: "Outstanding", value: money(sum("outstandingAmount")), color: "text-orange-600" },
    { label: "Overdue", value: money(sum("outstandingAmount", overdue)), color: "text-red-600" },
  ];

  const query = search.trim().toLowerCase();
  const filtered = invoices.filter(
    (item) =>
      [item.studentName, item.studentId, item.invoiceNumber, item.roomNumber]
        .join(" ")
        .toLowerCase()
        .includes(query) &&
      (statusFilter === "All" || item.status === statusFilter) &&
      (monthFilter === "All" || item.billingMonth === monthFilter) &&
      (categoryFilter === "All" || item.category === categoryFilter) &&
      (buildingFilter === "All" || item.buildingId === buildingFilter) &&
      (!fromDate || item.createdDate >= fromDate) &&
      (!toDate || item.createdDate <= toDate)
  );
  const { pageItems, pagerProps } = usePagination(filtered);

  const handleGenerate = () =>
    run(async () => {
      const result = await hostelService.generateInvoices();
      setNotice(
        result.created > 0
          ? `${result.created} new invoice(s) created.`
          : "All invoices are up to date. No new invoices were needed."
      );
    });

  const handleSaved = () => {
    setForm(null);
    reload();
  };

  return (
    <PageShell
      title="Hostel Invoices"
      subtitle="Rent, meals, fees and deposits. Billing runs automatically; balances come from recorded payments."
      actions={
        <>
          {has("export_reports") && (
            <button
              onClick={() => downloadCsv("hostel-invoices.csv", INVOICE_CSV_COLUMNS, filtered)}
              disabled={filtered.length === 0}
              className={`${secondaryButton} disabled:opacity-50`}
            >
              Export CSV
            </button>
          )}
          {has("manage_payments", "configure_rent") && (
            <button onClick={handleGenerate} className={secondaryButton}>
              Generate Now
            </button>
          )}
        </>
      }
    >
      <StatGrid stats={stats} isLoading={isLoading} />
      <ErrorBanner message={actionError} onDismiss={clearError} />
      {notice && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <input
            type="text"
            aria-label="Search invoices"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by student, ID, invoice, room..."
            className={`w-full md:max-w-md ${filterClass}`}
          />
          <select
            aria-label="Filter by month"
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            className={filterClass}
          >
            <option value="All">All Months</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {formatMonth(month)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className={filterClass}
          >
            <option value="All">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Filter by building"
            value={buildingFilter}
            onChange={(event) => setBuildingFilter(event.target.value)}
            className={filterClass}
          >
            <option value="All">All Buildings</option>
            {buildings.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <input type="date" aria-label="Invoice date from" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={filterClass} />
          <input type="date" aria-label="Invoice date to" value={toDate} onChange={(event) => setToDate(event.target.value)} className={filterClass} />
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className={filterClass}
          >
            <option value="All">All Status</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <DataTable
          columns={["Invoice", "Category", "Student", "Room", "Month", "Amount", "Prev. Balance", "Paid", "Outstanding", "Due Date", "Status", "Action"]}
          isLoading={isLoading}
          loadError={loadError}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={invoices.length === 0 ? "No invoices yet. They appear once a student is allocated." : "No invoices match your search."}
          minWidth="min-w-[1180px]"
        >
          {pageItems.map((item) => (
            <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-4">
                <button onClick={() => setOpenInvoice(item.id)} aria-label={`View invoice ${item.invoiceNumber}`} className={linkButton}>
                  {item.invoiceNumber}
                </button>
                <p className="text-xs text-slate-500">{item.createdDate}</p>
              </td>
              <td className="px-4 py-4 text-slate-600">
                {CATEGORY_LABELS[item.category]}
                {item.category !== "RENT" && <p className="max-w-[12rem] truncate text-xs text-slate-500">{item.title}</p>}
              </td>
              <td className="px-4 py-4">
                <Link href={`/admin/hostel/ledger/${item.allocationId}`} className={linkButton}>
                  {item.studentName}
                </Link>
                <p className="text-xs text-slate-500">{item.studentId}</p>
              </td>
              <td className="px-4 py-4 text-slate-600">
                {item.roomNumber || "—"}
                <p className="text-xs text-slate-500">Seat {item.seatNumber ?? "—"}</p>
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatMonth(item.billingMonth)}</td>
              <td className="px-4 py-4 tabular-nums text-slate-600">{money(item.amountDue)}</td>
              <td className="px-4 py-4 tabular-nums text-slate-600">{money(item.previousOutstanding)}</td>
              <td className="px-4 py-4 tabular-nums text-slate-600">{money(item.paidAmount)}</td>
              <td className="px-4 py-4 font-medium tabular-nums text-slate-800">{money(item.outstandingAmount)}</td>
              <td className="whitespace-nowrap px-4 py-4 text-slate-600">{item.dueDate}</td>
              <td className="px-4 py-4">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-4 py-4">
                <div className="flex gap-3 whitespace-nowrap">
                  {canPay && item.outstandingAmount > 0 && (
                    <button
                      onClick={() => setForm({ type: "pay", invoice: item })}
                      aria-label={`Record payment on ${item.invoiceNumber}`}
                      className={linkButton}
                    >
                      Record Payment
                    </button>
                  )}
                  {canPay && item.outstandingAmount > 0 && (
                    <button
                      onClick={() => handlePaymentLink(item)}
                      aria-label={`Copy payment link for ${item.invoiceNumber}`}
                      className={linkButton}
                    >
                      Copy Pay Link
                    </button>
                  )}
                  {canPay && (
                    <button
                      onClick={() => setForm({ type: "adjust", invoice: item })}
                      aria-label={`Adjust ${item.invoiceNumber}`}
                      className={linkButton}
                    >
                      Adjust
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
      </div>

      {openInvoice && <InvoiceDetail invoiceId={openInvoice} onClose={() => setOpenInvoice(null)} onChanged={reload} />}
      {form?.type === "pay" && (
        <PaymentForm invoice={form.invoice} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
      {form?.type === "adjust" && (
        <AdjustmentForm invoice={form.invoice} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
    </PageShell>
  );
}
