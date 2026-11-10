import HostelReports from "../_components/HostelReports";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function ReportsPage() {
  return (
    <HostelFeatureGate slug="reports" title="Hostel Reports">
      <HostelReports />
    </HostelFeatureGate>
  );
}
