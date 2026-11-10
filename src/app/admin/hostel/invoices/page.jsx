import InvoiceManagement from "../_components/InvoiceManagement";
import { HostelFeatureGate } from "../_components/hostelUi";

export default function InvoicesPage() {
  return (
    <HostelFeatureGate slug="invoices" title="Rent Invoices">
      <InvoiceManagement />
    </HostelFeatureGate>
  );
}
