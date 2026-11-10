import NotificationLog from "../_components/NotificationLog";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function NotificationsPage() {
  return (
    <HostelFeatureGate slug="notifications" title="Rent Notifications">
      <NotificationLog />
    </HostelFeatureGate>
  );
}
