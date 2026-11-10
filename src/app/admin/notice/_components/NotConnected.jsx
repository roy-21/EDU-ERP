import Link from "next/link";
import { SystemShell } from "@/components/erp/ui";

// For channels that need a provider account the server does not have yet.
export default function NotConnected({ title, channel, needs }) {
  return (
    <SystemShell title={title} crumbs={[{ href: "/admin/notice", label: "Notice Board" }]}>
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">{channel} is not connected.</p>
        <p>Sending {channel.toLowerCase()} needs {needs}. Nothing is sent from this page until a provider is set up and tested, so no message here is shown as delivered.</p>
        <p>Until then, publish a notice on the <Link href="/admin/notice/notices" className="font-medium underline">notice board</Link> or send it by <Link href="/admin/notice/email" className="font-medium underline">email</Link>.</p>
      </div>
    </SystemShell>
  );
}
