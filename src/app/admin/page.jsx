"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  GraduationCap,
  ClipboardCheck,
  Wallet,
  BrainCircuit,
  ShieldCheck,
  Building2,
  TrendingUp,
  ArrowRight,
  Sparkles,
  RefreshCw
} from "lucide-react";
import { overviewService } from "@/lib/erpServices";

export default function AdminDashboardPage() {
  const [kpiData, setKpiData] = useState({
    totalStudents: 3842,
    totalTeachers: 186,
    totalRevenue: 24800000,
    attendanceAverage: 94.6,
    currency: "BDT",
    systemName: "NextGen Institutional ERP"
  });
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  const fetchKPIs = async () => {
    try {
      setLoading(true);
      const data = await overviewService.getKPIs();
      setKpiData(data);
      setConnected(true);
    } catch (err) {
      console.warn("Using fallback KPI data:", err.message);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKPIs();
  }, []);

  const kpiCards = [
    { title: "Total Students", value: kpiData.totalStudents.toLocaleString(), change: "+12.4%", icon: Users, color: "text-blue-600 bg-blue-50" },
    { title: "Active Teachers", value: kpiData.totalTeachers.toLocaleString(), change: "+4.1%", icon: GraduationCap, color: "text-purple-600 bg-purple-50" },
    { title: "Fee Collection", value: `${kpiData.currency === "BDT" ? "৳" : "$"} ${(kpiData.totalRevenue / 1000000).toFixed(1)}M`, change: "+18.2%", icon: Wallet, color: "text-emerald-600 bg-emerald-50" },
    { title: "Attendance Today", value: `${kpiData.attendanceAverage}%`, change: "+1.8%", icon: ClipboardCheck, color: "text-amber-600 bg-amber-50" },
  ];

  const quickNav = [
    { title: "Student Directory", href: "/admin/student/information", icon: Users, desc: "Manage student profiles and enrollment" },
    { title: "Fee Structures", href: "/admin/finance/fee-structure", icon: Wallet, desc: "Tuition heads, invoices and billing" },
    { title: "Examinations", href: "/admin/examination/exam-schedule", icon: ClipboardCheck, desc: "Exam schedules and mark sheets" },
    { title: "AI Analytics", href: "/admin/ai-analytics/predictions", icon: BrainCircuit, desc: "Dropout risks and performance AI" },
    { title: "System Settings", href: "/admin/settings/general", icon: ShieldCheck, desc: "Institution profile and gateway setup" },
    { title: "Classrooms", href: "/admin/classroom/schedules", icon: Building2, desc: "Timetables and room allocations" },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 p-6 lg:p-8 text-white shadow-lg">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5" /> Next-Gen Enterprise ERP
            </div>
            <h1 className="mt-3 text-2xl lg:text-3xl font-extrabold tracking-tight">
              {kpiData.systemName}
            </h1>
            <p className="mt-1 text-blue-100 text-sm max-w-2xl">
              Centralized institutional dashboard connected to Core ERP Backend (Port 4000) managing 32 modular microservices.
            </p>
            <div className="mt-3 flex items-center gap-3 text-xs">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold ${
                connected ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40" : "bg-amber-500/20 text-amber-200 border border-amber-400/40"
              }`}>
                <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`}></span>
                {connected ? "Core ERP Backend Live (Port 4000)" : "Core ERP Backend Ready"}
              </span>
              <button
                onClick={fetchKPIs}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Sync
              </button>
            </div>
          </div>
          <Link
            href="/admin/settings/general"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-blue-800 shadow transition-all hover:bg-blue-50"
          >
            System Settings <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {kpi.title}
                </span>
                <div className={`rounded-lg p-2 ${kpi.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-2xl font-bold text-slate-800">{kpi.value}</span>
                <span className="inline-flex items-center text-xs font-medium text-emerald-600">
                  <TrendingUp className="mr-1 h-3 w-3" /> {kpi.change}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Navigation Grid */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-3">Quick Navigation Modules</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.title}
                href={item.href}
                className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-blue-400 hover:shadow-md"
              >
                <div className="rounded-lg bg-blue-50 p-3 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">{item.desc}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
