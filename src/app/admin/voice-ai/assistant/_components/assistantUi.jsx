"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const CRUMBS = [{ href: "/admin/voice-ai", label: "AI Voice & Message Assistant" }];

// Every section of the assistant, with the permission that opens it (null = anyone).
export const SECTIONS = [
  { href: "/admin/voice-ai", label: "Home", permission: null },
  { href: "/admin/voice-ai/assistant", label: "Analytics", permission: "voice-ai.view_analytics" },
  { href: "/admin/voice-ai/assistant/ask", label: "Ask", permission: null },
  { href: "/admin/voice-ai/assistant/knowledge", label: "Knowledge Base", permission: ["voice-ai.manage_knowledge", "voice-ai.review_knowledge"] },
  { href: "/admin/voice-ai/assistant/review", label: "Review", permission: "voice-ai.review_knowledge" },
  { href: "/admin/voice-ai/assistant/escalations", label: "Forwarded Questions", permission: "voice-ai.manage_escalations" },
  { href: "/admin/voice-ai/assistant/setup", label: "Responsible Persons", permission: "voice-ai.manage_escalations" },
  { href: "/admin/voice-ai/assistant/calls", label: "Voice Calls", permission: "voice-ai.view_analytics" },
];

export function SectionTabs({ can }) {
  const pathname = usePathname();
  const allowed = SECTIONS.filter((section) => !section.permission || can(...[].concat(section.permission)));
  return (
    <nav aria-label="Assistant sections" className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {allowed.map((section) => {
        const active = pathname === section.href;
        return (
          <Link key={section.href} href={section.href} aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

const TONES = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
  slate: "bg-slate-100 text-slate-700",
};

export const Pill = ({ tone = "slate", children, title }) => (
  <span title={title} className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>
);

export const DOC_STATUS = { QUEUED: ["Waiting", "amber"], PROCESSING: ["Reading", "blue"], READY: ["Ready", "green"], FAILED: ["Failed", "red"] };
export const ESC_STATUS = {
  SENDING: ["Sending", "blue"],
  SENT: ["Waiting for answer", "amber"],
  FAILED: ["Delivery failed", "red"],
  WAITING_ADMIN: ["Needs admin", "red"],
  ANSWERED: ["Answered", "green"],
  CLOSED: ["Closed", "slate"],
};
export const CHANNEL_STATUS = {
  SENT: ["Sent", "green"],
  FAILED: ["Failed", "red"],
  NOT_CONFIGURED: ["Not set up", "amber"],
  NO_ADDRESS: ["No address", "amber"],
  NOT_USED: ["—", "slate"],
};

export const StatusPill = ({ map, value }) => {
  const [label, tone] = map[value] || [value, "slate"];
  return <Pill tone={tone}>{label}</Pill>;
};

export function Notice({ text }) {
  if (!text) return null;
  return <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{text}</p>;
}

export const textareaClass = "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500";
