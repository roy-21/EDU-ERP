"use client";

import { useEffect, useState } from "react";
import { PUBLIC_API, formatMonth, money, publicRequest, recallToken } from "./publicApi";

const POLL_MS = 5_000;

const CONTENT = {
  Completed: { title: "Payment Successful", tone: "text-green-700", text: "bKash confirmed your payment and your balance is updated." },
  Initiated: { title: "Confirming Your Payment", tone: "text-blue-700", text: "We are checking with bKash. If money left your account, it will be recorded automatically, even if you close this page." },
  Created: { title: "Confirming Your Payment", tone: "text-blue-700", text: "We are checking with bKash. You can safely close this page." },
  Cancelled: { title: "Payment Cancelled", tone: "text-slate-800", text: "You cancelled at bKash. No rent was recorded." },
  Failed: { title: "Payment Failed", tone: "text-red-700", text: "The payment did not go through, and no rent was recorded." },
  Expired: { title: "Payment Expired", tone: "text-slate-800", text: "This payment was not completed in time, and no rent was recorded." },
  Review: { title: "Payment Being Reviewed", tone: "text-amber-700", text: "bKash reported a payment, but it could not be applied automatically. The hostel office has been told and will contact you." },
};

export default function PaymentResult({ reference }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [backToken, setBackToken] = useState("");

  useEffect(() => {
    let timer;
    let isCurrent = true;
    const load = async () => {
      try {
        const data = await publicRequest(`/payment-result/${reference}`);
        if (!isCurrent) return;
        setResult(data);
        setBackToken(recallToken());
        if (data.status === "Initiated" || data.status === "Created") timer = setTimeout(load, POLL_MS);
      } catch (err) {
        if (isCurrent) setError(err.message);
      }
    };
    load();
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [reference]);

  const content = result ? CONTENT[result.status] : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        {!result && !error && <p className="text-sm text-slate-500">Checking your payment...</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        {result && (
          <>
            <p className="text-sm font-medium text-slate-500">{result.brandName}</p>
            <h1 className={`mt-1 text-2xl font-bold ${content.tone}`}>{content.title}</h1>
            <p className="mt-2 text-sm text-slate-600">{content.text}</p>
            {result.message && <p className="mt-2 text-sm text-slate-600">bKash said: {result.message}</p>}

            <dl className="mt-4 divide-y divide-slate-100 text-sm">
              {[
                ["Student", `${result.studentName} (${result.studentId})`],
                ["Invoice", result.invoiceNumber],
                ["Billing Month", formatMonth(result.billingMonth)],
                ["Amount", money(result.amount)],
                ...(result.trxId ? [["bKash Transaction ID", result.trxId]] : []),
                ...(result.receiptNumber ? [["Receipt Number", result.receiptNumber]] : []),
                ["Remaining On This Invoice", money(result.remainingBalance)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-right font-medium text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 flex flex-col gap-3">
              {result.status === "Completed" && (
                <a
                  href={`${PUBLIC_API}/payment-result/${reference}/receipt`}
                  className="rounded-lg bg-slate-900 py-3 text-center font-medium text-white"
                >
                  Download Receipt (PDF)
                </a>
              )}
              {backToken && (
                <a href={`/hostel/payment/${backToken}`} className="rounded-lg border border-slate-300 py-3 text-center font-medium text-slate-700">
                  Back to My Invoice
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
