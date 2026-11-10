import DueRentManagement from "../_components/DueRentManagement";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function DueRentPage() {
  return (
    <HostelFeatureGate slug="due-rent" title="Due Rent">
      <DueRentManagement />
    </HostelFeatureGate>
  );
}
