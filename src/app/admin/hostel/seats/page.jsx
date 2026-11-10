import SeatManagement from "../_components/SeatManagement";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function SeatsPage() {
  return (
    <HostelFeatureGate slug="seats" title="Seat Management">
      <SeatManagement />
    </HostelFeatureGate>
  );
}
