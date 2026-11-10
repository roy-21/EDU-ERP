"use client";

import { useState } from "react";
import { hostelService } from "@/lib/erpServices";
import { downloadCsv } from "./hostelExport";
import {
  DataTable,
  PageShell,
  Pager,
  filterClass,
  formatDateTime,
  secondaryButton,
  useHostelData,
  usePagination,
} from "./hostelUi";

const AUDIT_ROWS = 1000;
const ENTITY_TYPES = ["Room", "Seat", "Allocation", "Ticket"];

const CSV_COLUMNS = [
  { label: "When", value: (row) => formatDateTime(row.createdAt) },
  { label: "Who", value: (row) => row.actorEmail },
  { label: "Action", value: (row) => row.action },
  { label: "Type", value: (row) => row.entityType },
  { label: "Details", value: (row) => row.summary },
];

const loadAudit = () => hostelService.getAudit(AUDIT_ROWS);

export default function HostelAuditLog() {
  const { data, error: loadError, isLoading, reload } = useHostelData(loadAudit);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");

  const rows = data || [];
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      [row.summary, row.actorEmail, row.action].join(" ").toLowerCase().includes(query) &&
      (typeFilter === "All" || row.entityType === typeFilter)
  );
  const { pageItems, pagerProps } = usePagination(filtered, 15);

  return (
    <PageShell
      title="Audit Log"
      subtitle={`Who changed what in the hostel module. Shows the latest ${AUDIT_ROWS} changes.`}
      actions={
        <button
          onClick={() => downloadCsv("hostel-audit-log.csv", CSV_COLUMNS, filtered)}
          disabled={filtered.length === 0}
          className={`${secondaryButton} disabled:opacity-50`}
        >
          Export CSV
        </button>
      }
    >
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row">
          <input
            type="text"
            aria-label="Search audit log"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by person, action, details..."
            className={`w-full md:max-w-md ${filterClass}`}
          />
          <select
            aria-label="Filter by type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className={filterClass}
          >
            <option value="All">All Types</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <DataTable
          columns={["When", "Who", "Action", "Type", "Details"]}
          isLoading={isLoading}
          loadError={loadError}
          onRetry={reload}
          hasRows={pageItems.length > 0}
          emptyMessage={rows.length === 0 ? "No changes recorded yet." : "No entries match your search."}
        >
          {pageItems.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
              <td className="px-4 py-3 text-slate-600">{row.actorEmail || "—"}</td>
              <td className="px-4 py-3 font-medium text-slate-800">{row.action}</td>
              <td className="px-4 py-3 text-slate-600">{row.entityType}</td>
              <td className="px-4 py-3 text-slate-600">{row.summary}</td>
            </tr>
          ))}
        </DataTable>
        <Pager {...pagerProps} />
      </div>
    </PageShell>
  );
}
