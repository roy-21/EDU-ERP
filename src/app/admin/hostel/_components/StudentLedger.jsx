"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { EditAllocationForm } from "./AllocationForms";
import { CATEGORY_LABELS, DocumentPreview, InvoiceDetail } from "./hostelViews";
import { AdjustmentForm, PaymentForm, ReverseForm, downloadReceiptPdf, printReceipt } from "./RentForms";
import {
  DataTable,
  ErrorBanner,
  PageShell,
  StatGrid,
  StatusBadge,
  dangerButton,
  formatDateTime,
  formatMonth,
  friendlyError,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useHostelData,
} from "./hostelUi";

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-800">{value || "—"}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-4 font-bold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

const crumbs = [{ href: "/admin/hostel/due-rent", label: "Due Rent" }];

// The student's own sign-in for the student portal, made from this record.
function PortalAccount({ allocation, canCreate }) {
  const load = useCallback(() => hostelService.getPortalAccount(allocation.id), [allocation.id]);
  const { data: account, isLoading, reload } = useHostelData(load);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const create = async () => {
    setIsBusy(true);
    setMessage("");
    try {
      const result = await hostelService.createPortalAccount(allocation.id);
      setMessage(result.credentials.delivered
        ? `Account ${result.user.username} created. The sign-in details were emailed to ${allocation.studentEmail}.`
        : `Account ${result.user.username} created, but the email was not sent: ${result.credentials.reason} Send a new password from the Users page.`);
      reload();
    } catch (err) {
      setMessage(friendlyError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Section title="Student Portal Account">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {isLoading ? (
          <p className="text-slate-500">Checking...</p>
        ) : account ? (
          <p className="text-slate-700">
            Username <span className="font-mono font-semibold">{account.username}</span> · {account.status === "ACTIVE" ? "Active" : "Inactive"} ·{" "}
            {account.lastLoginAt ? `last signed in ${formatDateTime(account.lastLoginAt)}` : "never signed in"}
          </p>
        ) : (
          <p className="text-slate-600">
            No account yet. With one, the student can see their bills, pay online and order meals themselves.
            {!allocation.studentEmail && " Add the student's email first; the sign-in details are sent there."}
          </p>
        )}
        {!isLoading && !account && canCreate && (
          <button onClick={create} disabled={isBusy || !allocation.studentEmail} className={`${secondaryButton} disabled:opacity-50`}>
            {isBusy ? "Creating..." : "Create Portal Account"}
          </button>
        )}
      </div>
      {message && <p role="status" className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
    </Section>
  );
}

export default function StudentLedger({ allocationId }) {
  const { has } = useHostelPermissions();
  const load = useCallback(() => hostelService.getLedger(allocationId), [allocationId]);
  const { data, error: loadError, isLoading, reload } = useHostelData(load);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const [openInvoice, setOpenInvoice] = useState(null);
  const canSeeMeals = has("manage_meals", "manage_payments", "view_due_rent");
  const loadMeals = useCallback(
    () => (canSeeMeals ? hostelService.getMemberMeals(allocationId) : Promise.resolve(null)),
    [allocationId, canSeeMeals]
  );
  const { data: meals } = useHostelData(loadMeals);
  const loadPreview = useCallback(() => hostelService.getDocument(preview), [preview]);

  if (isLoading || loadError || !data) {
    return (
      <PageShell title="Student Rent Record" crumbs={crumbs}>
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          {isLoading && "Loading..."}
          {!isLoading && (
            <span role="alert" className="text-red-600">
              {loadError}
            </span>
          )}
        </div>
      </PageShell>
    );
  }

  const { allocation, invoices, payments, adjustments, notifications, documents } = data;
  const canPay = has("manage_payments");

  const handleSaved = () => {
    setForm(null);
    reload();
  };

  const handleRemind = async () => {
    setError("");
    setNotice("");
    try {
      const result = await hostelService.sendReminder(allocationId);
      setNotice(
        result.alreadySentToday
          ? "A manual reminder was already sent to this student today."
          : `Reminder result. ${result.channels
              .map((item) => `${item.channel}: ${item.status}${item.error ? ` (${item.error})` : ""}`)
              .join(". ")}`
      );
      reload();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const handleOpenDocument = (id) => setPreview(id);

  const handleResend = async () => {
    setError("");
    setNotice("");
    try {
      const result = await hostelService.resendAllocationEmail(allocationId);
      setNotice(result.status === "Sent" ? `Confirmation sent to ${result.recipient}.` : `Confirmation not sent (${result.status}). ${result.error || ""}`);
      reload();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const handlePrint = (payment) => {
    setError("");
    try {
      printReceipt(payment);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const handlePdf = async (payment) => {
    setError("");
    try {
      await downloadReceiptPdf(payment.id);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const handleEmailReceipt = async (payment) => {
    setError("");
    try {
      const result = await hostelService.emailReceipt(payment.id);
      if (result.status === "Sent") window.alert(`Receipt sent to ${result.recipient}.`);
      else setError(`Receipt not sent (${result.status}). ${result.error}`);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const stats = [
    { label: "Total Outstanding", value: money(data.totalOutstanding), color: "text-orange-600" },
    { label: "Overdue", value: money(data.totalOverdue), color: "text-red-600" },
    { label: "Monthly Rent", value: money(allocation.monthlyRent) },
    { label: "Security Deposit", value: money(allocation.securityDeposit) },
    { label: "Invoices", value: invoices.length },
  ];

  return (
    <PageShell
      title={allocation.studentName}
      subtitle={`${allocation.studentId} · ${allocation.roomLabel || "No room"}${
        allocation.seatNumber ? ` · Seat ${allocation.seatNumber}` : ""
      }`}
      crumbs={crumbs}
      actions={
        <>
          {has("send_reminders") && (
            <button onClick={handleRemind} className={secondaryButton}>
              Send Reminder
            </button>
          )}
          {has("manage_allocations") && allocation.status === "Allocated" && (
            <button onClick={handleResend} className={secondaryButton}>
              Resend Seat Confirmation
            </button>
          )}
          {has("manage_allocations", "manage_students") &&
            ["Pending", "Allocated"].includes(allocation.status) && (
              <button onClick={() => setForm({ type: "edit" })} className={primaryButton}>
                Edit Allocation
              </button>
            )}
        </>
      }
    >
      <StatGrid stats={stats} />
      <ErrorBanner message={error} onDismiss={() => setError("")} />
      {notice && (
        <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          {notice}
        </p>
      )}

      <PortalAccount allocation={allocation} canCreate={has("manage_allocations", "manage_students")} />

      <Section title="Student and Allocation">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Allocation Status</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <StatusBadge status={allocation.status} />
              {allocation.status === "Allocated" && (
                <StatusBadge status={allocation.billingActive ? "Active" : "Inactive"} />
              )}
            </div>
          </div>
          <Info label="Student Phone" value={allocation.studentPhone} />
          <Info label="Student Email" value={allocation.studentEmail} />
          <Info label="Student NID" value={allocation.studentNid} />
          <Info label="Department" value={allocation.department} />
          <Info label="Guardian" value={allocation.guardianName} />
          <Info label="Guardian Phone" value={allocation.guardianPhone} />
          <Info label="Relationship" value={allocation.guardianRelationship} />
          <Info label="Guardian NID" value={allocation.guardianNid} />
          <Info label="Start Date" value={allocation.startDate} />
          <Info label="End Date" value={allocation.endDate} />
          <Info label="Initial Due Date" value={allocation.firstDueDate} />
        </div>
        {allocation.roomId && has("view_rooms") && (
          <Link href={`/admin/hostel/rooms/${allocation.roomId}`} className={`mt-4 inline-block text-sm ${linkButton}`}>
            Open room
          </Link>
        )}
        {documents.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs text-slate-500">Documents</p>
            <div className="flex flex-wrap gap-4 text-sm">
              {documents.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleOpenDocument(item.id)}
                  aria-label={`Preview ${item.documentType.replace("_", " ")}`}
                  className={linkButton}
                >
                  {item.documentType.replace("_", " ")}: {item.fileName}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Invoices">
        <DataTable
          columns={["Invoice", "Category", "Month", "Charge", "Adjust.", "Prev. Balance", "Total Payable", "Paid", "Outstanding", "Due Date", "Status", "Action"]}
          hasRows={invoices.length > 0}
          emptyMessage="No invoices yet."
          minWidth="min-w-[1120px]"
        >
          {invoices.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="whitespace-nowrap px-4 py-3">
                <button onClick={() => setOpenInvoice(item.id)} aria-label={`View invoice ${item.invoiceNumber}`} className={linkButton}>
                  {item.invoiceNumber}
                </button>
              </td>
              <td className="px-4 py-3 text-slate-600">
                {CATEGORY_LABELS[item.category]}
                {item.category !== "RENT" && <p className="text-xs text-slate-500">{item.title}</p>}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatMonth(item.billingMonth)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.rentAmount)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.adjustmentTotal)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.previousOutstanding)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.totalPayable)}</td>
              <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.paidAmount)}</td>
              <td className="px-4 py-3 font-medium tabular-nums text-slate-800">{money(item.outstandingAmount)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                {item.dueDate}
                {item.overdueDays > 0 && <p className="text-xs text-red-600">{item.overdueDays} day(s) late</p>}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-4 py-3">
                {canPay && (
                  <div className="flex gap-3 whitespace-nowrap">
                    {item.outstandingAmount > 0 && (
                      <button
                        onClick={() => setForm({ type: "pay", invoice: item })}
                        aria-label={`Record payment on ${item.invoiceNumber}`}
                        className={linkButton}
                      >
                        Record Payment
                      </button>
                    )}
                    <button
                      onClick={() => setForm({ type: "adjust", invoice: item })}
                      aria-label={`Adjust ${item.invoiceNumber}`}
                      className={linkButton}
                    >
                      Adjust
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
        <p className="mt-3 text-xs text-slate-500">
          Previous Balance shows what was unpaid when the invoice was issued. Total Outstanding above
          adds each invoice&apos;s own balance once, so old debt is never counted twice.
        </p>
      </Section>

      <Section title="Payment History">
        <DataTable
          columns={["Receipt", "Month", "Amount", "Date", "Method", "Reference", "Recorded By", "Status", "Action"]}
          hasRows={payments.length > 0}
          emptyMessage="No payments recorded."
          minWidth="min-w-[960px]"
        >
          {payments.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.receiptNumber}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatMonth(item.billingMonth)}</td>
              <td className="px-4 py-3 font-medium tabular-nums text-slate-800">{money(item.amount)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.paymentDate}</td>
              <td className="px-4 py-3 text-slate-600">{item.method}</td>
              <td className="px-4 py-3 text-slate-600">{item.transactionReference || "—"}</td>
              <td className="px-4 py-3 text-slate-600">{item.recordedBy}</td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
                {item.reversalReason && <p className="mt-1 text-xs text-slate-500">{item.reversalReason}</p>}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-3 whitespace-nowrap">
                  <button
                    onClick={() => handlePrint(item)}
                    aria-label={`Print receipt ${item.receiptNumber}`}
                    className={linkButton}
                  >
                    Receipt
                  </button>
                  {canPay && (
                    <>
                      <button onClick={() => handlePdf(item)} aria-label={`Download PDF of ${item.receiptNumber}`} className={linkButton}>
                        PDF
                      </button>
                      <button onClick={() => handleEmailReceipt(item)} aria-label={`Email ${item.receiptNumber}`} className={linkButton}>
                        Email
                      </button>
                    </>
                  )}
                  {canPay && item.status === "Confirmed" && (
                    <button
                      onClick={() => setForm({ type: "reverse", payment: item })}
                      aria-label={`Reverse ${item.receiptNumber}`}
                      className={dangerButton}
                    >
                      Reverse
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      {adjustments.length > 0 && (
        <Section title="Adjustments">
          <DataTable
            columns={["Invoice", "Month", "Amount", "Reason", "By", "When"]}
            hasRows
            minWidth="min-w-[720px]"
          >
            {adjustments.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.invoiceNumber}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatMonth(item.billingMonth)}</td>
                <td className="px-4 py-3 tabular-nums text-slate-800">{money(item.amount)}</td>
                <td className="px-4 py-3 text-slate-600">{item.reason}</td>
                <td className="px-4 py-3 text-slate-600">{item.createdBy}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}

      {meals && (
        <Section title="Meal History">
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-5">
            <Info label="Meals Ordered" value={String(meals.totalMealsOrdered)} />
            <Info label="Meals Collected" value={String(meals.totalMealsCollected)} />
            <Info label="Total Meal Cost" value={money(meals.totalCost)} />
            <Info label="Paid" value={money(meals.totalPaid)} />
            <Info label="Outstanding" value={money(meals.totalOutstanding)} />
          </div>
          <DataTable
            columns={["Meal", "Date", "Quantity", "Total", "Paid", "Outstanding", "Status"]}
            hasRows={meals.orders.length > 0}
            emptyMessage="No meal orders yet."
            minWidth="min-w-[720px]"
          >
            {meals.orders.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-3 text-slate-700">{item.mealTitle} <span className="text-xs text-slate-500">({item.mealType})</span></td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.mealDate}</td>
                <td className="px-4 py-3 text-slate-600">{item.quantity}</td>
                <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.totalPrice)}</td>
                <td className="px-4 py-3 tabular-nums text-slate-600">{money(item.paidAmount)}</td>
                <td className="px-4 py-3 tabular-nums text-slate-800">{money(item.outstandingAmount)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                  {item.collectedAt && <p className="mt-1 text-xs text-slate-500">Collected</p>}
                </td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}

      <Section title="Notifications">
        <DataTable
          columns={["When", "Type", "Channel", "To", "Status", "Details"]}
          hasRows={notifications.length > 0}
          emptyMessage="No notifications yet."
          minWidth="min-w-[760px]"
        >
          {notifications.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(item.createdAt)}</td>
              <td className="px-4 py-3 text-slate-600">{item.scenario}</td>
              <td className="px-4 py-3 text-slate-600">{item.channel}</td>
              <td className="px-4 py-3 text-slate-600">{item.recipient || "—"}</td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">{item.lastError || "—"}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      {form?.type === "pay" && (
        <PaymentForm invoice={form.invoice} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
      {form?.type === "adjust" && (
        <AdjustmentForm invoice={form.invoice} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
      {form?.type === "reverse" && (
        <ReverseForm payment={form.payment} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
      {preview && <DocumentPreview load={loadPreview} onClose={() => setPreview(null)} />}
      {openInvoice && <InvoiceDetail invoiceId={openInvoice} onClose={() => setOpenInvoice(null)} onChanged={reload} />}
      {form?.type === "edit" && (
        <EditAllocationForm allocationId={allocationId} onClose={() => setForm(null)} onSaved={handleSaved} />
      )}
    </PageShell>
  );
}
