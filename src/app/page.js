
import Link from "next/link";
import PricingSection from "@/components/landing/PricingSection";
import {
  ArrowRight,
  ArrowUpRight,
  GraduationCap,
  Users,
  BookOpen,
  Wallet,
  BrainCircuit,
  PhoneCall,
  ShieldCheck,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  Building2,
  Globe,
  Menu,
  CheckCircle2,
  Sparkles,
  Layers3,
  Database,
  MessageSquare,
  Clock3,
  ChevronRight,
} from "lucide-react";

const modules = [
  { number: "01", title: "Student Management", description: "Student profiles, enrollment, academic records and lifecycle management.", icon: Users, color: "bg-blue-50 text-blue-600" },
  { number: "02", title: "Academic Management", description: "Departments, courses, classes, semesters and academic operations.", icon: GraduationCap, color: "bg-violet-50 text-violet-600" },
  { number: "03", title: "Examination Management", description: "Exam scheduling, results, grading and performance tracking.", icon: ClipboardCheck, color: "bg-emerald-50 text-emerald-600" },
  { number: "04", title: "Finance Management", description: "Fees, payments, invoices, payroll and financial reporting.", icon: Wallet, color: "bg-amber-50 text-amber-600" },
  { number: "05", title: "Teacher Management", description: "Teacher profiles, attendance, schedules and performance.", icon: BookOpen, color: "bg-pink-50 text-pink-600" },
  { number: "06", title: "AI Analytics Engine", description: "Academic predictions, learning insights and intelligent alerts.", icon: BrainCircuit, color: "bg-indigo-50 text-indigo-600" },
  { number: "07", title: "Communication Center", description: "Institution-wide messaging, SMS, email and notifications.", icon: MessageSquare, color: "bg-cyan-50 text-cyan-600" },
  { number: "08", title: "Security & Monitoring", description: "Access control, audit trails, system health and monitoring.", icon: ShieldCheck, color: "bg-rose-50 text-rose-600" },
];

const capabilities = [
  { icon: Database, title: "Centralized Data", text: "Keep institutional information organized in one secure platform." },
  { icon: BrainCircuit, title: "AI-Powered Intelligence", text: "Turn academic and operational data into actionable insights." },
  { icon: BarChart3, title: "Advanced Analytics", text: "Understand institutional performance through detailed reports." },
  { icon: ShieldCheck, title: "Enterprise Security", text: "Manage permissions, activity records and data protection." },
];

