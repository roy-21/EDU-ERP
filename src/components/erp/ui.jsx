"use client";

import Link from "next/link";

export {
  DataTable,
  ErrorBanner,
  Field,
  FormModal,
  SelectField,
  StatGrid,
  StatusBadge,
  TextField,
  dangerButton,
  filterClass,
  formatDateTime,
  friendlyError,
  inputClass,
  linkButton,
  money,
  primaryButton,
  secondaryButton,
  useHostelAction as useAction,
  useHostelData as useData,
} from "@/app/admin/hostel/_components/hostelUi";
export { ViewModal, Detail } from "@/app/admin/hostel/_components/hostelViews";

// A page frame for the system and platform screens.
export function SystemShell({ title, subtitle, crumbs = [], actions, children }) {
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Link href="/admin" className="hover:text-blue-600">Admin</Link>
            {crumbs.map((crumb) => (
              <span key={crumb.href} className="flex items-center gap-2">
                <span>/</span>
                <Link href={crumb.href} className="hover:text-blue-600">{crumb.label}</Link>
              </span>
            ))}
            <span>/</span>
            <span className="font-medium text-slate-700">{title}</span>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

// Shown instead of a page when the signed-in user lacks the permission.
export function NoAccess({ message = "You do not have permission to open this page." }) {
  return (
    <div className="m-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800" role="alert">
      {message}
    </div>
  );
}
