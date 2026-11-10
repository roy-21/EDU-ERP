"use client";

import { useEffect, useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { printTable } from "./hostelExport";
import { makeId } from "./hostelStore";
import {
  FormModal,
  SelectField,
  TextField,
  formatMonth,
  money,
} from "./hostelUi";

const todayText = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export function PaymentForm({ invoice, onClose, onSaved }) {
  const [form, setForm] = useState({
    amount: String(invoice.outstandingAmount),
    paymentDate: todayText(),
    method: "Cash",
    transactionReference: "",
    notes: "",
  });
  const [methods, setMethods] = useState(["Cash"]);
  // Stays the same for this form, so a double submit cannot pay twice.
  const [idempotencyKey] = useState(() => makeId("payment"));

  useEffect(() => {
    let isCurrent = true;
    hostelService
      .getPaymentMethods()
      .then((list) => {
        if (isCurrent) setMethods(list.filter((item) => item.enabled).map((item) => item.method));
      })
      .catch(() => {
        // The backend still checks the method when the payment is saved.
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  const setValue = (key) => (value) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const handleSubmit = async () => {
    await hostelService.recordPayment(invoice.id, {
      ...form,
      amount: Number(form.amount),
      idempotencyKey,
    });
    onSaved();
  };

  return (
    <FormModal
      title={`Record Payment: ${invoice.invoiceNumber}`}
      submitLabel="Record Payment"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <p className="text-sm text-slate-600 sm:col-span-2">
        {invoice.studentName} · {formatMonth(invoice.billingMonth)} · Outstanding{" "}
        <strong>{money(invoice.outstandingAmount)}</strong>
      </p>
      <TextField
        id="payment-amount"
        label="Amount (৳) *"
        type="number"
        min="0"
        step="0.01"
        value={form.amount}
        onChange={setValue("amount")}
      />
      <TextField
        id="payment-date"
        label="Payment Date *"
        type="date"
        value={form.paymentDate}
        onChange={setValue("paymentDate")}
      />
      <SelectField
        id="payment-method"
        label="Payment Method *"
        value={form.method}
        onChange={setValue("method")}
        options={methods}
      />
      <TextField
        id="payment-reference"
        label="Transaction Reference"
        value={form.transactionReference}
        onChange={setValue("transactionReference")}
      />
      <TextField
        id="payment-notes"
        label="Notes"
        value={form.notes}
        maxLength={500}
        onChange={setValue("notes")}
        wide
      />
    </FormModal>
  );
}

export function AdjustmentForm({ invoice, onClose, onSaved }) {
  const [type, setType] = useState("reduce");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const handleSubmit = async () => {
    const value = Number(amount);
    if (!(value > 0)) throw new Error("Enter an amount greater than 0.");

    await hostelService.adjustInvoice(invoice.id, {
      amount: type === "reduce" ? -value : value,
      reason,
    });
    onSaved();
  };

  return (
    <FormModal
      title={`Adjust Invoice: ${invoice.invoiceNumber}`}
      submitLabel="Save Adjustment"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <p className="text-sm text-slate-600 sm:col-span-2">
        Currently owed on this invoice: <strong>{money(invoice.amountDue)}</strong>. The original rent
        stays on record, and the change is logged.
      </p>
      <SelectField
        id="adjustment-type"
        label="Type"
        value={type}
        onChange={setType}
        options={[
          { value: "reduce", label: "Reduce the amount (discount or waiver)" },
          { value: "increase", label: "Increase the amount (extra charge)" },
        ]}
      />
      <TextField
        id="adjustment-amount"
        label="Amount (৳) *"
        type="number"
        min="0"
        step="0.01"
        value={amount}
        onChange={setAmount}
      />
      <TextField
        id="adjustment-reason"
        label="Reason *"
        value={reason}
        maxLength={500}
        onChange={setReason}
        wide
      />
    </FormModal>
  );
}

export function ReverseForm({ payment, onClose, onSaved }) {
  const [reason, setReason] = useState("");

  const handleSubmit = async () => {
    await hostelService.reversePayment(payment.id, reason);
    onSaved();
  };

  return (
    <FormModal
      title={`Reverse Payment: ${payment.receiptNumber}`}
      submitLabel="Reverse Payment"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <p className="text-sm text-slate-600 sm:col-span-2">
        {money(payment.amount)} goes back onto the invoice balance. The payment stays on record as
        Reversed.
      </p>
      <TextField
        id="reverse-reason"
        label="Reason *"
        value={reason}
        maxLength={500}
        onChange={setReason}
        wide
      />
    </FormModal>
  );
}

export const downloadReceiptPdf = async (paymentId) => {
  const file = await hostelService.getReceiptPdf(paymentId);
  const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export const printReceipt = (payment) => {
  const rows = [
    ["Receipt Number", payment.receiptNumber],
    ["Status", payment.status],
    ["Student", `${payment.studentName} (${payment.studentId})`],
    ["Invoice", payment.invoiceNumber],
    ["Billing Month", formatMonth(payment.billingMonth)],
    ["Room", `${payment.hostelName} · ${payment.buildingName} · Room ${payment.roomNumber} · Seat ${payment.seatNumber ?? "—"}`],
    ["Amount Paid", money(payment.amount)],
    ["Payment Date", payment.paymentDate],
    ["Payment Method", payment.method],
    ["Transaction Reference", payment.transactionReference || "—"],
    ["Recorded By", payment.recordedBy],
    ["Notes", payment.notes || "—"],
    ...(payment.status === "Reversed" ? [["Reversal Reason", payment.reversalReason]] : []),
  ];

  printTable(
    "Hostel Rent Receipt",
    [
      { label: "Detail", value: (row) => row[0] },
      { label: "Value", value: (row) => row[1] },
    ],
    rows
  );
};
