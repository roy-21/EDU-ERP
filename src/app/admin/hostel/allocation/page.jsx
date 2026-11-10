import AllocationManagement from "../_components/AllocationManagement";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function AllocationPage() {
  return (
    <HostelFeatureGate slug="allocation" title="Student Allocation">
      <AllocationManagement />
    </HostelFeatureGate>
  );
}
