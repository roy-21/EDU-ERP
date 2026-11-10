import HostelAuditLog from "../_components/HostelAuditLog";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function AuditPage() {
  return (
    <HostelFeatureGate slug="audit" title="Audit Log">
      <HostelAuditLog />
    </HostelFeatureGate>
  );
}
