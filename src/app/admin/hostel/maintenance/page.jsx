import MaintenanceManagement from "../_components/MaintenanceManagement";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function MaintenancePage() {
  return (
    <HostelFeatureGate slug="maintenance" title="Maintenance Tickets">
      <MaintenanceManagement />
    </HostelFeatureGate>
  );
}
