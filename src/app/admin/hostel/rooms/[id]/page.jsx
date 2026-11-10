import RoomDetail from "../../_components/RoomDetail";
import { HostelFeatureGate } from "../../_components/hostelUi";

export default async function RoomDetailPage({ params }) {
  const { id } = await params;

  return (
    <HostelFeatureGate slug="rooms" title="Room Management">
      <RoomDetail id={id} />
    </HostelFeatureGate>
  );
}
