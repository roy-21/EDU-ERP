import RentSettings from "../_components/RentSettings";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function RentSettingsPage() {
  return (
    <HostelFeatureGate slug="rent-settings" title="Rent Settings">
      <RentSettings />
    </HostelFeatureGate>
  );
}
