
import Link from "next/link";
import HostelControlBoard from "./_components/HostelControlBoard";
import RentDashboard from "./_components/RentDashboard";
import { HostelStats, RecentActivity } from "./_components/HostelOverview";

export default function HostelDashboard() {
  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <Link href="/admin" className="hover:text-blue-600">
            Admin
          </Link>
          <span>/</span>
          <span className="text-slate-700">Hostel Management</span>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Hostel Control Board
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage hostel rooms, seats, student allocation, maintenance, meals,
            visitors and hostel fees.
          </p>
        </div>

        <HostelStats />

        <RentDashboard />

        <HostelControlBoard />

        <RecentActivity />
      </div>
    </div>
  );
}
