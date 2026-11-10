"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100";

export const filterClass =
  "rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500";

export const primaryButton =
  "w-fit rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700";

export const secondaryButton =
  "w-fit rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50";

export const linkButton = "font-medium text-blue-600 hover:text-blue-800";
export const dangerButton = "font-medium text-red-600 hover:text-red-800";

const STATUS_STYLES = {
  Available: "bg-green-100 text-green-700",
  Occupied: "bg-blue-100 text-blue-700",
  Reserved: "bg-purple-100 text-purple-700",
  Maintenance: "bg-orange-100 text-orange-700",
  Closed: "bg-slate-700 text-white",
  Pending: "bg-yellow-100 text-yellow-700",
  Allocated: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700",
  Vacated: "bg-slate-100 text-slate-700",
  Open: "bg-red-100 text-red-700",
  "In Progress": "bg-blue-100 text-blue-700",
  Resolved: "bg-green-100 text-green-700",
  High: "bg-red-100 text-red-700",
  Medium: "bg-yellow-100 text-yellow-700",
  Low: "bg-slate-100 text-slate-700",
  Unpaid: "bg-yellow-100 text-yellow-700",
  "Partially Paid": "bg-blue-100 text-blue-700",
  Paid: "bg-green-100 text-green-700",
  Overdue: "bg-red-100 text-red-700",
  Waived: "bg-slate-100 text-slate-700",
  Confirmed: "bg-green-100 text-green-700",
  Completed: "bg-green-100 text-green-700",
  Connected: "bg-green-100 text-green-700",
  Initiated: "bg-blue-100 text-blue-700",
  Created: "bg-blue-100 text-blue-700",
  Failed: "bg-red-100 text-red-700",
  Error: "bg-red-100 text-red-700",
  Review: "bg-amber-100 text-amber-800",
  Cancelled: "bg-slate-100 text-slate-700",
  Expired: "bg-slate-100 text-slate-700",
  Disabled: "bg-slate-100 text-slate-700",
  "Not Tested": "bg-yellow-100 text-yellow-700",
  Reversed: "bg-slate-200 text-slate-700",
  Sent: "bg-green-100 text-green-700",
  Delivered: "bg-green-100 text-green-700",
  Failed: "bg-red-100 text-red-700",
  Skipped: "bg-slate-100 text-slate-700",
  Active: "bg-green-100 text-green-700",
  Inactive: "bg-slate-200 text-slate-700",
  Success: "bg-green-100 text-green-700",
  "Not Configured": "bg-slate-100 text-slate-700",
};

export const friendlyError = (err) => {
  const message = err?.message || "Something went wrong. Please try again.";
  if (message === "Failed to fetch") {
    return "Could not reach the server. Check that the backend is running.";
  }
  if (message.startsWith("Forbidden")) {
    return "You do not have permission to do this.";
  }
  if (/expired|untrusted|Missing or malformed/.test(message)) {
    return "Your session has expired. Please log in again.";
  }
  return message;
};

export const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export const money = (value) =>
  `৳${Number(value || 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

export const formatMonth = (value) =>
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// `load` must be stable: defined at module level or wrapped in useCallback.
export function useHostelData(load) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    load()
      .then((result) => {
        if (!isCurrent) return;
        setData(result);
        setError("");
      })
      .catch((err) => {
        if (isCurrent) setError(friendlyError(err));
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [load, reloadCount]);

  return {
    data,
    error,
    isLoading,
    reload: () => setReloadCount((count) => count + 1),
  };
}

export function useHostelAction(onDone) {
  const [error, setError] = useState("");

  const run = async (action) => {
    setError("");
    try {
      const result = await action();
      // An action that leaves the page returns false to skip the reload.
      if (result !== false) onDone?.();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  return { error, clearError: () => setError(""), run };
}

export function usePagination(items, pageSize = 10) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;

  return {
    pageItems: items.slice(start, start + pageSize),
    pagerProps: {
      page: currentPage,
      pageCount,
      total: items.length,
      from: items.length === 0 ? 0 : start + 1,
      to: Math.min(start + pageSize, items.length),
      onChange: setPage,
    },
  };
}

export function Pager({ page, pageCount, total, from, to, onChange }) {
  if (total === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <span>
        Showing {from}–{to} of {total}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChange(page - 1)}
            disabled={page === 1}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="tabular-nums">
            Page {page} of {pageCount}
          </span>
          <button
            onClick={() => onChange(page + 1)}
            disabled={page === pageCount}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// Access is decided by the server from roles, permissions and the subscription.
export function HostelFeatureGate({ children }) {
  return children;
}

export function PageShell({ title, subtitle, crumbs = [], actions, children }) {
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Link href="/admin" className="hover:text-blue-600">
              Admin
            </Link>
            <span>/</span>
            <Link href="/admin/hostel" className="hover:text-blue-600">
              Hostel Management
            </Link>
            {crumbs.map((crumb) => (
              <span key={crumb.href} className="flex items-center gap-2">
                <span>/</span>
                <Link href={crumb.href} className="hover:text-blue-600">
                  {crumb.label}
                </Link>
              </span>
            ))}
            <span>/</span>
            <span className="text-slate-700">{title}</span>
          </div>

          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
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

export function StatGrid({ stats, isLoading }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{stat.label}</p>
          <p className={`mt-2 text-2xl font-bold ${stat.color || "text-slate-800"}`}>
            {isLoading ? "—" : stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function StatusBadge({ status }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
        STATUS_STYLES[status] || "bg-slate-100 text-slate-700"
      }`}
    >
      {status}
    </span>
  );
}

export function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
    >
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="font-medium">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function DataTable({ columns, isLoading, loadError, onRetry, emptyMessage, children, hasRows, minWidth = "min-w-[800px]" }) {
  const message = isLoading ? "Loading..." : !loadError && !hasRows ? emptyMessage : "";

  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${minWidth} text-left text-sm`}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            {columns.map((column) => (
              <th key={column} className="px-4 py-3">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!isLoading && !loadError && children}
          {(message || (!isLoading && loadError)) && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">
                {message}
                {!isLoading && loadError && (
                  <span role="alert">
                    <span className="block text-red-600">{loadError}</span>
                    <button onClick={onRetry} className={`mt-2 ${linkButton}`}>
                      Try again
                    </button>
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Field({ id, label, children, wide }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

export function TextField({ id, label, value, onChange, wide, ...props }) {
  return (
    <Field id={id} label={label} wide={wide}>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        {...props}
      />
    </Field>
  );
}

export function SelectField({ id, label, value, onChange, options, wide }) {
  return (
    <Field id={id} label={label} wide={wide}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        {options.map((option) => {
          const { value: optionValue, label: optionLabel } =
            typeof option === "string" ? { value: option, label: option } : option;
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

export function FormModal({ title, submitLabel = "Save", onSubmit, onClose, children, submitDisabled = false }) {
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // A successful onSubmit closes this modal, so saving only resets on failure.
  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError("");

    try {
      await onSubmit();
    } catch (err) {
      setError(friendlyError(err));
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={handleSubmit}
        noValidate
        className="my-4 w-full max-w-2xl rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          {children}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || submitDisabled}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
