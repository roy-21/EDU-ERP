"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { tenancyApi } from "@/lib/identityServices";

const TYPES = ["University", "College", "School", "Madrasa", "Training Center", "Other"];
const input = "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const taka = (value) => `৳${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function Text({ id, label, value, onChange, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={input} {...props} />
    </div>
  );
}

export default function RegisterPage() {
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState({ institutionName: "", institutionCode: "", type: "University", contactName: "", email: "", phone: "", address: "", note: "" });
  const [modules, setModules] = useState([]);
  const [cycle, setCycle] = useState("MONTHLY");
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [done, setDone] = useState(null);
  const set = (key) => (value) => setForm((previous) => ({ ...previous, [key]: value }));

  useEffect(() => {
    tenancyApi.plans().then(setPlans).catch(() => setError("The module list could not be loaded. Please try again later."));
  }, []);

  // The total shown is the server's own calculation.
  useEffect(() => {
    let isCurrent = true;
    tenancyApi.quote(modules, cycle).then((result) => isCurrent && setQuote(result)).catch(() => isCurrent && setQuote(null));
    return () => { isCurrent = false; };
  }, [modules, cycle]);

  const grouped = useMemo(() => {
    const optional = (plans || []).filter((item) => !item.isCore);
    return [...new Set(optional.map((item) => item.category))].map((category) => ({ category, items: optional.filter((item) => item.category === category) }));
  }, [plans]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (modules.length === 0) return setError("Choose at least one module.");
    setIsSending(true);
    try {
      setDone(await tenancyApi.register({ ...form, moduleIds: modules, billingCycle: cycle }));
    } catch (err) {
      setError(err.message || "Registration failed.");
    } finally {
      setIsSending(false);
    }
  };

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Registration received</h1>
          <p className="mt-3 text-slate-600">
            We will review {form.institutionName}. When it is approved, the sign-in details for your admin account (username <strong>admin.{form.institutionCode.toLowerCase()}</strong>) are emailed to {form.email}.
          </p>
          <p className="mt-3 text-sm text-slate-500">Reference: <span className="font-mono">{done.reference}</span></p>
          <p className="mt-1 text-sm text-slate-500">Plan: {taka(done.periodTotal)} {done.billingCycle === "YEARLY" ? "a year" : "a month"}</p>
          <Link href="/" className="mt-6 inline-block font-semibold text-blue-700 hover:underline">Back to home</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10">
      <form onSubmit={submit} className="mx-auto max-w-5xl space-y-6" noValidate>
        <div>
          <Link href="/" className="text-sm text-blue-700 hover:underline">← Home</Link>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Register your institution</h1>
          <p className="mt-1 text-slate-600">Choose your modules. Your account opens once our team approves the registration.</p>
        </div>

        <section className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-6 md:grid-cols-2">
          <Text id="reg-name" label="Institution name *" value={form.institutionName} onChange={set("institutionName")} maxLength={255} required />
          <Text id="reg-code" label="Short code * (2 to 20 letters or numbers)" value={form.institutionCode} onChange={(value) => set("institutionCode")(value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} maxLength={20} required />
          <div>
            <label htmlFor="reg-type" className="mb-1 block text-sm font-medium text-slate-700">Type</label>
            <select id="reg-type" value={form.type} onChange={(e) => set("type")(e.target.value)} className={input}>
              {TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </div>
          <Text id="reg-contact" label="Your name *" value={form.contactName} onChange={set("contactName")} maxLength={150} required />
          <Text id="reg-email" label="Email * (your admin sign-in goes here)" type="email" value={form.email} onChange={set("email")} maxLength={255} required />
          <Text id="reg-phone" label="Phone *" type="tel" value={form.phone} onChange={set("phone")} maxLength={30} required />
          <div className="md:col-span-2"><Text id="reg-address" label="Address" value={form.address} onChange={set("address")} maxLength={500} /></div>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">Modules</h2>
            <div role="radiogroup" aria-label="Billing cycle" className="flex rounded-lg border border-slate-300 p-1 text-sm">
              {["MONTHLY", "YEARLY"].map((value) => (
                <button key={value} type="button" role="radio" aria-checked={cycle === value} onClick={() => setCycle(value)} className={`rounded-md px-3 py-1.5 ${cycle === value ? "bg-blue-700 text-white" : "text-slate-600"}`}>
                  {value === "MONTHLY" ? "Monthly" : "Yearly (pay 10 months)"}
                </button>
              ))}
            </div>
          </div>
          {!plans && !error && <p className="text-sm text-slate-500">Loading modules...</p>}
          {grouped.map((group) => (
            <fieldset key={group.category}>
              <legend className="mb-2 text-sm font-semibold text-slate-500">{group.category}</legend>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <label key={item.id} className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${modules.includes(item.id) ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={modules.includes(item.id)} onChange={(e) => setModules(e.target.checked ? [...modules, item.id] : modules.filter((id) => id !== item.id))} />
                      {item.icon} {item.name}
                    </span>
                    <span className="whitespace-nowrap text-slate-500">{taka(item.monthlyPrice)}/mo</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">Total {cycle === "YEARLY" ? "per year" : "per month"}</p>
            <p className="text-3xl font-extrabold text-slate-900" aria-live="polite">{quote ? taka(quote.periodTotal) : "—"}</p>
            <p className="text-xs text-slate-500">Core modules are included free.</p>
          </div>
          <div className="flex-1 md:max-w-sm">
            <label htmlFor="reg-note" className="mb-1 block text-sm font-medium text-slate-700">Anything we should know?</label>
            <input id="reg-note" value={form.note} onChange={(e) => set("note")(e.target.value)} maxLength={1000} className={input} />
          </div>
          <button type="submit" disabled={isSending} className="rounded-xl bg-blue-700 px-7 py-4 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
            {isSending ? "Sending..." : "Submit Registration"}
          </button>
        </section>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </form>
    </main>
  );
}
