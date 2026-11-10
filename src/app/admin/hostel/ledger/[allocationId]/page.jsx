import StudentLedger from "../../_components/StudentLedger";
import { HostelFeatureGate } from "../../_components/hostelUi";

export default async function StudentLedgerPage({ params }) {
  const { allocationId } = await params;

  return (
    <HostelFeatureGate slug="due-rent" title="Due Rent">
      <StudentLedger allocationId={allocationId} />
    </HostelFeatureGate>
  );
}