const workflow = [
  { number: "01", title: "Connect", text: "Bring students, teachers, departments and administrators together." },
  { number: "02", title: "Manage", text: "Control academic, financial and administrative operations." },
  { number: "03", title: "Analyze", text: "Use real-time insights to understand institutional performance." },
  { number: "04", title: "Improve", text: "Make better decisions with automation and AI assistance." },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-white font-sans text-slate-900">

      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-700 text-white shadow-lg shadow-blue-200">
              <GraduationCap size={25} />
            </div>
            <div>
              <p className="text-lg font-extrabold tracking-tight text-slate-900">EduNexus</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Intelligent Education</p>
            </div>
          </Link>

          <div className="hidden items-center gap-8 lg:flex">
            <Link href="#platform" className="text-sm font-medium text-slate-600 hover:text-blue-700">Platform</Link>
            <Link href="#modules" className="text-sm font-medium text-slate-600 hover:text-blue-700">Modules</Link>
            <Link href="#intelligence" className="text-sm font-medium text-slate-600 hover:text-blue-700">AI Intelligence</Link>
            <Link href="#pricing" className="text-sm font-medium text-slate-600 hover:text-blue-700">Pricing</Link>
            <Link href="#about" className="text-sm font-medium text-slate-600 hover:text-blue-700">About</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-semibold text-slate-700 hover:text-blue-700 sm:block">
              Sign In
            </Link>
            <Link href="/register" className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-200 transition hover:bg-blue-800">
              Get Started <ArrowUpRight size={16} />
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-[#07152e]">
        <div className="absolute -right-40 -top-40 h-[550px] w-[550px] rounded-full bg-blue-500/20 blur-[110px]" />
        <div className="absolute -bottom-40 left-1/3 h-[400px] w-[400px] rounded-full bg-indigo-500/20 blur-[100px]" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 md:py-28 lg:grid-cols-2 lg:px-8">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-4 py-2 text-xs font-semibold text-blue-200">
              <Sparkles size={14} />
              THE NEXT GENERATION OF EDUCATION
            </div>

            <h1 className="max-w-2xl text-4xl font-extrabold leading-[1.15] tracking-tight text-white sm:text-5xl lg:text-6xl">
              One Platform.
              <span className="block bg-gradient-to-r from-blue-300 via-cyan-300 to-indigo-300 bg-clip-text text-transparent">
                Every Possibility.
              </span>
              Smarter Education.
            </h1>

            <p className="mt-7 max-w-xl text-base leading-8 text-slate-300 md:text-lg">
              A unified, AI-powered Education Management System designed to
              simplify institutional operations, empower educators and create
              better academic experiences.
            </p>

            <div className="mt-9 flex flex-wrap gap-4">
              <Link href="/admin" className="inline-flex items-center gap-3 rounded-xl bg-blue-600 px-6 py-4 text-sm font-bold text-white shadow-xl shadow-blue-950/40 transition hover:-translate-y-1 hover:bg-blue-500">
                Explore Admin Dashboard <ArrowRight size={18} />
              </Link>
              <Link href="#modules" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-4 text-sm font-semibold text-white transition hover:bg-white/10">
                Explore Platform
              </Link>
            </div>

            <div className="mt-12 flex flex-wrap gap-x-8 gap-y-4 border-t border-white/10 pt-7">
              {["Unified Management", "AI Integration", "Secure Architecture"].map(item => (
                <div key={item} className="flex items-center gap-2 text-xs font-medium text-slate-300">
                  <CheckCircle2 size={15} className="text-emerald-400" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Dashboard Preview */}
          <div className="relative">
            <div className="absolute -inset-5 rounded-[2rem] bg-blue-500/10 blur-2xl" />
            <div className="relative rounded-2xl border border-white/15 bg-white p-4 shadow-2xl shadow-black/40 sm:p-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <p className="text-sm font-bold text-slate-900">Institution Overview</p>
                  <p className="mt-1 text-xs text-slate-400">Dashboard preview · Sample data</p>
                </div>
                <span className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Overview
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  { label: "Total Students", value: "12,480", icon: Users, color: "text-blue-600 bg-blue-50" },
                  { label: "Teachers", value: "845", icon: BookOpen, color: "text-violet-600 bg-violet-50" },
                  { label: "Departments", value: "32", icon: Building2, color: "text-emerald-600 bg-emerald-50" },
                  { label: "Attendance", value: "94.8%", icon: CalendarDays, color: "text-amber-600 bg-amber-50" },
                ].map(item => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="rounded-xl border border-slate-100 p-4">
                      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${item.color}`}>
                        <Icon size={18} />
                      </div>
                      <p className="text-xs text-slate-500">{item.label}</p>
                      <p className="mt-1 text-2xl font-extrabold text-slate-900">{item.value}</p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 rounded-xl border border-slate-100 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-800">Academic Performance</p>
                  <span className="text-xs text-blue-600">Sample trend</span>
                </div>
                <div className="mt-5 flex h-32 items-end gap-3">
                  {[48, 67, 55, 78, 63, 88, 72, 96, 80, 100, 87, 92].map((height, index) => (
                    <div key={index} className="flex flex-1 flex-col items-center justify-end gap-2">
                      <div className="w-full rounded-t-md bg-gradient-to-t from-blue-700 to-cyan-400" style={{ height: `${height}%` }} />
                      <span className="text-[9px] text-slate-400">{index + 1}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3 rounded-xl bg-blue-50 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-700 text-white">
                  <BrainCircuit size={21} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-slate-900">AI Academic Insights</p>
                  <p className="mt-1 text-[11px] text-slate-500">Intelligent insights and decision support</p>
                </div>
                <ArrowUpRight size={18} className="text-blue-700" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="relative z-10 mx-auto -mt-1 max-w-7xl px-5 lg:px-8">
        <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl shadow-slate-200/50 md:grid-cols-4">
          {[
            ["32+", "Management Modules"],
            ["AI", "Intelligent Automation"],
            ["360°", "Institution Overview"],
            ["24/7", "Digital Accessibility"],
          ].map(([value, label], index) => (
            <div key={label} className={`p-6 text-center ${index ? "border-l border-slate-100" : ""}`}>
              <p className="text-3xl font-extrabold tracking-tight text-blue-700">{value}</p>
              <p className="mt-2 text-xs font-medium text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Platform intro */}
      <section id="platform" className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">A Complete Ecosystem</span>
            <h2 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 md:text-4xl">
              Everything your institution needs, connected in one place.
            </h2>
            <p className="mt-6 leading-8 text-slate-500">
              From student enrollment to graduation, from daily attendance
              to institutional analytics, manage the complete education
              lifecycle through one connected digital ecosystem.
            </p>
            <Link href="/admin" className="mt-8 inline-flex items-center gap-2 font-bold text-blue-700 hover:gap-3">
              Explore Management System <ArrowRight size={18} />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: Users, title: "Student Lifecycle", text: "From admission to graduation", color: "bg-blue-50 text-blue-700" },
              { icon: Wallet, title: "Financial Control", text: "Fees and institutional finance", color: "bg-amber-50 text-amber-700" },
              { icon: BookOpen, title: "Academic Operations", text: "Classes, exams and results", color: "bg-violet-50 text-violet-700" },
              { icon: BarChart3, title: "Business Intelligence", text: "Reports and decision support", color: "bg-emerald-50 text-emerald-700" },
            ].map(({ icon: Icon, title, text, color }) => (
              <div key={title} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl ${color}`}>
                  <Icon size={23} />
                </div>
                <h3 className="font-bold text-slate-900">{title}</h3>
                <p className="mt-2 text-xs leading-6 text-slate-500">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">Powerful Management Modules</span>
            <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
              One Platform. 32 Connected Modules.
            </h2>
            <p className="mt-5 leading-7 text-slate-500">
              A comprehensive collection of tools designed to manage
              every essential area of an educational institution.
            </p>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map(({ number, title, description, icon: Icon, color }) => (
              <div key={number} className="group rounded-2xl border border-slate-200 bg-white p-6 transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-100/50">
                <div className="flex items-center justify-between">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${color}`}>
                    <Icon size={24} />
                  </div>
                  <span className="text-xs font-bold text-slate-300">{number}</span>
                </div>
                <h3 className="mt-6 font-bold text-slate-900">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
                <div className="mt-5 flex items-center gap-2 text-xs font-bold text-blue-700 opacity-0 transition group-hover:opacity-100">
                  Explore <ArrowRight size={14} />
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-xs text-slate-400">
            Showing selected modules. Additional modules are available in the administration platform.
          </p>
        </div>
      </section>

      {/* AI Voice Assistant */}
      <section id="intelligence" className="relative overflow-hidden bg-[#08172f] py-24">
        <div className="absolute -right-40 top-0 h-96 w-96 rounded-full bg-blue-500/20 blur-[100px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:px-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs font-semibold text-cyan-200">
              <Sparkles size={15} /> NEXT-GENERATION AI
            </div>
            <h2 className="mt-6 text-3xl font-extrabold leading-tight text-white md:text-5xl">
              Meet Your
              <span className="block text-cyan-300">AI Voice Assistant.</span>
            </h2>
            <p className="mt-6 max-w-xl leading-8 text-slate-300">
              An intelligent communication assistant designed to answer
              institutional inquiries, understand callers, detect complaints
              and connect people with the right department.
            </p>

            <div className="mt-8 space-y-4">
              {[
                "Natural voice conversations in supported languages",
                "Automatic complaint and objection detection",
                "Intelligent staff routing and callback scheduling",
                "Call transcription, history and analytics",
              ].map(item => (
                <div key={item} className="flex items-start gap-3 text-sm text-slate-200">
                  <CheckCircle2 className="mt-0.5 shrink-0 text-cyan-400" size={18} />
                  {item}
                </div>
              ))}
            </div>

            <Link href="/admin/voice-ai" className="mt-10 inline-flex items-center gap-3 rounded-xl bg-cyan-400 px-6 py-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-300">
              Explore AI Voice Center <ArrowRight size={18} />
            </Link>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-6 backdrop-blur-xl md:p-8">
            <div className="flex items-center justify-between border-b border-white/10 pb-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400 text-slate-950">
                  <PhoneCall size={23} />
                </div>
                <div>
                  <p className="font-bold text-white">Institution AI Assistant</p>
                  <p className="mt-1 text-xs text-slate-400">Voice interaction preview</p>
                </div>
              </div>
              <span className="rounded-full bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200">Preview</span>
            </div>

            <div className="my-8 space-y-5">
              <div className="mr-10 rounded-2xl rounded-tl-sm bg-white/10 p-4">
                <p className="text-xs font-semibold text-cyan-300">CALLER</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  I want to know about the admission process for the new semester.
                </p>
              </div>
              <div className="ml-10 rounded-2xl rounded-tr-sm bg-blue-600/30 p-4">
                <p className="text-xs font-semibold text-blue-200">AI ASSISTANT</p>
                <p className="mt-2 text-sm leading-6 text-white">
                  I can help you with admission information. Would you like
                  to know about eligibility, required documents or application dates?
                </p>
              </div>
            </div>

            <div className="flex items-center justify-center gap-1.5 py-5">
              {[18, 32, 46, 26, 55, 34, 20, 42, 58, 30, 18, 44, 25, 52, 33, 19].map((height, index) => (
                <div key={index} className="w-1.5 rounded-full bg-cyan-300" style={{ height: `${height}px` }} />
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-white/10 pt-5 text-xs text-slate-400">
              <span className="flex items-center gap-2"><Clock3 size={14} /> Conversation example</span>
              <span>AI interaction preview</span>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <div className="text-center">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">Built for Modern Institutions</span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">
            Technology That Works Together
          </h2>
        </div>
        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map(({ icon: Icon, title, text }) => (
            <div key={title} className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                <Icon size={29} />
              </div>
              <h3 className="mt-5 font-bold text-slate-900">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-500">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <PricingSection />

      {/* Workflow */}
      <section id="about" className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">Simple. Connected. Intelligent.</span>
              <h2 className="mt-4 text-3xl font-extrabold leading-tight text-slate-900 md:text-4xl">
                A smarter way to manage your institution.
              </h2>
              <p className="mt-5 leading-8 text-slate-500">
                Bring institutional workflows together, reduce manual
                operations and create a connected environment for
                administrators, teachers, students and guardians.
              </p>
              <Link href="/admin" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800">
                Open Admin Panel <ArrowRight size={17} />
              </Link>
            </div>
            <div className="space-y-4">
              {workflow.map(item => (
                <div key={item.number} className="flex gap-5 rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-extrabold text-blue-700">
                    {item.number}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 py-20 lg:px-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl bg-gradient-to-r from-blue-800 via-blue-700 to-indigo-800 px-7 py-14 text-center md:px-16">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white">
            <Layers3 size={29} />
          </div>
          <h2 className="mx-auto mt-6 max-w-3xl text-3xl font-extrabold leading-tight text-white md:text-4xl">
            Transform the Way Your Institution Works.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl leading-7 text-blue-100">
            Explore a connected education management platform built around
            academic excellence, operational clarity and intelligent technology.
          </p>
          <Link href="/admin" className="mt-8 inline-flex items-center gap-3 rounded-xl bg-white px-7 py-4 text-sm font-bold text-blue-800 transition hover:-translate-y-1 hover:bg-blue-50">
            Enter Administration <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#07152e] text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <div className="lg:col-span-2">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600">
                <GraduationCap size={25} />
              </div>
              <div>
                <p className="text-lg font-extrabold">EduNexus</p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Intelligent Education</p>
              </div>
            </Link>
            <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
              A unified digital ecosystem for modern education management,
              institutional intelligence and connected academic operations.
            </p>
          </div>

          <div>
            <h3 className="font-bold">Platform</h3>
            <div className="mt-5 space-y-3 text-sm text-slate-400">
              <Link className="block hover:text-white" href="#modules">Management Modules</Link>
              <Link className="block hover:text-white" href="#intelligence">AI Intelligence</Link>
              <Link className="block hover:text-white" href="/admin">Administration</Link>
            </div>
          </div>

          <div>
            <h3 className="font-bold">Quick Access</h3>
            <div className="mt-5 space-y-3 text-sm text-slate-400">
              <Link className="block hover:text-white" href="/admin">Admin Dashboard</Link>
              <Link className="block hover:text-white" href="/admin/voice-ai">AI Voice Assistant</Link>
              <Link className="block hover:text-white" href="#about">About Platform</Link>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 px-5 py-6 text-xs text-slate-500 sm:flex-row lg:px-8">
            <p>© {new Date().getFullYear()} EduNexus. All rights reserved.</p>
            <p>Powered by Intelligent Education Technology</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
