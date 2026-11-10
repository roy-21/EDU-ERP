"use client";

import { hostelService } from "@/lib/erpServices";
import { useHostelPermissions } from "@/lib/hostelPermissions";
import { ALLOCATION_CSV_COLUMNS } from "./AllocationManagement";
import { downloadCsv, printTable } from "./hostelExport";
import { TICKET_CSV_COLUMNS } from "./MaintenanceManagement";
import {
  DataTable,
  ErrorBanner,
  PageShell,
  StatGrid,
  secondaryButton,
  useHostelAction,
  useHostelData,
} from "./hostelUi";

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const OCCUPANCY_COLUMNS = [
  { label: "Hostel", value: (row) => row.hostelName },
  { label: "Rooms", value: (row) => row.rooms },
  { label: "Seats", value: (row) => row.seats },
  { label: "Occupied", value: (row) => row.occupied },
  { label: "Reserved", value: (row) => row.reserved },
  { label: "Free", value: (row) => row.seats - row.occupied - row.reserved },
  { label: "Occupancy", value: (row) => `${percent(row.occupied, row.seats)}%` },
  { label: "Rooms in Maintenance", value: (row) => row.maintenanceRooms },
  { label: "Closed Rooms", value: (row) => row.closedRooms },
];

const stamp = () => new Date().toISOString().slice(0, 10);

export default function HostelReports() {
  const { has } = useHostelPermissions();
  const { data: summary, error: loadError, isLoading, reload } = useHostelData(hostelService.getSummary);
  const { error: actionError, clearError, run } = useHostelAction();

  const byHostel = summary?.byHostel || [];
  const seats = summary?.seats || 0;
  const occupied = summary?.occupied || 0;

  const stats = [
    { label: "Occupancy", value: `${percent(occupied, seats)}%`, color: "text-blue-600" },
    { label: "Occupied / Total Seats", value: `${occupied} / ${seats}` },
    { label: "Pending Applications", value: summary?.pendingApplications, color: "text-yellow-600" },
    {
      label: "Maintenance / Closed Rooms",
      value: `${summary?.maintenanceRooms} / ${summary?.closedRooms}`,
      color: "text-orange-600",
    },
    { label: "Open Tickets", value: summary?.openTickets, color: "text-red-600" },
  ];

  const exportAllocations = () =>
    run(async () => {
      const rows = await hostelService.getAllocations();
      downloadCsv(`hostel-allocations-${stamp()}.csv`, ALLOCATION_CSV_COLUMNS, rows);
    });

  const exportTickets = () =>
    run(async () => {
      const rows = await hostelService.getTickets();
      downloadCsv(`hostel-maintenance-${stamp()}.csv`, TICKET_CSV_COLUMNS, rows);
    });

  return (
    <PageShell
      title="Hostel Reports"
      subtitle="Occupancy across hostels, with exports for spreadsheets and printing."
      actions={
        has("export_reports") && (
          <>
            <button
              onClick={() => run(() => printTable("Hostel Occupancy Report", OCCUPANCY_COLUMNS, byHostel))}
              disabled={byHostel.length === 0}
              className={`${secondaryButton} disabled:opacity-50`}
            >
              Print / Save PDF
            </button>
            <button
              onClick={() => downloadCsv(`hostel-occupancy-${stamp()}.csv`, OCCUPANCY_COLUMNS, byHostel)}
              disabled={byHostel.length === 0}
              className={`${secondaryButton} disabled:opacity-50`}
            >
              Occupancy CSV
            </button>
            <button onClick={exportAllocations} className={secondaryButton}>
              Allocations CSV
            </button>
            <button onClick={exportTickets} className={secondaryButton}>
              Tickets CSV
            </button>
          </>
        )
      }
    >
      <StatGrid stats={stats} isLoading={isLoading} />
      <ErrorBanner message={actionError} onDismiss={clearError} />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-bold text-slate-800">Occupancy by Hostel</h2>
        <DataTable
          columns={["Hostel", "Rooms", "Seats", "Occupied", "Reserved", "Free", "Occupancy", "In Maintenance", "Closed"]}
          isLoading={isLoading}
          loadError={loadError}
          onRetry={reload}
          hasRows={byHostel.length > 0}
          emptyMessage="No rooms yet."
        >
          {byHostel.map((row) => {
            const rate = percent(row.occupied, row.seats);

            return (
              <tr key={row.hostelName} className="border-b border-slate-100 tabular-nums text-slate-600">
                <td className="px-4 py-4 font-medium text-slate-800">{row.hostelName}</td>
                <td className="px-4 py-4">{row.rooms}</td>
                <td className="px-4 py-4">{row.seats}</td>
                <td className="px-4 py-4">{row.occupied}</td>
                <td className="px-4 py-4">{row.reserved}</td>
                <td className="px-4 py-4">{row.seats - row.occupied - row.reserved}</td>
                <td className="px-4 py-4">
                  {rate}%
                  <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${rate}%` }} />
                  </div>
                </td>
                <td className="px-4 py-4">{row.maintenanceRooms}</td>
                <td className="px-4 py-4">{row.closedRooms}</td>
              </tr>
            );
          })}
        </DataTable>
      </div>
    </PageShell>
  );
}
