"use client";

import { useEffect, useState } from "react";
import { PUBLIC_API, formatMonth, money, publicRequest, rememberToken } from "./publicApi";

const STATUS_STYLES = {
  Paid: "bg-green-100 text-green-800",
  "Partially Paid": "bg-blue-100 text-blue-800",
  Unpaid: "bg-yellow-100 text-yellow-800",
  Overdue: "bg-red-100 text-red-800",
  Waived: "bg-slate-100 text-slate-700",
};

function Row({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-right ${strong ? "font-bold text-slate-900" : "font-medium text-slate-800"}`}>{value}</dd>
    </div>
  );
}

function ExpiredLink({ token }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  const request = async () => {
    setError("");
    setIsSending(true);
    try {
      const result = await publicRequest(`/pay/${token}/renew`, { method: "POST" });
      setMessage(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Notice title="This link has expired">
      <p>Payment links work for a limited time. We can email a new one to the address on your hostel record.</p>
      {message && <p role="status" className="mt-3 font-medium text-green-700">{message}</p>}
      {error && <p role="alert" className="mt-3 text-red-600">{error}</p>}
      {!message && (
        <button onClick={request} disabled={isSending} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60">
          {isSending ? "Sending..." : "Email Me a New Link"}
        </button>
      )}
    </Notice>
  );
}

function Notice({ title, children }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-slate-900">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export default function PaymentPortal({ token }) {
  const [state, setState] = useState({ status: "loading" });
  const [selectedNumber, setSelectedNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [payError, setPayError] = useState("");
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    publicRequest(`/pay/${token}`)
      .then((data) => {
        if (!isCurrent) return;
        const first = data.invoice.outstandingAmount > 0
          ? data.invoice
          : data.invoices.find((item) => item.outstandingAmount > 0) || data.invoice;
        setSelectedNumber(first.invoiceNumber);
        setAmount(String(first.outstandingAmount));
        setState({ status: "ready", data });
      })
      .catch((err) => {
        if (isCurrent) setState({ status: err.status === 410 ? "expired" : "error", message: err.message });
      });
    return () => {
      isCurrent = false;
    };
  }, [token]);

  if (state.status === "loading") {
    return <Notice title="Loading your invoice...">Please wait.</Notice>;
  }
  if (state.status === "expired") return <ExpiredLink token={token} />;
  if (state.status === "error") {
    return <Notice title="We could not open this page"><p role="alert">{state.message}</p></Notice>;
  }

  const { data } = state;
  const unpaid = data.invoices.filter((item) => item.outstandingAmount > 0);
  const selected = data.invoices.find((item) => item.invoiceNumber === selectedNumber) || data.invoice;
  const canPay = data.online.bkash && selected.outstandingAmount > 0;

  const choose = (number) => {
    const invoice = data.invoices.find((item) => item.invoiceNumber === number);
    setSelectedNumber(number);
    setAmount(String(invoice.outstandingAmount));
    setPayError("");
  };

  const handlePay = async (event) => {
    event.preventDefault();
    setPayError("");
    setIsPaying(true);
    try {
      const result = await publicRequest(`/pay/${token}/bkash`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), invoiceNumber: selected.invoiceNumber }),
      });
      rememberToken(token);
      window.location.assign(result.checkoutUrl);
    } catch (err) {
      setPayError(err.message);
      setIsPaying(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <header>
          <p className="text-sm font-medium text-slate-500">{data.brandName}</p>
          <h1 className="text-2xl font-bold text-slate-900">Hostel Rent Payment</h1>
        </header>

        {data.online.sandbox && (
          <p role="status" className="rounded-lg bg-amber-100 p-3 text-sm font-medium text-amber-900">
            Test mode. Payments here use the bKash sandbox and no real money moves.
          </p>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h2 className="font-bold text-slate-900">{formatMonth(selected.billingMonth)}</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[selected.status] || ""}`}>
              {selected.status}
            </span>
          </div>
          <dl>
            <Row label="Student" value={`${data.student.name} (${data.student.id})`} />
            <Row label="Building" value={`${data.location.hostel}, ${data.location.building}`} />
            <Row label="Room / Seat" value={`Room ${data.location.room}, Seat ${data.location.seat ?? "-"}`} />
            <Row label="Invoice Number" value={selected.invoiceNumber} />
            <Row label="Monthly Rent" value={money(selected.monthlyRent)} />
            <Row label="Previous Outstanding" value={money(selected.previousOutstanding)} />
            <Row label="Total Payable" value={money(selected.totalPayable)} />
            <Row label="Already Paid" value={money(selected.paidAmount)} />
            <Row label="Payment Deadline" value={selected.dueDate} />
            <Row label="Outstanding On This Invoice" value={money(selected.outstandingAmount)} strong />
            <Row label="Total Outstanding (All Months)" value={money(data.totalOutstanding)} strong />
          </dl>
        </section>

        {selected.outstandingAmount <= 0 && unpaid.length === 0 && (
          <p role="status" className="rounded-lg bg-green-100 p-4 text-sm font-medium text-green-800">
            This rent is fully paid. Thank you.
          </p>
        )}

        {selected.outstandingAmount > 0 && !data.online.bkash && (
          <p role="status" className="rounded-lg bg-slate-200 p-4 text-sm text-slate-700">
            Online payment is not available right now. Please pay at the hostel office.
          </p>
        )}

        {data.online.bkash && unpaid.length > 0 && (
          <form onSubmit={handlePay} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Pay With bKash</h2>
            {unpaid.length > 1 && (
              <div>
                <label htmlFor="pay-invoice" className="mb-1 block text-sm font-medium text-slate-700">Invoice</label>
                <select
                  id="pay-invoice"
                  value={selected.invoiceNumber}
                  onChange={(event) => choose(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-3 text-base"
                >
                  {unpaid.map((item) => (
                    <option key={item.invoiceNumber} value={item.invoiceNumber}>
                      {formatMonth(item.billingMonth)}: {money(item.outstandingAmount)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="pay-amount" className="mb-1 block text-sm font-medium text-slate-700">Amount to Pay (BDT)</label>
              <input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min={data.online.minAmount}
                max={selected.outstandingAmount}
                step="0.01"
                required
                readOnly={!data.online.allowPartial}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-3 text-lg font-semibold read-only:bg-slate-100"
              />
              <p className="mt-1 text-xs text-slate-500">
                {data.online.allowPartial
                  ? `You can pay part of this amount, up to ${money(selected.outstandingAmount)}.`
                  : "This invoice must be paid in full."}
              </p>
            </div>
            {payError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{payError}</p>}
            <button
              type="submit"
              disabled={isPaying || !canPay}
              className="w-full rounded-lg bg-[#e2136e] py-3 text-base font-bold text-white hover:bg-[#c2105e] disabled:opacity-60"
            >
              {isPaying ? "Opening bKash..." : "Pay With bKash"}
            </button>
            <p className="text-center text-xs text-slate-500">
              You will finish on the bKash page. We record the payment only after bKash confirms it.
            </p>
          </form>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-bold text-slate-900">Invoice History</h2>
          <ul className="divide-y divide-slate-100">
            {data.invoices.map((item) => (
              <li key={item.invoiceNumber} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <button type="button" onClick={() => choose(item.invoiceNumber)} className="font-medium text-blue-700 hover:underline">
                  {formatMonth(item.billingMonth)}
                </button>
                <span className="text-slate-600">{money(item.outstandingAmount)} left</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status] || ""}`}>{item.status}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-2 font-bold text-slate-900">Payment History</h2>
          {data.payments.length === 0 && <p className="text-sm text-slate-500">No payments yet.</p>}
          <ul className="divide-y divide-slate-100">
            {data.payments.map((item) => (
              <li key={item.reference} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{money(item.amount)} · {item.method}</p>
                  <p className="text-xs text-slate-500">
                    {item.paymentDate} · {item.receiptNumber}
                    {item.status === "Reversed" ? " · Reversed" : ""}
                  </p>
                </div>
                <a href={`${PUBLIC_API}/pay/${token}/receipts/${item.reference}`} className="font-medium text-blue-700 hover:underline">
                  Download Receipt
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
