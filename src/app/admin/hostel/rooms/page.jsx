import RoomManagement from "../_components/RoomManagement";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function RoomsPage() {
  return (
    <HostelFeatureGate slug="rooms" title="Room Management">
      <RoomManagement />
    </HostelFeatureGate>
  );
}
