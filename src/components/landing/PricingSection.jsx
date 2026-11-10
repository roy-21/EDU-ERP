"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { tenancyApi } from "@/lib/identityServices";

const taka = (value) => `৳${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Prices come from the server, so the page always shows what sign-up will charge.
export default function PricingSection() {
  const [plans, setPlans] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    tenancyApi.plans().then(setPlans).catch(() => setFailed(true));
  }, []);

  const core = (plans || []).filter((item) => item.isCore);
  const optional = (plans || []).filter((item) => !item.isCore);
  const categories = [...new Set(optional.map((item) => item.category))];

  return (
    <section id="pricing" className="bg-white py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-blue-700">Pricing</p>
          <h2 className="mt-3 text-3xl font-extrabold text-slate-900 md:text-4xl">Pay only for the modules you use</h2>
          <p className="mt-4 leading-7 text-slate-600">
            Every institution gets {core.length ? core.map((item) => item.name).join(", ") : "the core modules"} free.
            Add any module per month; a yearly plan is charged for ten months.
          </p>
        </div>

        {failed && <p className="mt-10 text-center text-sm text-slate-500">Prices could not be loaded right now. Please try again later.</p>}
        {!plans && !failed && <p className="mt-10 text-center text-sm text-slate-500">Loading prices...</p>}

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <div key={category} className="rounded-2xl border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900">{category}</h3>
              <ul className="mt-4 space-y-3">
                {optional.filter((item) => item.category === category).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-700">{item.icon} {item.name}</span>
                    <span className="whitespace-nowrap font-semibold text-slate-900">{taka(item.monthlyPrice)}<span className="text-xs font-normal text-slate-500">/mo</span></span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {plans && (
          <div className="mt-12 text-center">
            <Link href="/register" className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-7 py-4 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-800">
              Register Your Institution
            </Link>
            <p className="mt-3 text-xs text-slate-500">Each registration is reviewed before the account opens.</p>
          </div>
        )}
      </div>
    </section>
  );
}
